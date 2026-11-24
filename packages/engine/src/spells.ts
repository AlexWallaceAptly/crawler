/**
 * Spells (Milestone 6b). See "Spells" in docs/DESIGN.md.
 *
 * A cast is a power roll like a swing: 2d10 + INT/2 + the school's skill rank, with the
 * same tiers and crits. Damage spells are swings with INT (resolvePlayerHit does the hit);
 * status spells always land and the tier sets how long; heals heal the tier's power.
 *
 * Two things grow. The spell's own level (1-15) comes from casting it (every 10 × level
 * casts) and from duplicate tomes; it grows the power and the MP cost. The school's skill
 * trains on every cast that does something, adds to the roll, and unlocks perks at 5/10/15.
 *
 * Spells come from tomes (read outside a fight), scrolls (cast once, free, at the level
 * of the floor they dropped on) and a starter spell for backstories that fit magic.
 */
import type { Content } from "./content/load";
import type { AreaShape, Power, Spell, SpellSchool } from "./content/schemas";
import {
  afterAction, aliveEnemies, BAND, beginTurn, canAfford, consumeOne, damageCrawler, enemyGuard, fearBlocks, findEnemy,
  inCombat, isGrid, resolvePlayerHit, spendAp,
} from "./combat";
import { swingNumbers, type WeaponProfile } from "./gear";
import { collectModifiers, derive, modTotal } from "./rules/derived";
import { applyStatus, hasFlag } from "./rules/effects";
import { describePower, guardShift, powerRoll, type PowerRoll } from "./rules/power";
import { trainSkill } from "./progression";
import type { StepContext } from "./step";
import type { CombatState, Crawler, Enemy, ItemInstance, Pos } from "./state";
import { blocksMove, coord, dist, featureAt, inBounds, isCoord, parseCoord, reaches, same } from "./grid/geometry";
import { arenaOf } from "./grid/units";
import { shapeTiles } from "./maneuvers";
import { burn } from "./grid/fire";
import { addToPile, findItems } from "./inventory";
import { bfsDistances } from "./gen/floor";
import { pick } from "./rng";

export const SPELL_LEVEL_CAP = 15;

/** Casts from one level to the next: 10 at level 1, 20 at level 2, and so on. */
export function spellCastsToNext(level: number): number {
  return 10 * level;
}

/** The magic skill a school trains (validated: exactly one per school). */
export function schoolSkillId(content: Content, school: SpellSchool): string {
  return content.skills.all.find((s) => s.school === school)!.id;
}

/** What a spell does at a level, for this crawler, with its school perks applied. */
export interface SpellNumbers {
  level: number;
  mp: number;
  ap: number;
  cooldown: number;
  /** Damage or healing by tier, grown by level (INT's flat bonus is added on top when it lands). */
  power?: Power;
  /** Status spells: how long tier 2 lasts (tier 1 is 1, tier 3 is one more; self buffs always get this). */
  duration?: number;
  /** A damage spell's rider, with perks applied (Brain Freeze makes it land on every tier 2). */
  rider?: { id: string; chance: number; duration?: number };
  /** null: one target (or you). Area perks widen it. */
  shape: AreaShape | null;
  chain: number;
  drain: number;
  healPct: number;
  radius: number;
}

/** Fractional per-level growth: 0.25 a level is +1 at levels 5, 9, 13. */
const grow = (perLevel: number, level: number) => Math.floor(perLevel * (level - 1) + 1e-9);

export function spellNumbers(c: Crawler, content: Content, spell: Spell, level: number, mods = collectModifiers(c, content)): SpellNumbers {
  const perk = (kind: string) => modTotal(mods, `${kind}:${spell.school}`);
  let shape: AreaShape | null = spell.target === "area" ? spell.shape ?? "single" : null;
  if (perk("area") > 0 && spell.target !== "self") shape = shape === null ? "plus" : "square";
  const add = grow(spell.powerPerLevel, level);
  const riderDef = spell.rider ? content.statusEffects.byId[spell.rider.id] : undefined;
  const damage = !!spell.power && spell.target !== "self";
  return {
    level,
    mp: Math.max(1, spell.mp + grow(spell.mpPerLevel, level) + perk("mpCost")),
    ap: spell.ap,
    cooldown: Math.max(0, spell.cooldown + (spell.cooldown > 0 ? perk("cooldown") : 0)),
    ...(spell.power ? { power: spell.power.map((p) => p + add) as Power } : {}),
    ...(spell.status ? { duration: spell.status.duration + perk("duration") } : {}),
    ...(spell.rider ? {
      rider: {
        id: spell.rider.id,
        chance: perk("riderUp") > 0 ? 1 : spell.rider.chance,
        duration: (spell.rider.duration ?? riderDef?.defaultDuration ?? 1) + perk("duration"),
      },
    } : {}),
    shape,
    chain: damage ? (spell.chain ?? 0) + perk("chain") : 0,
    drain: damage ? (spell.drain ?? 0) + perk("drain") : 0,
    healPct: perk("healPct"),
    radius: (spell.radius ?? 0) + perk("radius"),
  };
}

/** The spell as a swing: INT, the school's skill, the school as the weapon type, the rider on hit. */
export function spellProfile(content: Content, spell: Spell, n: SpellNumbers): WeaponProfile {
  return {
    name: spell.name,
    power: n.power ?? [1, 1, 1],
    apCost: spell.ap,
    stat: "INT",
    reach: spell.range,
    skillId: schoolSkillId(content, spell.school),
    weaponType: spell.school,
    ...(spell.damageType ? { damageType: spell.damageType } : {}),
    ...(n.rider ? { onHit: n.rider } : {}),
    spell: true,
  };
}

/** A known spell by (part of) its name. */
export function findKnownSpell(c: Crawler, content: Content, query: string): Spell | undefined {
  const q = query.toLowerCase().trim();
  const known = Object.keys(c.spells).map((id) => content.spells.byId[id]).filter((s): s is Spell => !!s);
  return known.find((s) => s.name.toLowerCase() === q || s.id === q) ?? known.find((s) => s.name.toLowerCase().includes(q));
}

/** Scrolls you're carrying, and the tomes. */
export function scrollsIn(c: Crawler): ItemInstance[] {
  return c.inventory.filter((i) => i.kind === "consumable" && i.spellId && i.spellLevel !== undefined);
}

// ---------------------------------------------------------------- learning

/** Learn a spell at level 1, or (already known) gain a level. Returns the new level, or 0 if it's maxed. */
export function learnSpell(ctx: StepContext, spell: Spell): number {
  const c = ctx.crawler;
  const known = c.spells[spell.id];
  if (!known) {
    c.spells[spell.id] = { level: 1, casts: 0, cooldown: 0 };
    ctx.say("spell.learned", { spell: spell.name });
    return 1;
  }
  if (known.level >= SPELL_LEVEL_CAP) return 0;
  known.level += 1;
  ctx.say("spell.levelUp", { spell: spell.name, level: known.level });
  return known.level;
}

/** Read a tome: learn its spell, or level it up. Takes peace and quiet. */
export function readTome(ctx: StepContext, item: ItemInstance): void {
  const spell = item.spellId ? ctx.content.spells.byId[item.spellId] : undefined;
  if (!spell) {
    ctx.error(`${item.name} is blank. Somebody already read the magic out of it.`);
    return;
  }
  if (inCombat(ctx)) {
    ctx.error(`${item.name} takes more peace and quiet than you currently have.`);
    return;
  }
  const known = ctx.crawler.spells[spell.id];
  if (known && known.level >= SPELL_LEVEL_CAP) {
    ctx.error(`You know ${spell.name} better than ${item.name} does. It has nothing left to teach you.`);
    return;
  }
  consumeOne(ctx, item);
  const level = learnSpell(ctx, spell);
  ctx.describe(known
    ? `You read ${item.name} again, slower. ${spell.name} is level ${level} now.`
    : `You read ${item.name} cover to cover. You know ${spell.name}: ${spell.description} (\`cast ${spell.name.toLowerCase()}\`)`);
}

/** One more cast toward the next level. Scrolls don't count: they did the work, not you. */
function countCast(ctx: StepContext, spell: Spell): void {
  const st = ctx.crawler.spells[spell.id];
  if (!st || st.level >= SPELL_LEVEL_CAP) return;
  st.casts += 1;
  while (st.level < SPELL_LEVEL_CAP && st.casts >= spellCastsToNext(st.level)) {
    st.casts -= spellCastsToNext(st.level);
    st.level += 1;
    ctx.say("spell.levelUp", { spell: spell.name, level: st.level });
  }
  if (st.level >= SPELL_LEVEL_CAP) st.casts = 0;
}

// ---------------------------------------------------------------- casting

/** Who a cast lands on. */
interface CastPlan {
  /** The enemy it was aimed at (an area spell's center, if someone's standing there). */
  primary?: Enemy;
  /** Everyone it covers, the primary first. */
  hit: Enemy[];
  /** Grid: the tile it was aimed at. */
  tile?: Pos;
  /** You're standing in your own area. */
  selfInArea: boolean;
}

/**
 * Cast a spell you know (MP, cooldown) or read a scroll of it (free, once). `at` is an
 * enemy, a tile ("d4") or nothing (the nearest thing it reaches).
 */
export function castSpell(ctx: StepContext, spell: Spell, at?: string, scroll?: ItemInstance): void {
  const c = ctx.crawler;
  const fighting = inCombat(ctx);
  const known = c.spells[spell.id];
  if (!known && !scroll) {
    ctx.error(`You don't know ${spell.name}. Find the tome.`);
    return;
  }
  const level = scroll ? scroll.spellLevel ?? 1 : known!.level;
  const mods = collectModifiers(c, ctx.content);
  const n = spellNumbers(c, ctx.content, spell, level, mods);
  if (fighting && spell.when === "explore") {
    ctx.error(`${spell.name} is for quiet moments. This isn't one.`);
    return;
  }
  if (!fighting && spell.when === "fight") {
    ctx.error(`${spell.name} needs something to aim at. Nothing here is hostile. Yet.`);
    return;
  }
  // Refuse the pointless before anything is paid (you know your own HP and statuses).
  const d = derive(c, ctx.content);
  if (spell.target === "self" && spell.power && c.hp >= d.maxHP) {
    ctx.error(`You're already at full HP. ${spell.name} would just be showing off.`);
    return;
  }
  if (spell.cures && !c.statuses.some((s) => spell.cures!.includes(s.id))) {
    ctx.error(`Nothing on you for ${spell.name} to fix. Not that kind of thing, anyway.`);
    return;
  }
  if (fighting) {
    if (!beginTurn(ctx)) return;
    if (fearBlocks(ctx, "Fear scrambles the words. Nothing comes out but a whimper.")) return;
  }
  if (!scroll && known!.cooldown > 0) {
    ctx.error(`${spell.name} isn't ready: ${known!.cooldown} more round${known!.cooldown === 1 ? "" : "s"}.`);
    return;
  }
  if (!scroll && c.mp < n.mp) {
    ctx.error(`${spell.name} costs ${n.mp} MP and you have ${c.mp}. Drink something blue, or hit it with a stick.`);
    return;
  }
  if (fighting && !canAfford(ctx, n.ap, `Casting ${spell.name}`)) return;

  let plan: CastPlan = { hit: [], selfInArea: false };
  if (spell.target !== "self") {
    const p = isGrid(ctx) ? gridPlan(ctx, spell, n, at) : bandsPlan(ctx, spell, n, at);
    if (typeof p === "string") {
      ctx.error(p);
      return;
    }
    plan = p;
  }

  if (fighting) spendAp(ctx, n.ap);
  if (scroll) consumeOne(ctx, scroll);
  else {
    c.mp -= n.mp;
    if (fighting) known!.cooldown = n.cooldown;
  }
  const first = (c.counters.casts ?? 0) === 0;
  c.counters.casts = (c.counters.casts ?? 0) + 1;
  const say = (text: string) => (fighting ? ctx.fight(text, "you") : ctx.describe(text));
  if (scroll) say(`You read ${scroll.name} aloud. It crumbles as the last word leaves your mouth.`);

  const profile = spellProfile(ctx.content, spell, n);
  const skillId = profile.skillId!;
  if (spell.target !== "self" && n.power) castDamage(ctx, spell, n, profile, plan);
  else if (spell.target !== "self" && n.duration !== undefined) castStatus(ctx, spell, n, profile, plan);
  else castOnSelf(ctx, spell, n, profile, say, skillId);

  ctx.emit({ type: "spellCast", spell: spell.name, school: spell.school, scroll: !!scroll, first, inCombat: fighting });
  if (!scroll && ctx.game.crawler && ctx.game.phase !== "dead") countCast(ctx, spell);
  if (first && ctx.game.phase !== "dead") ctx.say("spell.firstCast", { spell: spell.name });
  if (ctx.game.phase === "combat") afterAction(ctx);
}

// ---------------------------------------------------------------- targets

/** An enemy that can be targeted (not invisible, alive). */
function targetable(ctx: StepContext, e: Enemy): boolean {
  return e.hp > 0 && !hasFlag(e.statuses, ctx.content, "untargetable");
}

/** Confusion picks your target for you, among what the spell can reach. */
function confusedPick(ctx: StepContext, options: Enemy[], chosen: Enemy): Enemy {
  if (!hasFlag(ctx.crawler.statuses, ctx.content, "randomTarget") || options.length < 2) return chosen;
  const t = pick(options);
  if (t !== chosen) ctx.fight(`Confusion picks a target for you: ${t.name}.`, "status");
  return t;
}

const RANGE_TEXT: Record<string, string> = { close: "next to you", near: "within 3 tiles", far: "anywhere you can see" };

function gridPlan(ctx: StepContext, spell: Spell, n: SpellNumbers, at?: string): CastPlan | string {
  const a = arenaOf(ctx);
  const inReach = (p: Pos) => reaches(a, ctx.content, a.crawler, p, spell.range);
  const foes = aliveEnemies(ctx).filter((e) => e.pos && targetable(ctx, e));
  const reachable = foes.filter((e) => inReach(e.pos!)).sort((x, y) => dist(x.pos!, a.crawler) - dist(y.pos!, a.crawler));
  let tile: Pos | null = null;
  let aimed: Enemy | undefined;
  if (at && isCoord(at)) tile = parseCoord(at);
  else if (at) {
    aimed = findEnemy(ctx, at);
    if (!aimed?.pos) return `Nothing here called "${at}".`;
    if (!targetable(ctx, aimed)) return `${aimed.name} can't be targeted right now.`;
    tile = aimed.pos;
  } else {
    aimed = reachable[0];
    if (!aimed) return `Nothing ${RANGE_TEXT[spell.range]} for ${spell.name} to hit. Say where: cast ${spell.name.toLowerCase()} at d4.`;
    tile = aimed.pos!;
  }
  if (!tile || !inBounds(a, tile)) return "That's not on the board.";
  if (!inReach(tile)) {
    return dist(a.crawler, tile) > { close: 1, near: 3, far: 99 }[spell.range]
      ? `${coord(tile)} is out of range for ${spell.name} (${RANGE_TEXT[spell.range]}).`
      : `You can't see ${coord(tile)} from here.`;
  }
  if (n.shape === null) {
    let target = aimed ?? foes.find((e) => same(e.pos!, tile!));
    if (!target) return `There's nobody at ${coord(tile)} for ${spell.name}. It needs a target.`;
    target = confusedPick(ctx, reachable, target);
    return { primary: target, hit: [target], tile: target.pos!, selfInArea: false };
  }
  if (blocksMove(a, ctx.content, tile)) return `There's a ${featureAt(a, ctx.content, tile)!.name.toLowerCase()} in the way at ${coord(tile)}.`;
  const tiles = shapeTiles(a, tile, n.shape);
  const covered = (p: Pos) => tiles.some((t) => same(t, p));
  const hit = foes.filter((e) => covered(e.pos!));
  const primary = hit.find((e) => same(e.pos!, tile!));
  if (primary) {
    hit.splice(hit.indexOf(primary), 1);
    hit.unshift(primary);
  }
  return { ...(primary ? { primary } : {}), hit, tile, selfInArea: covered(a.crawler) };
}

function bandsPlan(ctx: StepContext, spell: Spell, n: SpellNumbers, at?: string): CastPlan | string {
  const foes = aliveEnemies(ctx).filter((e) => targetable(ctx, e));
  const reachable = foes.filter((e) => BAND[e.range] <= BAND[spell.range]);
  let target: Enemy | undefined;
  if (at) {
    target = findEnemy(ctx, at);
    if (!target) return `Nothing here called "${at}".`;
    if (!targetable(ctx, target)) return `${target.name} can't be targeted right now.`;
    if (BAND[target.range] > BAND[spell.range]) return `The ${target.name} is at ${target.range} range. ${spell.name} only reaches ${spell.range}.`;
  } else {
    target = reachable[0];
    if (!target) return `Nothing in ${spell.range} range for ${spell.name}. Advance, or pick something closer.`;
  }
  target = confusedPick(ctx, reachable, target);
  if (n.shape === null) return { primary: target, hit: [target], selfInArea: false };
  // Bands has no tiles: an area spell covers everyone in the target's band.
  const hit = [target, ...foes.filter((e) => e !== target && e.range === target!.range)];
  return { primary: target, hit, selfInArea: false };
}

// ---------------------------------------------------------------- resolving

function bonusAgainst(ctx: StepContext, spell: Spell, e: Enemy): number {
  if (!spell.bonus) return 0;
  const tags = ctx.content.enemies.byId[e.familyId]?.tags ?? [];
  return spell.bonus.tags.some((t) => tags.includes(t)) ? spell.bonus.damage : 0;
}

/** Damage: one roll; each target takes the tier's damage less its own armor. Arcs do half. */
function castDamage(ctx: StepContext, spell: Spell, n: SpellNumbers, w: WeaponProfile, plan: CastPlan): void {
  const c = ctx.crawler;
  const sw = swingNumbers(c, ctx.content, w);
  // One target rolls against its guard; an area spell rolls once for everyone, guard or not.
  const roll: PowerRoll | undefined = n.shape === null ? undefined : powerRoll(sw.rollBonus, 0, 0, sw.critAt);
  if (plan.hit.length === 0) {
    ctx.fight(`${spell.name} lands on ${plan.tile ? coord(plan.tile) : "the floor"}${roll ? `: ${describePower(roll)}` : ""}. It hits nothing alive.`, "you");
  }
  let used = roll;
  plan.hit.forEach((e, i) => {
    if (ctx.game.phase !== "combat") return;
    used = resolvePlayerHit(ctx, e, w, {
      ...(used ? { roll: used } : {}), secondary: i > 0, extraDamage: bonusAgainst(ctx, spell, e), ...(n.drain ? { drain: n.drain } : {}),
    });
  });
  // An arc: to the nearest others, half damage, same roll.
  const lead = plan.hit[0];
  if (n.chain > 0 && lead && used && ctx.game.phase === "combat") {
    const others = aliveEnemies(ctx).filter((e) => targetable(ctx, e) && !plan.hit.includes(e) &&
      (lead.pos && e.pos ? dist(lead.pos, e.pos) <= 2 : e.range === lead.range));
    if (lead.pos) others.sort((x, y) => dist(x.pos!, lead.pos!) - dist(y.pos!, lead.pos!));
    for (const e of others.slice(0, n.chain)) {
      if (ctx.game.phase !== "combat") break;
      ctx.fight(`${spell.name} arcs to the ${e.name}.`, "you");
      resolvePlayerHit(ctx, e, w, { roll: used, secondary: true, scale: 0.5, extraDamage: bonusAgainst(ctx, spell, e) });
    }
  }
  if (ctx.game.phase !== "combat") return;
  // Standing in your own blast: you get the tier's damage too (your own armor helps).
  if (plan.selfInArea && used) {
    const raw = n.power![used.tier - 1]! + sw.flat - derive(c, ctx.content).armor;
    const dmg = damageCrawler(ctx, Math.max(1, raw), spell.damageType ?? "physical", `their own ${spell.name.toLowerCase()}`);
    if (ctx.game.phase === "combat") ctx.fight(`You're inside your own ${spell.name}: ${dmg} damage (${c.hp} HP left).`, "you");
    else return;
  }
  if (spell.hazard && plan.tile && isGrid(ctx)) {
    const a = arenaOf(ctx);
    const f = ctx.content.arenaFeatures.get(spell.hazard.id);
    const tiles = shapeTiles(a, plan.tile, spell.hazard.shape).filter((p) => !blocksMove(a, ctx.content, p));
    for (const p of tiles) {
      a.hazards = a.hazards.filter((h) => !same(h, p));
      a.hazards.push({ x: p.x, y: p.y, id: f.id, ...(f.rounds ? { rounds: f.rounds } : {}) });
    }
    ctx.fight(`${f.name} now covers ${tiles.length === 1 ? coord(plan.tile) : `${coord(plan.tile)} and around it`}.`, "status");
    burn(ctx);
  }
}

/** Status spells always land; the tier says how long. Tier 1: 1 round. Tier 2: the spell's. Tier 3: one more. */
function castStatus(ctx: StepContext, spell: Spell, n: SpellNumbers, w: WeaponProfile, plan: CastPlan): void {
  const c = ctx.crawler;
  const sw = swingNumbers(c, ctx.content, w);
  const single = n.shape === null ? plan.primary : undefined;
  const shift = single ? guardShift(enemyGuard(ctx, single)) : { edges: 0, banes: 0 };
  const roll = powerRoll(sw.rollBonus, shift.edges, shift.banes, sw.critAt);
  const def = ctx.content.statusEffects.get(spell.status!.id);
  const rounds = roll.tier === 1 ? 1 : roll.tier === 2 ? n.duration! : n.duration! + 1;
  const landed: string[] = [];
  for (const e of plan.hit) if (applyStatus(e.statuses, def, rounds) !== "ignored") landed.push(`the ${e.name}`);
  if (plan.selfInArea && applyStatus(c.statuses, def, rounds) !== "ignored") landed.push("you");
  const tier = roll.crit ? "CRIT, tier 3" : `Tier ${roll.tier}`;
  ctx.fight(landed.length
    ? `${spell.name}: ${describePower(roll)}. ${tier}: ${landed.join(", ")} ${landed.length === 1 && landed[0] !== "you" ? "is" : "are"} ${def.name.toLowerCase()} for ${rounds} round${rounds === 1 ? "" : "s"}.`
    : `${spell.name}: ${describePower(roll)}. It lands on nobody who cares.`, "you");
  if (landed.length === 0) return;
  critBack(ctx, roll);
  trainSkill(ctx, w.skillId, roll.crit ? 2 : 1);
}

/** Heals, self buffs, cures and the utility spells. */
function castOnSelf(ctx: StepContext, spell: Spell, n: SpellNumbers, w: WeaponProfile, say: (t: string) => void, skillId: string): void {
  const c = ctx.crawler;
  const d = derive(c, ctx.content);
  let did = false;
  let crit = false;
  if (n.power) {
    const sw = swingNumbers(c, ctx.content, w);
    const roll = powerRoll(sw.rollBonus, 0, 0, sw.critAt);
    const amount = Math.round((n.power[roll.tier - 1]! + Math.floor((d.stats.INT * spell.ap) / 4)) * (1 + n.healPct / 100));
    const before = c.hp;
    c.hp = Math.min(d.maxHP, c.hp + amount);
    say(`${spell.name}: ${describePower(roll)}. ${roll.crit ? "CRIT, tier 3" : `Tier ${roll.tier}`}: +${c.hp - before} HP (${c.hp}/${d.maxHP}).`);
    critBack(ctx, roll);
    did = true;
    crit = roll.crit;
  }
  if (spell.status) {
    // Self buffs don't roll: there's nobody resisting. They get the full length.
    const def = ctx.content.statusEffects.get(spell.status.id);
    applyStatus(c.statuses, def, n.duration);
    const unit = inCombat(ctx) ? "round" : "room";
    say(`${spell.name}: you're ${def.name.toLowerCase()} for ${n.duration} ${unit}${n.duration === 1 ? "" : "s"}.`);
    did = true;
  }
  if (spell.cures) {
    const gone = c.statuses.filter((s) => spell.cures!.includes(s.id));
    c.statuses = c.statuses.filter((s) => !spell.cures!.includes(s.id));
    const names = gone.map((s) => ctx.content.statusEffects.byId[s.id]?.name.toLowerCase() ?? s.id);
    say(`${spell.name}: no longer ${names.join(" or ")}.`);
    did = gone.length > 0;
  }
  if (spell.utility === "reveal") did = reveal(ctx, spell, say);
  if (spell.utility === "senseStairs") did = senseStairs(ctx, spell, n, say);
  if (did) trainSkill(ctx, skillId, crit ? 2 : 1);
}

function critBack(ctx: StepContext, roll: PowerRoll): void {
  const combat = ctx.game.combat;
  if (!roll.crit || !combat) return;
  combat.ap += 1;
  ctx.fight("The crit hands you 1 AP back.", "you");
}

/** Flashlight App: whatever's hidden in this room is in plain sight now (not voices: those need a search). */
function reveal(ctx: StepContext, spell: Spell, say: (t: string) => void): boolean {
  const floor = ctx.game.floor;
  if (!floor) return false;
  const room = floor.rooms[floor.currentRoom]!;
  const found = room.hidden ?? [];
  room.items ??= [];
  for (const it of found) addToPile(room.items, it);
  delete room.hidden;
  const stairs = !!room.concealed;
  room.concealed = false;
  const bits = [...found.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)), ...(stairs ? ["a stairwell behind a false wall"] : [])];
  say(bits.length ? `${spell.name} turns up: ${bits.join(", ")}.` : `${spell.name} sweeps the room. Nothing hiding. Probably.`);
  return bits.length > 0;
}

/** Dowsing Rod: concealed stairwells within the radius go on the map. */
function senseStairs(ctx: StepContext, spell: Spell, n: SpellNumbers, say: (t: string) => void): boolean {
  const floor = ctx.game.floor;
  if (!floor) return false;
  const d = bfsDistances(floor.rooms, floor.currentRoom);
  let found = 0;
  for (const r of floor.rooms) {
    if (r.type !== "stairwell" || !r.concealed || d[r.id]! < 0 || d[r.id]! > n.radius) continue;
    r.concealed = false;
    r.seen = true;
    r.marked = true;
    found += 1;
  }
  say(found ? `${spell.name} twitches hard: ${found} hidden stairwell${found === 1 ? "" : "s"} marked on your map.`
    : `${spell.name} hangs there, limp. No hidden stairs within ${n.radius} rooms.`);
  return found > 0;
}

// ---------------------------------------------------------------- what the panels show

const SHAPE_TEXT: Record<AreaShape, string> = { single: "one tile", plus: "a plus of five tiles", square: "a 3×3 square" };

/**
 * What a spell does, in one line: "4/6/8 fire damage · near · burning (40% on a solid hit,
 * always on a great one)". `flat` is INT's bonus for this crawler (0 for the workbook).
 */
export function spellEffectText(content: Content, spell: Spell, n: SpellNumbers, flat = 0): string {
  const bits: string[] = [];
  const status = (id: string) => content.statusEffects.byId[id]?.name.toLowerCase() ?? id;
  const reach = spell.target === "self" ? "" : ` · ${spell.range}`;
  const area = n.shape ? ` to everything on ${SHAPE_TEXT[n.shape]}` : "";
  if (n.power && spell.target !== "self") {
    bits.push(`${n.power.map((p) => p + flat).join("/")} ${spell.damageType ?? ""} damage${area}${reach}`.replace("  ", " "));
    if (n.rider) {
      const when = n.rider.chance >= 1 ? "on any solid hit" : `${Math.round(n.rider.chance * 100)}% on a solid hit, always on a great one`;
      bits.push(`${status(n.rider.id)} ${n.rider.duration ?? ""}${n.rider.duration ? ` round${n.rider.duration === 1 ? "" : "s"}` : ""} (${when})`.replace("  ", " "));
    }
    if (spell.bonus) bits.push(`+${spell.bonus.damage} against ${spell.bonus.tags.map((t) => (t === "lightSensitive" ? "light-sensitive" : t)).join(" and ")} things`);
    if (n.drain) bits.push(`heals you ${n.drain}% of the damage`);
    if (n.chain) bits.push(`arcs to ${n.chain} more nearby for half`);
    if (spell.hazard) bits.push(`leaves ${content.arenaFeatures.byId[spell.hazard.id]?.name.toLowerCase() ?? spell.hazard.id} behind`);
  } else if (n.power) {
    bits.push(`heals ${n.power.map((p) => Math.round((p + flat) * (1 + n.healPct / 100))).join("/")}`);
  }
  if (spell.status && n.duration !== undefined) {
    const unit = spell.when === "explore" ? "room" : "round";
    bits.push(spell.target === "self"
      ? `you: ${status(spell.status.id)} for ${n.duration} ${unit}${n.duration === 1 ? "" : "s"}`
      : `${n.shape ? `everything on ${SHAPE_TEXT[n.shape]}: ` : ""}${status(spell.status.id)} for 1/${n.duration}/${n.duration + 1} rounds by tier${reach}`);
  }
  if (spell.cures) bits.push(`cures ${spell.cures.map(status).join(", ")}`);
  if (spell.utility === "reveal") bits.push("turns up what's hidden in this room, instantly");
  if (spell.utility === "senseStairs") bits.push(`marks hidden stairwells within ${n.radius} rooms`);
  return bits.join(" · ");
}

export interface SpellView {
  id: string;
  name: string;
  school: string;
  /** The school's skill ("Fire Magic"). */
  skill: string;
  level: number;
  /** Casts toward the next level, and how many it takes (0 at the cap). */
  casts: number;
  next: number;
  mp: number;
  ap: number;
  /** Rounds until it's ready (fights only). */
  cooldown: number;
  /** Rounds it goes on cooldown for after a cast. */
  cooldownMax: number;
  when: "fight" | "explore" | "any";
  description: string;
  /** What it does right now, with your INT in the numbers. */
  effect: string;
}

/** INT's flat bonus on what this spell deals or heals (damage spells add damage gear too, like a swing). */
export function spellFlat(c: Crawler, content: Content, spell: Spell, n: SpellNumbers, mods = collectModifiers(c, content)): number {
  if (!n.power) return 0;
  const d = derive(c, content);
  return spell.target === "self" ? Math.floor((d.stats.INT * spell.ap) / 4) : swingNumbers(c, content, spellProfile(content, spell, n), d, mods).flat;
}

export function spellViews(c: Crawler, content: Content): SpellView[] {
  const mods = collectModifiers(c, content);
  return Object.entries(c.spells).flatMap(([id, st]) => {
    const spell = content.spells.byId[id];
    if (!spell) return [];
    const n = spellNumbers(c, content, spell, st.level, mods);
    const flat = spellFlat(c, content, spell, n, mods);
    return [{
      id, name: spell.name, school: spell.school, skill: content.skills.byId[schoolSkillId(content, spell.school)]?.name ?? spell.school,
      level: st.level, casts: st.casts, next: st.level >= SPELL_LEVEL_CAP ? 0 : spellCastsToNext(st.level),
      mp: n.mp, ap: n.ap, cooldown: st.cooldown, cooldownMax: n.cooldown, when: spell.when,
      description: spell.description, effect: spellEffectText(content, spell, n, flat),
    }];
  });
}

/** Grid: the tiles this spell can be aimed at from where you stand (enemies for one-target spells). */
export function spellTargetTiles(game: { combat: CombatState | null }, content: Content, spell: Spell, n: SpellNumbers): Pos[] {
  const a = game.combat?.arena;
  if (!a || spell.target === "self") return [];
  const inReach = (p: Pos) => reaches(a, content, a.crawler, p, spell.range);
  if (n.shape === null) {
    return game.combat!.enemies.filter((e) => e.hp > 0 && e.pos && !hasFlag(e.statuses, content, "untargetable") && inReach(e.pos))
      .map((e) => e.pos!);
  }
  const out: Pos[] = [];
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const p = { x, y };
      if (!same(p, a.crawler) && !blocksMove(a, content, p) && inReach(p)) out.push(p);
    }
  }
  return out;
}
