/**
 * Combat (spec: Core rules / Combat). Initiative is rolled once; enemies that
 * beat the crawler act first in round 1, after that each round is the player's
 * action followed by every living enemy in initiative order.
 *
 * Two modes share every roll in this file (to-hit, damage, statuses, flee
 * contest, item effects): "bands" keeps the original three range bands per
 * enemy, "grid" (Milestone 4b) puts everyone on a small tactical arena and
 * derives the bands from tile distance. The mode is fixed when the fight starts.
 */
import type { Content } from "./content/load";
import type { Consumable, Effect, EnemyAttack, RangeBand } from "./content/schemas";
import { generateGroup } from "./gen/enemy";
import { enterRoom, advanceTime, TIME_COST } from "./explore";
import { dcFor } from "./rules/checks";
import { rollDice } from "./rules/dice";
import { collectModifiers, derive, modTotal } from "./rules/derived";
import { applyStatus, decrementStatuses, hasFlag, tickStatuses } from "./rules/effects";
import { chance, d20, pick } from "./rng";
import { killCrawler, type StepContext } from "./step";
import {
  combatModeOf, type CombatMode, type Enemy, type ItemInstance, type Room, type StatusInstance,
} from "./state";

export const BAND: Record<RangeBand, number> = { close: 0, near: 1, far: 2 };
export const BANDS: RangeBand[] = ["close", "near", "far"];

export type LiveAttack = EnemyAttack & { ready: number };

export function aliveEnemies(ctx: StepContext): Enemy[] {
  return ctx.game.combat?.enemies.filter((e) => e.hp > 0) ?? [];
}

export function inCombat(ctx: StepContext): boolean {
  return ctx.game.phase === "combat" && ctx.game.combat !== null;
}

// ---------------------------------------------------------------- encounters

/** Encounter odds by room type. Lairs always fight (elite); corridors roll every entry. */
export function maybeEncounter(ctx: StepContext, room: Room, firstVisit: boolean, cameFrom?: number): boolean {
  if (ctx.game.phase !== "exploring") return false;
  let elite = false;
  let p = 0;
  if (room.type === "lair") { p = firstVisit ? 1 : 0.2; elite = firstVisit; }
  else if (room.type === "chamber") p = firstVisit ? 0.35 : 0.06;
  else if (room.type === "corridor") p = 0.08;
  else if (room.type === "event" || room.type === "npc" || room.type === "puzzle") p = firstVisit ? 0.15 : 0.05;
  if (p <= 0 || !chance(p)) return false;
  const floor = ctx.game.floor!;
  const enemies = generateGroup(floor.floor, elite, ctx.content);
  if (enemies.length === 0) return false;
  startCombat(ctx, enemies, { fromRoom: cameFrom ?? floor.currentRoom });
  return true;
}

export interface StartOptions {
  /** Where the crawler walked in from; fleeing back out lands there. Defaults to the current room. */
  fromRoom?: number;
  /** Override the account setting (tests, the sim). */
  mode?: CombatMode;
}

export function startCombat(ctx: StepContext, enemies: Enemy[], opts: StartOptions = {}): void {
  const floor = ctx.game.floor!;
  const d = derive(ctx.crawler, ctx.content);
  const playerInit = d20() + d.initiativeBonus;
  for (const e of enemies) e.initiative += d20() + e.stats.DEX;
  enemies.sort((a, b) => b.initiative - a.initiative);

  ctx.game.combat = {
    mode: opts.mode ?? combatModeOf(ctx.account),
    enemies,
    round: 1,
    playerInitiative: playerInit,
    minorActionsUsed: 0,
    turnBegun: false,
    fromRoom: opts.fromRoom ?? floor.currentRoom,
  };
  ctx.setPhase("combat");
  ctx.emit({ type: "combatStarted", names: enemies.map((e) => e.name) });
  ctx.say("combat.start");
  for (const e of enemies) {
    ctx.fight(`${e.name} — level ${e.level}${e.tier === "elite" ? " ELITE" : ""}, ${e.range} range.`, "enemy");
  }
  // Ambush: anyone who beat your initiative gets their round-1 turn now.
  for (const e of enemies) {
    if (e.initiative > playerInit && ctx.game.phase === "combat") enemyTurn(ctx, e);
  }
}

// ---------------------------------------------------------------- round flow

/** Runs after the player's main action: remaining enemies act, then the round closes. */
export function finishRound(ctx: StepContext): void {
  if (ctx.game.phase !== "combat") return;
  // Enemies slower than the crawler take their turn after the crawler. Faster
  // enemies take their turn at the start of each round (including round one).
  for (const e of aliveEnemies(ctx).filter((enemy) =>
    enemy.initiative <= ctx.game.combat!.playerInitiative)) {
    if (ctx.game.phase !== "combat") return;
    enemyTurn(ctx, e);
  }
  closeRound(ctx);
}

/** End-of-round bookkeeping, then the faster enemies open the next round. */
export function closeRound(ctx: StepContext): void {
  if (ctx.game.phase !== "combat") return;
  endOfRound(ctx);
  if (ctx.game.phase !== "combat") return;
  for (const e of aliveEnemies(ctx).filter((enemy) =>
    enemy.initiative > ctx.game.combat!.playerInitiative)) {
    if (ctx.game.phase !== "combat") return;
    enemyTurn(ctx, e);
  }
  checkVictory(ctx);
}

function endOfRound(ctx: StepContext): void {
  const combat = ctx.game.combat!;
  const c = ctx.crawler;
  for (const e of combat.enemies) {
    if (e.hp <= 0) continue;
    for (const a of e.attacks) a.ready = Math.max(0, a.ready - 1);
    if (e.regen > 0 && e.hp < e.maxHP) e.hp = Math.min(e.maxHP, e.hp + e.regen);
  }
  for (const name of decrementStatuses(c.statuses, ctx.content)) {
    ctx.fight(`You are no longer ${name.toLowerCase()}.`, "status");
  }
  combat.minorActionsUsed = 0;
  combat.turnBegun = false;
  combat.round += 1;
  advanceTime(ctx, TIME_COST.combatRound);
}

/**
 * Start of the crawler's turn: statuses tick. Idempotent within a round, so an
 * action that is rejected after this (bad target) doesn't tick a second time
 * when the player tries again. Returns false if the turn is already lost.
 */
export function beginTurn(ctx: StepContext): boolean {
  const combat = ctx.game.combat!;
  if (combat.turnBegun) return true;
  combat.turnBegun = true;
  const c = ctx.crawler;
  for (const t of tickStatuses(c.statuses, ctx.content)) {
    c.hp = Math.min(derive(c, ctx.content).maxHP, c.hp - t.amount);
    ctx.fight(t.amount > 0 ? `${t.status} costs you ${t.amount} HP.` : `${t.status} restores ${-t.amount} HP.`, "status");
  }
  if (c.hp <= 0) {
    endCombat(ctx);
    killCrawler(ctx, "their own wounds");
    return false;
  }
  if (hasFlag(c.statuses, ctx.content, "skipTurn")) {
    ctx.fight("You are stunned and lose the turn.", "status");
    finishRound(ctx);
    return false;
  }
  return true;
}

/** Fear: the only action left is running. Spends the turn if it bites. */
function fearBlocks(ctx: StepContext, line: string): boolean {
  if (!hasFlag(ctx.crawler.statuses, ctx.content, "fleeOnly")) return false;
  ctx.fight(line, "status");
  finishRound(ctx);
  return true;
}

// ---------------------------------------------------------------- player attacks

export interface WeaponProfile {
  name: string;
  dice: string;
  stat: "STR" | "DEX";
  reach: RangeBand;
  skillId?: string;
  damageType?: string;
  /** Crafted weapons: a status that can land on a hit. */
  onHit?: { id: string; chance: number; duration?: number };
}

export function playerWeapon(ctx: StepContext): WeaponProfile {
  const c = ctx.crawler;
  const uidMain = c.equipment.mainHand;
  const weapon = uidMain ? c.inventory.find((i) => i.uid === uidMain) : undefined;
  if (weapon?.damage) {
    const skill = ctx.content.skills.all.find((s) => s.weaponType && s.weaponType === weapon.weaponType);
    return {
      name: weapon.name,
      dice: weapon.damage,
      stat: weapon.stat ?? "STR",
      reach: (weapon.range as RangeBand | undefined) ?? "close",
      ...(skill ? { skillId: skill.id } : {}),
      ...(weapon.damageType ? { damageType: weapon.damageType } : {}),
      ...(weapon.onHit ? { onHit: weapon.onHit } : {}),
    };
  }
  return { name: "bare hands", dice: "1d2", stat: "STR", reach: "close", skillId: "unarmed" };
}

/** Is the target inside this reach right now? Bands compare bands; the grid checks tiles and sight. */
export function inReach(ctx: StepContext, target: Enemy, reach: RangeBand): boolean {
  return BAND[target.range] <= BAND[reach];
}

export function playerAttack(ctx: StepContext, target: Enemy): void {
  if (!beginTurn(ctx)) return;
  const combat = ctx.game.combat!;
  const c = ctx.crawler;
  const w = playerWeapon(ctx);

  if (fearBlocks(ctx, "Fear locks your legs. You can only try to flee.")) return;
  if (hasFlag(c.statuses, ctx.content, "randomTarget")) {
    const options = aliveEnemies(ctx).filter((enemy) => !hasFlag(enemy.statuses, ctx.content, "untargetable"));
    if (options.length > 0) {
      target = pick(options);
      ctx.fight(`Confusion picks a target for you: ${target.name}.`, "status");
    }
  }
  if (hasFlag(target.statuses, ctx.content, "untargetable")) {
    ctx.error(`${target.name} can't be targeted right now.`);
    return;
  }

  if (!inReach(ctx, target, w.reach)) {
    if (canUseMinor(ctx)) {
      stepBands(ctx, -1);
      combat.minorActionsUsed += 1;
    }
    if (!inReach(ctx, target, w.reach)) {
      ctx.say("combat.cantReach");
      finishRound(ctx);
      return;
    }
  }

  resolvePlayerHit(ctx, target, w);
  finishRound(ctx);
}

/** An enemy's defense right now, including status shifts to DEX and defense. */
export function enemyDefense(ctx: StepContext, e: Enemy): number {
  const mods = statusModifiers(e, ctx);
  const dex = e.stats.DEX + modTotal(mods, "stat:DEX");
  return e.defense + Math.floor(dex / 2) - Math.floor(e.stats.DEX / 2) + modTotal(mods, "defense");
}

/** One weapon swing: to-hit, damage, crits, on-hit statuses, the kill. Doesn't end the turn. */
export function resolvePlayerHit(ctx: StepContext, target: Enemy, w: WeaponProfile, opts: { bonus?: number; note?: string } = {}): boolean {
  const c = ctx.crawler;
  const mods = collectModifiers(c, ctx.content);
  const d = derive(c, ctx.content);
  const skillRank = w.skillId ? (c.skills[w.skillId]?.rank ?? 0) : 0;
  const hitMod = d.stats[w.stat] + skillRank + modTotal(mods, "attack", "hit") + (opts.bonus ?? 0);
  const nat = d20();
  const total = nat + hitMod;
  const crit = nat === 20;
  const targetDefense = enemyDefense(ctx, target);
  const hit = crit || (nat !== 1 && total >= targetDefense);
  const note = opts.note ? ` ${opts.note}` : "";
  for (const name of consumeFlaggedStatuses(c.statuses, ctx, "breaksOnAttack")) {
    ctx.fight(`${name} ends when you attack.`, "status");
  }

  if (!hit) {
    ctx.fight(`You attack the ${target.name} with ${w.name}: d20(${nat})+${hitMod}${note} = ${total} vs ${targetDefense}. Miss.`, "you");
    if (nat === 1) ctx.say("combat.critFail", { target: target.name });
    else if (chance(0.3)) ctx.say("combat.playerMiss");
    return false;
  }
  let dmg = rollDice(w.dice).total + (crit ? rollDice(w.dice).total : 0);
  dmg += Math.floor(d.stats[w.stat] / 2) + modTotal(mods, "damage");
  dmg = Math.max(1, dmg);
  target.hp -= dmg;
  ctx.fight(
    `You ${crit ? "CRIT" : "hit"} the ${target.name} with ${w.name}: d20(${nat})+${hitMod}${note} = ${total} vs ${targetDefense} — ${dmg} damage${target.hp > 0 ? ` (${target.hp}/${target.maxHP})` : ""}.`,
    "you",
  );
  if (crit) ctx.say("combat.crit");
  if (target.hp <= 0) {
    ctx.fight(`The ${target.name} drops.`, "you");
    ctx.say("combat.kill", { target: target.name });
  } else if (w.onHit && chance(w.onHit.chance)) {
    const def = ctx.content.statusEffects.get(w.onHit.id);
    if (applyStatus(target.statuses, def, w.onHit.duration) !== "ignored") {
      ctx.fight(`The ${target.name} is ${def.name.toLowerCase()}.`, "status");
    }
  }
  return true;
}

/** Damage an enemy from something other than a weapon swing (items, hazards, slams). */
export function damageEnemy(ctx: StepContext, e: Enemy, dmg: number, how: string): void {
  if (e.hp <= 0) return;
  e.hp -= dmg;
  ctx.fight(`${how} — ${dmg} damage to the ${e.name}${e.hp > 0 ? ` (${e.hp}/${e.maxHP})` : ""}.`, "you");
  if (e.hp <= 0) {
    ctx.fight(`The ${e.name} drops.`, "you");
    ctx.say("combat.kill", { target: e.name });
  }
}

// ---------------------------------------------------------------- flee / talk / move

export function playerFlee(ctx: StepContext): void {
  if (!beginTurn(ctx)) return;
  const combat = ctx.game.combat!;
  if (fleeContest(ctx, aliveEnemies(ctx))) {
    leaveCombat(ctx, combat.fromRoom);
    return;
  }
  // The failed flee IS the opening: every enemy that can reach takes one free swing.
  freeSwings(ctx, aliveEnemies(ctx));
  closeRound(ctx);
}

/** DEX contest against the fastest pursuer. Logs and narrates; returns true on a clean getaway. */
export function fleeContest(ctx: StepContext, against: Enemy[]): boolean {
  if (against.length === 0) {
    ctx.fight("Nobody's close enough to stop you.", "you");
    ctx.say("combat.fleeSuccess");
    return true;
  }
  const c = ctx.crawler;
  const mods = collectModifiers(c, ctx.content);
  const d = derive(c, ctx.content);
  const mine = d20() + d.stats.DEX + modTotal(mods, "flee", "skill:dodge");
  const best = against.reduce((m, e) => Math.max(m, e.stats.DEX), 0);
  const theirs = d20() + best;
  if (mine > theirs) {
    ctx.fight(`You bolt: ${mine} vs ${theirs}. Clean getaway.`, "you");
    ctx.say("combat.fleeSuccess");
    return true;
  }
  ctx.fight(`You bolt: ${mine} vs ${theirs}. They're faster.`, "you");
  ctx.say("combat.fleeFail");
  return false;
}

/** End the fight as a flight and put the crawler in `toRoom` (no time cost: you ran). */
export function leaveCombat(ctx: StepContext, toRoom: number): void {
  endCombat(ctx);
  ctx.emit({ type: "combatEnded", outcome: "fled" });
  ctx.setPhase("exploring");
  const floor = ctx.game.floor;
  if (floor && toRoom !== floor.currentRoom) enterRoom(ctx, toRoom, "revisit");
}

/** Every listed enemy that has a usable attack swings once, outside the turn order. */
export function freeSwings(ctx: StepContext, enemies: Enemy[]): void {
  for (const e of enemies) {
    if (ctx.game.phase !== "combat" || e.hp <= 0) continue;
    const attack = pickAttack(ctx, e);
    if (attack) enemyStrike(ctx, e, attack);
  }
}

export function playerTalk(ctx: StepContext): void {
  const listeners = aliveEnemies(ctx).filter((e) => e.talkable);
  if (listeners.length === 0) {
    ctx.error("Nothing here is interested in your material.");
    return;
  }
  if (!beginTurn(ctx)) return;
  if (fearBlocks(ctx, "Fear leaves you with nothing to say but goodbye.")) return;
  const c = ctx.crawler;
  const d = derive(c, ctx.content);
  const rank = c.skills["persuasion"]?.rank ?? 0;
  const dc = dcFor("medium", ctx.game.floor?.floor ?? 1);
  const nat = d20();
  const total = nat + d.stats.CHA + rank;
  if (nat !== 1 && (nat === 20 || total >= dc)) {
    let xp = 0;
    for (const e of listeners) {
      e.hp = 0;
      e.fate = "pacified";
      xp += Math.ceil(e.xp / 2);
      ctx.fight(`The ${e.name} hears you out, shrugs, and wanders off.`, "enemy");
    }
    c.xp += xp;
    ctx.fight(`Persuasion: d20(${nat})+${d.stats.CHA + rank} = ${total} vs DC ${dc}. They buy it. +${xp} XP.`, "you");
    ctx.say("combat.talkSuccess");
    if (aliveEnemies(ctx).length > 0) finishRound(ctx);
    else checkVictory(ctx);
    return;
  }
  ctx.fight(`Persuasion: d20(${nat})+${d.stats.CHA + rank} = ${total} vs DC ${dc}. No sale.`, "you");
  ctx.say("combat.talkFail");
  finishRound(ctx);
}

/** Minor action (bands): shift every enemy one band (you reposition relative to the pack). */
export function playerStep(ctx: StepContext, delta: 1 | -1): void {
  const combat = ctx.game.combat!;
  if (!canUseMinor(ctx)) {
    ctx.error("You've already moved this round.");
    return;
  }
  combat.minorActionsUsed += 1;
  stepBands(ctx, delta);
}

/** Spend the turn doing nothing useful. */
export function playerWait(ctx: StepContext): void {
  if (!beginTurn(ctx)) return;
  ctx.fight("You hold your ground and wait.", "you");
  finishRound(ctx);
}

/** Minor-action budget: slowed allows none, hasted allows two. */
export function minorLimit(statuses: StatusInstance[], content: Content): number {
  if (hasFlag(statuses, content, "noMinor")) return 0;
  return hasFlag(statuses, content, "extraMinor") ? 2 : 1;
}

function canUseMinor(ctx: StepContext): boolean {
  return ctx.game.combat!.minorActionsUsed < minorLimit(ctx.crawler.statuses, ctx.content);
}

function stepBands(ctx: StepContext, delta: 1 | -1): void {
  for (const e of aliveEnemies(ctx)) {
    e.range = BANDS[Math.max(0, Math.min(2, BAND[e.range] + delta))]!;
  }
  ctx.fight(delta < 0 ? "You close in." : "You fall back a step.", "you");
}

/**
 * Push or pull one enemy a band (shoves now; Claude's "move range band" ruling in
 * Milestone 10). Returns false if it was already at the edge.
 */
export function shiftEnemyBand(e: Enemy, delta: 1 | -1): boolean {
  const next = Math.max(0, Math.min(2, BAND[e.range] + delta));
  if (next === BAND[e.range]) return false;
  e.range = BANDS[next]!;
  return true;
}

// ---------------------------------------------------------------- items

/** True if every effect is aimed at an enemy (nothing to do without one). */
export function needsEnemy(def: Consumable): boolean {
  return def.effects.length > 0 && def.effects.every((e) => e.target === "target" || e.target === "all_enemies");
}

/** Who an item's effects land on. Effects with no target (or "self"/"all_allies") hit the crawler. */
export interface EffectTargets {
  /** Hit by `target` effects. */
  primary?: Enemy;
  /** Hit by `all_enemies` effects. */
  area: Enemy[];
  /** Grid: the crawler is standing inside their own splash. */
  selfInArea?: boolean;
}

/** Remove one of a stack from the pack; drops the entry (and any equip slot) at zero. */
export function consumeOne(ctx: StepContext, item: ItemInstance): void {
  const c = ctx.crawler;
  item.qty -= 1;
  if (item.qty > 0) return;
  c.inventory.splice(c.inventory.findIndex((i) => i.uid === item.uid), 1);
  for (const [slot, uid] of Object.entries(c.equipment)) {
    if (uid === item.uid) delete c.equipment[slot as keyof typeof c.equipment];
  }
}

export function playerUseItem(ctx: StepContext, item: ItemInstance, targets?: EffectTargets): void {
  const consumable = ctx.content.items.consumables.byId[item.baseId];
  if (!consumable) {
    ctx.error(`${item.name} isn't something you can use.`);
    return;
  }
  if (consumable.effects.length === 0) {
    ctx.error(`${item.name} doesn't do anything on its own. Maybe combine it with something.`);
    return;
  }
  const fighting = inCombat(ctx);
  if (fighting && !consumable.usableInCombat) {
    ctx.error(`${item.name} takes more peace and quiet than you currently have.`);
    return;
  }
  if (!fighting && needsEnemy(consumable)) {
    ctx.error(`${item.name} is for throwing at something. Nothing here deserves it yet.`);
    return;
  }
  if (fighting && !beginTurn(ctx)) return;
  if (fighting && fearBlocks(ctx, "Fear makes using an item seem like a long-term plan.")) return;

  let t: EffectTargets = targets ?? { area: [] };
  if (fighting && !targets) {
    const foes = aliveEnemies(ctx).filter((e) => !hasFlag(e.statuses, ctx.content, "untargetable"));
    t = { area: foes, ...(foes[0] ? { primary: foes[0] } : {}) };
  }
  consumeOne(ctx, item);
  const applied = applyItemEffects(ctx, consumable, t);
  const summary = applied.length ? ` (${applied.join(", ")})` : "";
  if (fighting) {
    ctx.fight(`You use ${item.name}${summary}.`, "you");
    if (ctx.crawler.hp <= 0) {
      endCombat(ctx);
      killCrawler(ctx, item.name);
      return;
    }
    if (!enemiesLeft(ctx)) checkVictory(ctx);
    else finishRound(ctx);
  } else {
    ctx.describe(`You use ${item.name}${summary}.`);
    if (ctx.crawler.hp <= 0) killCrawler(ctx, item.name);
  }
}

function enemiesLeft(ctx: StepContext): boolean {
  return aliveEnemies(ctx).length > 0;
}

/** Apply a consumable's effects to whoever they're aimed at. Returns short log fragments. */
export function applyItemEffects(ctx: StepContext, def: Consumable, t: EffectTargets): string[] {
  const applied: string[] = [];
  for (const e of def.effects) {
    const value = typeof e.value === "number" ? e.value : e.value ? rollDice(e.value).total : 0;
    const enemies = e.target === "target" ? (t.primary ? [t.primary] : [])
      : e.target === "all_enemies" ? t.area
      : null;
    if (enemies) for (const en of enemies) applyEffectToEnemy(ctx, en, e, value, applied);
    if (enemies === null || (e.target === "all_enemies" && t.selfInArea)) applyEffectToCrawler(ctx, e, value, applied);
  }
  return applied;
}

function applyEffectToCrawler(ctx: StepContext, e: Effect, value: number, applied: string[]): void {
  const c = ctx.crawler;
  const d = derive(c, ctx.content);
  switch (e.kind) {
    case "heal":
      if (e.flag === "mp") {
        const before = c.mp;
        c.mp = Math.min(d.maxMP, c.mp + value);
        applied.push(`+${c.mp - before} MP`);
      } else {
        const before = c.hp;
        c.hp = Math.min(d.maxHP, c.hp + value);
        applied.push(`+${c.hp - before} HP`);
      }
      return;
    case "damage": {
      const mods = collectModifiers(c, ctx.content);
      const dmg = Math.max(1, value - modTotal(mods, `resist:${e.damageType ?? "physical"}`));
      c.hp = Math.max(0, c.hp - dmg);
      applied.push(`-${dmg} HP to you`);
      return;
    }
    case "cure": {
      const i = c.statuses.findIndex((s) => s.id === e.statusId);
      if (i >= 0) {
        c.statuses.splice(i, 1);
        applied.push(`cured ${ctx.content.statusEffects.byId[e.statusId!]?.name ?? e.statusId}`);
      }
      return;
    }
    case "status":
      if (e.statusId) {
        const def = ctx.content.statusEffects.get(e.statusId);
        applyStatus(c.statuses, def, e.duration);
        applied.push(`you: ${def.name.toLowerCase()}`);
      }
      return;
    case "xp":
      c.xp += value;
      applied.push(`+${value} XP`);
      return;
    case "loot":
      if (e.flag === "gold") {
        c.gold += value;
        applied.push(`+${value} gold`);
      }
      return;
    default:
      // stat buffs, mood, flags: their systems arrive in later milestones.
      return;
  }
}

function applyEffectToEnemy(ctx: StepContext, en: Enemy, e: Effect, value: number, applied: string[]): void {
  if (en.hp <= 0) return;
  switch (e.kind) {
    case "damage":
      en.hp -= Math.max(1, value);
      applied.push(`${Math.max(1, value)} to the ${en.name}`);
      if (en.hp <= 0) {
        ctx.fight(`The ${en.name} drops.`, "you");
        ctx.say("combat.kill", { target: en.name });
      }
      return;
    case "status":
      if (e.statusId) {
        const def = ctx.content.statusEffects.get(e.statusId);
        if (applyStatus(en.statuses, def, e.duration) !== "ignored") applied.push(`${en.name} ${def.name.toLowerCase()}`);
      }
      return;
    case "cure": {
      const i = en.statuses.findIndex((s) => s.id === e.statusId);
      if (i >= 0) en.statuses.splice(i, 1);
      return;
    }
    case "heal":
      en.hp = Math.min(en.maxHP, en.hp + value);
      applied.push(`the ${en.name} +${value} HP (why)`);
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------- enemy turn

/** Can this attack hit the crawler from where the enemy is right now? */
export function attackUsable(ctx: StepContext, e: Enemy, a: LiveAttack): boolean {
  return a.ready === 0 && BAND[e.range] <= BAND[a.range];
}

export function pickAttack(ctx: StepContext, e: Enemy, specialsOnly = false): LiveAttack | undefined {
  const usable = e.attacks.filter((a) => attackUsable(ctx, e, a));
  const candidates = specialsOnly ? usable.filter((a) => a.cooldown) : usable;
  return candidates.length > 0 ? pick(candidates) : undefined;
}

function enemyTurn(ctx: StepContext, e: Enemy): void {
  if (e.hp <= 0) return;
  try {
    if (enemyTurnPreamble(ctx, e)) runEnemyTurnBands(ctx, e);
  } finally {
    for (const name of decrementStatuses(e.statuses, ctx.content)) {
      ctx.fight(`${e.name} is no longer ${name.toLowerCase()}.`, "status");
    }
  }
}

/** Status ticks, stun and charm. Returns false if the enemy's turn is over before it starts. */
function enemyTurnPreamble(ctx: StepContext, e: Enemy): boolean {
  if (e.hp <= 0) return false;
  for (const t of tickStatuses(e.statuses, ctx.content)) {
    e.hp -= t.amount;
    ctx.fight(`The ${e.name} takes ${t.amount} from ${t.status.toLowerCase()}.`, "status");
  }
  if (e.hp <= 0) {
    ctx.fight(`The ${e.name} succumbs.`, "status");
    ctx.say("combat.kill", { target: e.name });
    return false;
  }
  if (hasFlag(e.statuses, ctx.content, "skipTurn")) {
    ctx.fight(`The ${e.name} is stunned and does nothing. Savor it.`, "status");
    return false;
  }
  if (hasFlag(e.statuses, ctx.content, "noAttackCharmer")) {
    ctx.fight(`${e.name} is too busy admiring you to attack.`, "enemy");
    return false;
  }
  return true;
}

/** Does this enemy want out (fear, an AI flee threshold, a cowardly mod)? */
export function wantsToFlee(ctx: StepContext, e: Enemy, token: string): boolean {
  const fleeMatch = /^flee_below_(\d+)$/.exec(token);
  return hasFlag(e.statuses, ctx.content, "fleeOnly") ||
    (fleeMatch !== null && e.hp / e.maxHP < Number(fleeMatch[1]) / 100) ||
    (e.fleeBelow > 0 && e.hp / e.maxHP < e.fleeBelow);
}

export function markFled(ctx: StepContext, e: Enemy): void {
  e.hp = 0;
  e.fate = "fled";
  ctx.fight(`The ${e.name} breaks and scrambles into the dark.`, "enemy");
  ctx.say("combat.enemyFled", { target: e.name });
}

function runEnemyTurnBands(ctx: StepContext, e: Enemy): void {
  let repositioned = false;
  for (const priority of e.ai) {
    if (wantsToFlee(ctx, e, priority)) {
      const d = derive(ctx.crawler, ctx.content);
      if (d20() + e.stats.DEX > d20() + d.stats.DEX) markFled(ctx, e);
      else ctx.fight(`The ${e.name} tries to bolt and can't find an opening.`, "enemy");
      return;
    }
    if (priority === "special_if_ready") {
      const special = pickAttack(ctx, e, true);
      if (special) {
        enemyStrike(ctx, e, special);
        return;
      }
    }
    if (priority === "keep_range" && BAND[e.range] < BAND[e.preferRange]) {
      e.range = BANDS[BAND[e.range] + 1]!;
      repositioned = true;
      ctx.fight(`The ${e.name} skitters back to ${e.range} range.`, "enemy");
    }
    if (priority === "attack") {
      const attack = pickAttack(ctx, e);
      if (attack) {
        enemyStrike(ctx, e, attack);
        return;
      }
    }
  }
  let attack = pickAttack(ctx, e);
  if (!attack) {
    // step toward a band where something works
    if (BAND[e.range] > 0) {
      e.range = BANDS[BAND[e.range] - 1]!;
      ctx.fight(`The ${e.name} closes to ${e.range} range.`, "enemy");
    }
    attack = pickAttack(ctx, e);
    if (!attack) {
      if (!repositioned) ctx.fight(`The ${e.name} circles, looking for an angle.`, "enemy");
      return;
    }
  }
  enemyStrike(ctx, e, attack);
}

export function enemyStrike(ctx: StepContext, e: Enemy, attack: LiveAttack, opts: { hitBonus?: number; note?: string } = {}): void {
  const c = ctx.crawler;
  const mods = collectModifiers(c, ctx.content);
  const d = derive(c, ctx.content);
  if (attack.cooldown) attack.ready = attack.cooldown;
  const enemyMods = statusModifiers(e, ctx);
  const statMod = e.stats[attack.stat] + modTotal(enemyMods, `stat:${attack.stat}`);
  const nat = d20();
  const hitMod = statMod + modTotal(enemyMods, "attack", "hit") + (opts.hitBonus ?? 0);
  const total = nat + hitMod;
  const crit = nat === 20;
  const note = opts.note ? ` ${opts.note}` : "";
  const defense = d.defense + (hasFlag(c.statuses, ctx.content, "untargetable") ? 5 : 0);
  const hit = !hasFlag(c.statuses, ctx.content, "untargetable") && (crit || (nat !== 1 && total >= defense));
  if (!hit) {
    ctx.fight(`${e.name} — ${attack.name}: d20(${nat})+${hitMod}${note} = ${total} vs your ${defense}. Miss.`, "enemy");
    return;
  }
  // Enemies add stat/4 where the crawler adds stat/2: the player's damage edge (see DECISIONS.md).
  let dmg = rollDice(attack.dice).total + (crit ? rollDice(attack.dice).total : 0) + Math.floor(statMod / 4);
  dmg -= modTotal(mods, "damageReduction", "dr", `resist:${attack.damageType}`);
  dmg = Math.max(1, dmg);
  c.hp -= dmg;
  ctx.fight(
    `${e.name} — ${attack.name}${crit ? " (CRIT)" : ""}: d20(${nat})+${hitMod}${note} = ${total} vs your ${defense} — ${dmg} ${attack.damageType} damage. You: ${Math.max(0, c.hp)}/${d.maxHP}.`,
    "enemy",
  );
  if (attack.status && c.hp > 0 && chance(attack.status.chance)) {
    const def = ctx.content.statusEffects.get(attack.status.id);
    const what = applyStatus(c.statuses, def, attack.status.duration);
    if (what !== "ignored") ctx.fight(`You are ${def.name.toLowerCase()}.`, "status");
  }
  if (c.hp <= 0) killInCombat(ctx, `a ${e.name}`);
}

/**
 * Hurt the crawler from anything that isn't an enemy swing (hazards, your own
 * molotov). Applies damage-type resistance. Kills end the fight.
 */
export function damageCrawler(ctx: StepContext, raw: number, damageType: string, cause: string): number {
  const c = ctx.crawler;
  const mods = collectModifiers(c, ctx.content);
  const dmg = Math.max(1, raw - modTotal(mods, "damageReduction", `resist:${damageType}`));
  c.hp -= dmg;
  if (c.hp <= 0) killInCombat(ctx, cause);
  return dmg;
}

function killInCombat(ctx: StepContext, cause: string): void {
  endCombat(ctx);
  killCrawler(ctx, cause);
}

// ---------------------------------------------------------------- endings

export function checkVictory(ctx: StepContext): void {
  if (ctx.game.phase !== "combat") return;
  if (aliveEnemies(ctx).length > 0) return;
  const combat = ctx.game.combat!;
  const xp = combat.enemies.reduce((sum, e) => sum + (e.hp <= 0 && !e.fate ? e.xp : 0), 0);
  // talked enemies already paid half in playerTalk; fled ones pay nothing
  ctx.crawler.xp += xp;
  endCombat(ctx);
  ctx.emit({ type: "combatEnded", outcome: "victory", xp });
  ctx.say("combat.victory", { xp });
  ctx.setPhase("exploring");
}

export function endCombat(ctx: StepContext): void {
  ctx.game.combat = null;
}

export function statusModifiers(e: Enemy, ctx: StepContext) {
  return e.statuses.flatMap((s) => {
    const def = ctx.content.statusEffects.byId[s.id];
    return def ? def.modifiers.map((m) => ({ ...m, value: m.value * s.stacks })) : [];
  });
}

function consumeFlaggedStatuses(statuses: StatusInstance[], ctx: StepContext, flag: string): string[] {
  const removed: string[] = [];
  for (let i = statuses.length - 1; i >= 0; i--) {
    const status = statuses[i]!;
    if (hasFlag([status], ctx.content, flag)) {
      removed.push(ctx.content.statusEffects.byId[status.id]?.name ?? status.id);
      statuses.splice(i, 1);
    }
  }
  return removed;
}

/** Find a living enemy by (part of) its name. */
export function findEnemy(ctx: StepContext, query: string): Enemy | undefined {
  const q = query.toLowerCase();
  const foes = aliveEnemies(ctx);
  return foes.find((e) => e.name.toLowerCase() === q) ?? foes.find((e) => e.name.toLowerCase().includes(q));
}

/** Enemy strip for `look` in combat. */
export function combatSummary(ctx: StepContext): string[] {
  return aliveEnemies(ctx).map((e) => {
    const st = e.statuses.map((s) => ctx.content.statusEffects.byId[s.id]?.name ?? s.id).join(", ");
    return `${e.name}  ${e.hp}/${e.maxHP} HP  [${e.range}]${st ? `  (${st})` : ""}`;
  });
}
