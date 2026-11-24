/**
 * Combat (spec: Core rules / Combat). Initiative is rolled once; enemies that
 * beat the crawler act first in round 1, after that each round is the player's
 * action followed by every living enemy in initiative order.
 *
 * A turn is 3 action points (rules/ap.ts): everything costs some and the turn
 * ends itself at zero. Attacks are power rolls (rules/power.ts): 2d10 + stat,
 * three damage tiers, and nothing ever misses.
 *
 * Two modes share every roll in this file (power rolls, statuses, flee
 * contest, item effects): "bands" keeps the original three range bands per
 * enemy, "grid" (Milestone 4b) puts everyone on a small tactical arena and
 * derives the bands from tile distance. The mode is fixed when the fight starts.
 */
import type { Content } from "./content/load";
import type { Consumable, Effect, EnemyAttack, Modifier, Power, RangeBand } from "./content/schemas";
import { assignMarks, generateGroup, TIER, type EncounterKind } from "./gen/enemy";
import { enterRoom, advanceTime, TIME_COST } from "./explore";
import { dcFor } from "./rules/checks";
import { rollDice } from "./rules/dice";
import { collectModifiers, derive, modTotal } from "./rules/derived";
import { applyStatus, decrementStatuses, hasFlag, tickStatuses } from "./rules/effects";
import { AP_COST, turnAp } from "./rules/ap";
import { describePower, guardShift, powerRoll, type PowerRoll } from "./rules/power";
import { heldWeapon, profileOf, swingNumbers, type WeaponProfile } from "./gear";
import { chance, d20, pick } from "./rng";
import { killCrawler, type StepContext } from "./step";
import type { GameEventBody } from "./events";
import {
  combatModeOf, type CombatMode, type CombatState, type Enemy, type ItemInstance, type Room, type StatusInstance,
} from "./state";
import { buildArena, entrySide } from "./grid/arena";
import { coord, parseCoord, reaches } from "./grid/geometry";
import { runEnemyTurnGrid } from "./grid/ai";
import { igniteUnder } from "./grid/fire";
import { approachCost, approachTarget, gridFlee, moveBudget } from "./grid/play";
import { ageHazards, packBonus, standInHazard, syncBands } from "./grid/units";
import { dropTurnStatuses } from "./maneuvers";
import { rollLoot } from "./gen/loot";
import { generateItem, itemLevelFor, potencyFor } from "./gen/item";
import { addToPile } from "./inventory";
import { announceLevels, fightSkillSummary, gainXp, SKILL_CAP, skillRank, trainSkill, xpToNext } from "./progression";
import { int } from "./rng";
import { bossDefeated, bossTaunt, startBossFight } from "./boss";
import { coatedHit, glowFlare, neutralizePoison, pingInitiative, cantMove } from "./modules";
import { maybeUrge, shiftTemper } from "./echo";

export const BAND: Record<RangeBand, number> = { close: 0, near: 1, far: 2 };
export const BANDS: RangeBand[] = ["close", "near", "far"];

export type LiveAttack = EnemyAttack & { ready: number };

export function aliveEnemies(ctx: StepContext): Enemy[] {
  return ctx.game.combat?.enemies.filter((e) => e.hp > 0) ?? [];
}

export function inCombat(ctx: StepContext): boolean {
  return ctx.game.phase === "combat" && ctx.game.combat !== null;
}

export function isGrid(ctx: StepContext): boolean {
  return ctx.game.combat?.mode === "grid" && ctx.game.combat.arena !== undefined;
}

// ---------------------------------------------------------------- encounters

/** Encounter odds by room type. Lairs always fight (elite); corridors roll every entry. */
export function maybeEncounter(ctx: StepContext, room: Room, firstVisit: boolean, cameFrom?: number): boolean {
  if (ctx.game.phase !== "exploring") return false;
  const floor = ctx.game.floor!;
  // A living floor boss fights every time you walk into its room.
  if (room.boss && !floor.bossDefeated) {
    startBossFight(ctx, room, cameFrom ?? floor.currentRoom);
    return true;
  }
  // The floor's first few fights come from the easy pool, wherever they happen:
  // a lair you stumble into that early has a couple of squatters, not its elite.
  const theme = ctx.content.floors.byId[floor.theme];
  const easy = (floor.fights ?? 0) < (theme?.encounters.easyFights ?? 0);
  let kind: EncounterKind = room.type === "corridor" ? "corridor" : "pack";
  let p = 0;
  if (room.type === "lair") { p = firstVisit ? 1 : 0.2; if (firstVisit && !easy) kind = "elite"; }
  else if (room.type === "chamber") p = firstVisit ? 0.35 : 0.06;
  else if (room.type === "corridor") p = 0.08;
  else if (room.type === "event" || room.type === "npc" || room.type === "puzzle") p = firstVisit ? 0.15 : 0.05;
  if (p <= 0 || !chance(p)) return false;
  const enemies = generateGroup(floor.floor, kind, ctx.content, { easy });
  if (enemies.length === 0) return false;
  startCombat(ctx, enemies, { fromRoom: cameFrom ?? floor.currentRoom });
  return true;
}

export interface StartOptions {
  /** Where the crawler walked in from; fleeing back out lands there. Defaults to the current room. */
  fromRoom?: number;
  /** Override the account setting (tests, the sim). */
  mode?: CombatMode;
  /** A floor boss fight (boss.ts). */
  boss?: NonNullable<CombatState["boss"]>;
  /** Said after the enemies are listed and before any ambush turn (a boss's intro). */
  prelude?: (ctx: StepContext) => void;
}

export function startCombat(ctx: StepContext, enemies: Enemy[], opts: StartOptions = {}): void {
  const floor = ctx.game.floor!;
  const d = derive(ctx.crawler, ctx.content);
  const rolled = d20() + d.initiativeBonus;
  for (const e of enemies) e.initiative += d20() + e.stats.DEX;
  // Nervous Ping can hear an ambush coming (and its Calm variant adds initiative).
  const playerInit = pingInitiative(ctx, rolled, enemies);
  enemies.sort((a, b) => b.initiative - a.initiative);
  if (!enemies.some((e) => e.mark)) assignMarks(enemies);

  const mode = opts.mode ?? combatModeOf(ctx.account);
  const fromRoom = opts.fromRoom ?? floor.currentRoom;
  floor.fights = (floor.fights ?? 0) + 1;
  const ap = turnAp(ctx.crawler.statuses, ctx.content);
  ctx.game.combat = {
    mode,
    enemies,
    round: 1,
    playerInitiative: playerInit,
    ap,
    apMax: ap,
    turnBegun: false,
    fromRoom,
    ...(opts.boss ? { boss: opts.boss } : {}),
  };
  if (mode === "grid") {
    const room = floor.rooms[floor.currentRoom]!;
    const theme = ctx.content.floors.get(floor.theme);
    // The room's loose junk ends up underfoot, plus a little scrap. It goes back on the floor when the fight ends.
    const items = room.items ?? [];
    delete room.items;
    if (theme.arena.scrap) {
      const table = ctx.content.lootTables.get(theme.arena.scrap);
      for (let n = int(0, 2); n > 0; n--) items.push(rollLoot(table, ctx.content, floor.floor));
    }
    ctx.game.combat.arena = buildArena({
      room,
      theme,
      entry: entrySide(room, fromRoom),
      enemies,
      ambushers: new Set(enemies.filter((e) => e.initiative > playerInit).map((e) => e.uid)),
      items,
    }, ctx.content);
    syncBands(ctx);
  }
  ctx.setPhase("combat");
  ctx.emit({ type: "combatStarted", names: enemies.map((e) => e.name) });
  ctx.say("combat.start");
  for (const e of enemies) {
    const at = e.pos ? `at ${coord(e.pos)}` : `${e.range} range`;
    ctx.fight(`${e.name} — level ${e.level}${e.tier === "boss" ? " BOSS" : e.tier === "elite" ? " ELITE" : e.tier === "minion" ? " minion" : ""}, ${at}.`, "enemy");
  }
  opts.prelude?.(ctx);
  glowFlare(ctx);
  maybeUrge(ctx, "combat");
  // Ambush: anyone who beat your initiative gets their round-1 turn now.
  for (const e of enemies) {
    if (e.initiative > playerInit && ctx.game.phase === "combat") enemyTurn(ctx, e);
  }
}

// ---------------------------------------------------------------- round flow

/** Is there AP for this? Says why not if there isn't (and the turn carries on). */
export function canAfford(ctx: StepContext, cost: number, what: string): boolean {
  const ap = ctx.game.combat!.ap;
  if (ap >= cost) return true;
  ctx.error(`${what} takes ${cost} AP and you have ${ap}. Do something cheaper, or \`wait\` to end the turn.`);
  return false;
}

export function spendAp(ctx: StepContext, cost: number): void {
  const combat = ctx.game.combat;
  if (combat) combat.ap = Math.max(0, combat.ap - cost);
}

/** After anything the crawler does: victory if nothing's left standing; out of AP ends the turn. */
export function afterAction(ctx: StepContext): void {
  if (ctx.game.phase !== "combat") return;
  if (aliveEnemies(ctx).length === 0) {
    checkVictory(ctx);
    return;
  }
  if (ctx.game.combat!.ap <= 0) finishRound(ctx);
}

/** Runs when the crawler's turn is over: remaining enemies act, then the round closes. */
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
  for (const sp of Object.values(c.spells)) sp.cooldown = Math.max(0, sp.cooldown - 1);
  combat.ap = 0;
  combat.turnBegun = false;
  if (combat.arena) combat.arena.moveLeft = 0;
  ageHazards(ctx);
  combat.round += 1;
  advanceTime(ctx, TIME_COST.combatRound);
}

/**
 * Start of the crawler's turn: statuses tick and the AP pool refills. Idempotent within a round, so an
 * action that is rejected after this (bad target) doesn't tick a second time
 * when the player tries again. Returns false if the turn is already lost.
 */
export function beginTurn(ctx: StepContext): boolean {
  const combat = ctx.game.combat!;
  if (combat.turnBegun) return true;
  combat.turnBegun = true;
  dropTurnStatuses(ctx);
  const c = ctx.crawler;
  neutralizePoison(ctx, true);
  for (const t of tickStatuses(c.statuses, ctx.content)) {
    c.hp = Math.min(derive(c, ctx.content).maxHP, c.hp - t.amount);
    ctx.fight(t.amount > 0 ? `${t.status} costs you ${t.amount} HP.` : `${t.status} restores ${-t.amount} HP.`, "status");
  }
  if (c.hp <= 0) {
    endCombat(ctx);
    killCrawler(ctx, "their own wounds");
    return false;
  }
  combat.apMax = combat.ap = turnAp(c.statuses, ctx.content);
  if (combat.arena) {
    combat.arena.moveLeft = 0;
    standInHazard(ctx, "crawler");
    if (ctx.game.phase !== "combat") return false;
  }
  if (hasFlag(c.statuses, ctx.content, "skipTurn")) {
    ctx.fight("You are stunned and lose the turn.", "status");
    finishRound(ctx);
    return false;
  }
  return true;
}

/** Fear: the only action left is running. Spends the turn if it bites. */
export function fearBlocks(ctx: StepContext, line: string): boolean {
  if (!hasFlag(ctx.crawler.statuses, ctx.content, "fleeOnly")) return false;
  ctx.fight(line, "status");
  finishRound(ctx);
  return true;
}

// ---------------------------------------------------------------- player attacks

export type { WeaponProfile } from "./gear";

export function playerWeapon(ctx: StepContext): WeaponProfile {
  return profileOf(ctx.content, heldWeapon(ctx.crawler), ctx.crawler);
}

/** Is the target inside this reach right now? Bands compare bands; the grid checks tiles and sight. */
export function inReach(ctx: StepContext, target: Enemy, reach: RangeBand): boolean {
  const a = ctx.game.combat?.arena;
  if (a && target.pos) return reaches(a, ctx.content, a.crawler, target.pos, reach);
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
  if (!canAfford(ctx, w.apCost, `Swinging ${w.name}`)) return;

  if (!inReach(ctx, target, w.reach)) {
    if (isGrid(ctx)) {
      if (approachCost(ctx, target, w.reach) > moveBudget(ctx, w.apCost)) {
        // Too far to get there and still swing: spend the turn closing the distance instead.
        const from = { ...combat.arena!.crawler };
        approachTarget(ctx, target, w.reach, moveBudget(ctx));
        if (ctx.game.phase !== "combat") return;
        const at = combat.arena!.crawler;
        if (from.x === at.x && from.y === at.y) {
          ctx.error(`There's no way to get any closer to the ${target.name} from here.`);
          return;
        }
        ctx.fight(`The ${target.name} is too far to reach and still swing this turn.`, "status");
        afterAction(ctx);
        return;
      }
      approachTarget(ctx, target, w.reach, moveBudget(ctx, w.apCost));
      if (ctx.game.phase !== "combat") return;
    } else {
      const steps = BAND[target.range] - BAND[w.reach];
      if (combat.ap < w.apCost + steps * AP_COST.move) {
        // Not enough AP to close in and swing: close in as far as the AP goes.
        for (let n = 0; n < steps && combat.ap >= AP_COST.move; n++) {
          spendAp(ctx, AP_COST.move);
          stepBands(ctx, -1);
        }
        ctx.fight(`The ${target.name} is still out of reach for a swing this turn.`, "status");
        afterAction(ctx);
        return;
      }
      for (let n = 0; n < steps; n++) {
        spendAp(ctx, AP_COST.move);
        stepBands(ctx, -1);
      }
    }
    if (!inReach(ctx, target, w.reach)) {
      // Something stopped you on the way (a hazard, usually).
      ctx.say("combat.cantReach");
      afterAction(ctx);
      return;
    }
  }

  spendAp(ctx, w.apCost);
  resolvePlayerHit(ctx, target, w);
  // An unwieldy weapon takes the rest of the turn to haul back up.
  if (w.unwieldy && ctx.game.combat) ctx.game.combat.ap = 0;
  afterAction(ctx);
}

/** How hard an enemy is to hit cleanly right now: its mods plus status shifts to defense. */
export function enemyGuard(ctx: StepContext, e: Enemy): number {
  return e.guard + modTotal(statusModifiers(e, ctx), "defense");
}

/** Damage an enemy shrugs off every weapon hit (never below 1 getting through). */
export function enemyArmor(ctx: StepContext, e: Enemy): number {
  return Math.max(0, e.armor + modTotal(statusModifiers(e, ctx), "dr", "damageReduction"));
}

/** When does a status riding on an attack land? Never on tier 1, on its chance at tier 2, always at tier 3. */
function riderLands(tier: number, p: number): boolean {
  return tier >= 3 || (tier === 2 && chance(p));
}

/** Extras for a hit that isn't a plain swing (spells: shared rolls, arcs, drain). */
export interface HitOptions {
  edges?: number;
  banes?: number;
  /** Use this roll instead of rolling (an area spell rolls once for everyone it covers). */
  roll?: PowerRoll;
  /** Not the main target: a short log line, and no crit AP or skill XP (the main hit had those). */
  secondary?: boolean;
  /** Flat damage on top, before armor (a spell's bonus against some enemy tags). */
  extraDamage?: number;
  /** Heal this % of the damage dealt, on top of any gear leech. */
  drain?: number;
  /** Damage multiplier after armor (an arc does half). */
  scale?: number;
}

/**
 * One weapon swing (or one spell hitting one target): the power roll, the tier's damage,
 * on-hit statuses, the kill. Always does at least 1 damage. A crit hands 1 AP back.
 * Doesn't spend AP or end the turn.
 */
export function resolvePlayerHit(ctx: StepContext, target: Enemy, w: WeaponProfile, opts: HitOptions = {}): PowerRoll {
  const c = ctx.crawler;
  const mods = collectModifiers(c, ctx.content);
  const d = derive(c, ctx.content);
  const sw = swingNumbers(c, ctx.content, w, d, mods);
  const shift = guardShift(enemyGuard(ctx, target));
  const roll = opts.roll ?? powerRoll(sw.rollBonus, shift.edges + (opts.edges ?? 0), shift.banes + (opts.banes ?? 0), sw.critAt);
  const lead = !opts.secondary;
  for (const name of consumeFlaggedStatuses(c.statuses, ctx, "breaksOnAttack")) {
    ctx.fight(`${name} ends when you attack.`, "status");
  }

  // Spiteful gear: extra damage against whatever hurt you this round or last.
  const round = ctx.game.combat?.round ?? 0;
  const spite = target.hitYouRound !== undefined && round - target.hitYouRound <= 1 ? modTotal(mods, "spite") : 0;
  const flat = sw.flat + spite;
  const armor = Math.max(0, enemyArmor(ctx, target) - sw.pierce);
  let dmg = Math.max(1, w.power[roll.tier - 1]! + flat + (opts.extraDamage ?? 0) - armor);
  if (roll.tier === 3 && sw.tier3Bonus) dmg = Math.round(dmg * (1 + sw.tier3Bonus / 100));
  const execute = modTotal(mods, "executioner");
  if (execute > 0 && target.hp * 2 < target.maxHP) dmg = Math.round(dmg * (1 + execute / 100));
  if (opts.scale !== undefined) dmg = Math.max(1, Math.floor(dmg * opts.scale));
  target.hp -= dmg;
  const left = `${armor > 0 ? ` (${armor} soaked)` : ""}${target.hp > 0 ? ` (${target.hp}/${target.maxHP})` : ""}`;
  const tierText = roll.crit ? "CRIT, tier 3" : `Tier ${roll.tier}`;
  ctx.fight(
    !lead ? `${w.name} catches the ${target.name} too: ${dmg} damage${left}.`
      : w.spell ? `${w.name} hits the ${target.name}: ${describePower(roll)}. ${tierText}: ${dmg} damage${left}.`
      : `You hit the ${target.name} with ${w.name}: ${describePower(roll)}. ${tierText}: ${dmg} damage${left}.`,
    "you",
  );
  if (roll.crit && lead) {
    ctx.say("combat.crit");
    const combat = ctx.game.combat;
    if (combat) {
      combat.ap += 1;
      ctx.fight("The crit hands you 1 AP back.", "you");
    }
  } else if (lead && chance(0.25)) {
    ctx.say(`combat.tier${roll.tier}`, { target: target.name });
  }
  const leech = modTotal(mods, "leech") + (opts.drain ?? 0);
  if (leech > 0 && c.hp < d.maxHP) {
    const healed = Math.min(d.maxHP - c.hp, Math.max(1, Math.floor((dmg * leech) / 100)));
    c.hp += healed;
    ctx.fight(`${w.name} drinks: +${healed} HP (${c.hp}/${d.maxHP}).`, "you");
  }
  // Every swing trains the weapon's skill: 1, or 2 on a crit. Nothing misses, so this is steady.
  // (A spell trains its school's skill the same way, once per cast.)
  if (lead) trainSkill(ctx, w.skillId, roll.crit ? 2 : 1);
  const finisher = target.hp > 0 ? skillFinisher(ctx, target, w, mods) : undefined;
  if (target.hp <= 0) {
    if (!finisher) {
      ctx.fight(`The ${target.name} drops.`, "you");
      ctx.say("combat.kill", { target: target.name });
    }
    const back = modTotal(mods, "killAp");
    const combat = ctx.game.combat;
    if (back > 0 && combat) {
      combat.ap += back;
      ctx.fight(`The kill hands you ${back} AP back.`, "you");
    }
  } else {
    if (w.onHit && riderLands(roll.tier, w.onHit.chance)) {
      const def = ctx.content.statusEffects.get(w.onHit.id);
      if (applyStatus(target.statuses, def, w.onHit.duration) !== "ignored") {
        ctx.fight(`The ${target.name} is ${def.name.toLowerCase()}.`, "status");
      }
    }
    if (roll.crit) {
      for (const m of mods.filter((x) => x.to.startsWith("critStatus:") && x.value > 0)) {
        const def = ctx.content.statusEffects.byId[m.to.slice("critStatus:".length)];
        if (def && applyStatus(target.statuses, def, m.value) !== "ignored") {
          ctx.fight(`The crit leaves the ${target.name} ${def.name.toLowerCase()}.`, "status");
        }
      }
    }
    // Weapon-skill perks: "critStatus@thrown:stunned" (crits), "tier3Status@bow:slowed" (any tier 3).
    for (const [kind, lands, what] of [["critStatus", roll.crit, "crit"], ["tier3Status", roll.tier === 3, "hit"]] as const) {
      if (!lands || !w.weaponType) continue;
      const prefix = `${kind}@${w.weaponType}:`;
      for (const m of mods.filter((x) => x.to.startsWith(prefix) && x.value > 0)) {
        const def = ctx.content.statusEffects.byId[m.to.slice(prefix.length)];
        if (def && applyStatus(target.statuses, def, m.value) !== "ignored") {
          ctx.fight(`The ${what} leaves the ${target.name} ${def.name.toLowerCase()}.`, "status");
        }
      }
    }
  }
  igniteUnder(ctx, target, w.damageType === "fire"); // a fire hit, or a fresh burn, on oil
  if (w.spell) return roll;
  coatedHit(ctx, target);
  // Some oddities feed Echo every time they bite (the Bone China Mouth).
  const held = c.inventory.find((i) => i.uid === c.equipment.mainHand);
  const perHit = held ? ctx.content.oddities.byId[held.baseId]?.temperOnHit : undefined;
  if (perHit) shiftTemper(ctx, perHit);
  return roll;
}

/**
 * Decapitation (Blades 5) and Lights Out (Blunt 5): a hit that leaves a non-boss standing
 * has a small chance to end it anyway. Bosses keep their heads. Returns the perk that fired.
 */
function skillFinisher(ctx: StepContext, target: Enemy, w: WeaponProfile, mods: readonly Modifier[]): "decapitate" | "knockout" | undefined {
  if (target.tier === "boss" || !w.weaponType || ctx.game.combat?.boss?.uid === target.uid) return undefined;
  for (const kind of ["decapitate", "knockout"] as const) {
    const pct = modTotal(mods, `${kind}:${w.weaponType}`);
    if (pct <= 0 || !chance(pct / 100)) continue;
    target.hp = 0;
    ctx.fight(kind === "decapitate"
      ? `DECAPITATION. The ${target.name}'s head goes one way and the ${target.name} goes the other.`
      : `LIGHTS OUT. The ${target.name} folds up like a lawn chair and doesn't get up.`, "you");
    ctx.say(`combat.${kind}`, { target: target.name });
    return kind;
  }
  return undefined;
}

/** Damage an enemy from something other than a weapon swing (items, hazards, slams). */
export function damageEnemy(ctx: StepContext, e: Enemy, dmg: number, how: string): void {
  if (e.hp <= 0) return;
  e.hp -= dmg;
  ctx.fight(`${how} — ${dmg} damage${e.hp > 0 ? ` (${e.hp}/${e.maxHP})` : ""}.`, "you");
  if (e.hp <= 0) {
    ctx.fight(`The ${e.name} drops.`, "you");
    ctx.say("combat.kill", { target: e.name });
  }
}

// ---------------------------------------------------------------- flee / talk / move

export function playerFlee(ctx: StepContext): void {
  if (!beginTurn(ctx)) return;
  if (isGrid(ctx)) {
    gridFlee(ctx);
    return;
  }
  const combat = ctx.game.combat!;
  if (!canAfford(ctx, AP_COST.flee, "Running for it")) return;
  spendAp(ctx, AP_COST.flee);
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

/** The end of a fight you ran from: what your skills still got out of it. */
export function fledEvent(ctx: StepContext): Extract<GameEventBody, { type: "combatEnded" }> {
  const skills = fightSkillSummary(ctx);
  return { type: "combatEnded", outcome: "fled", ...(skills.length ? { skills } : {}) };
}

/** End the fight as a flight and put the crawler in `toRoom` (no time cost: you ran). */
export function leaveCombat(ctx: StepContext, toRoom: number): void {
  const ended = fledEvent(ctx);
  endCombat(ctx);
  ctx.emit(ended);
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
  if (!canAfford(ctx, AP_COST.talk, "Talking your way out")) return;
  spendAp(ctx, AP_COST.talk);
  const c = ctx.crawler;
  const d = derive(c, ctx.content);
  const rank = skillRank(c, "persuasion", collectModifiers(c, ctx.content));
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
    trainSkill(ctx, "persuasion", 1);
    const { gained } = gainXp(ctx, xp);
    ctx.fight(`Persuasion: d20(${nat})+${d.stats.CHA + rank} = ${total} vs DC ${dc}. They buy it. +${gained} XP.`, "you");
    ctx.say("combat.talkSuccess");
    afterAction(ctx);
    return;
  }
  ctx.fight(`Persuasion: d20(${nat})+${d.stats.CHA + rank} = ${total} vs DC ${dc}. No sale.`, "you");
  ctx.say("combat.talkFail");
  afterAction(ctx);
}

/** Bands: shift every enemy one band (you reposition relative to the pack). 1 AP. */
export function playerStep(ctx: StepContext, delta: 1 | -1): void {
  if (!beginTurn(ctx)) return;
  if (!canAfford(ctx, AP_COST.move, "Moving")) return;
  spendAp(ctx, AP_COST.move);
  stepBands(ctx, delta);
  afterAction(ctx);
}

/** End the turn, whatever AP is left. */
export function playerWait(ctx: StepContext): void {
  if (!beginTurn(ctx)) return;
  ctx.fight("You hold your ground and wait.", "you");
  finishRound(ctx);
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
  if (fighting && !canAfford(ctx, AP_COST.item, `Using ${item.name}`)) return;
  if (fighting) spendAp(ctx, AP_COST.item);

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
    afterAction(ctx);
  } else {
    ctx.describe(`You use ${item.name}${summary}.`);
    if (ctx.crawler.hp <= 0) killCrawler(ctx, item.name);
  }
}

/** Apply a consumable's effects to whoever they're aimed at. Returns short log fragments. */
export function applyItemEffects(ctx: StepContext, def: Consumable, t: EffectTargets): string[] {
  const applied: string[] = [];
  const potency = def.scales ? potencyFor(ctx.game.floor?.floor ?? 1) : 1;
  for (const e of def.effects) {
    const rolled = typeof e.value === "number" ? e.value : e.value ? rollDice(e.value).total : 0;
    const value = potency === 1 || e.kind === "status" || e.kind === "cure" ? rolled : Math.round(rolled * potency);
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
        // First Aid 5: healing items do 25% more. Patching yourself up trains First Aid.
        const pct = modTotal(collectModifiers(c, ctx.content), "healing:items");
        const before = c.hp;
        c.hp = Math.min(d.maxHP, c.hp + Math.round(value * (1 + pct / 100)));
        applied.push(`+${c.hp - before} HP`);
        if (c.hp > before) trainSkill(ctx, "first_aid", 1);
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
    case "xp": {
      const { gained } = gainXp(ctx, value);
      applied.push(`+${gained} XP`);
      return;
    }
    case "skill": {
      // Skill potions: ranks straight into a skill (never past 15). No skillId: the weapon in your hand;
      // flag "random": one of the skills you've already used.
      const used = Object.entries(c.skills).filter(([, s]) => s.rank < SKILL_CAP).map(([id]) => id);
      const id = e.skillId ?? (e.flag === "random" ? (used.length ? pick(used) : undefined) : playerWeapon(ctx).skillId);
      const skill = id ? ctx.content.skills.byId[id] : undefined;
      if (!skill || (c.skills[skill.id]?.rank ?? 0) >= SKILL_CAP) {
        applied.push("nothing left to learn");
        return;
      }
      trainSkill(ctx, skill.id, 0, Math.max(1, value));
      applied.push(`${skill.name} ${c.skills[skill.id]!.rank}`);
      return;
    }
    case "stat":
      // Permanent stat items ("flag": "permanent"). Timed buffs (`rooms` on the item) arrive with their system.
      if (e.flag === "permanent" && e.stat) {
        c.baseStats[e.stat] += value;
        const after = derive(c, ctx.content);
        if (after.maxHP > d.maxHP) c.hp += after.maxHP - d.maxHP;
        applied.push(`${e.stat} ${d.stats[e.stat]} → ${after.stats[e.stat]}, for good`);
      }
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
  if (a.ready !== 0) return false;
  const arena = ctx.game.combat?.arena;
  if (arena && e.pos) return reaches(arena, ctx.content, e.pos, arena.crawler, a.range);
  return BAND[e.range] <= BAND[a.range];
}

/** AP an enemy's turn starts with: by tier, +1 hasted, -1 slowed. */
export function enemyAp(ctx: StepContext, e: Enemy): number {
  return turnAp(e.statuses, ctx.content, TIER[e.tier].ap);
}

export function attackCost(a: EnemyAttack): number {
  return a.ap ?? AP_COST.attack;
}

/** A usable attack to throw right now; `ap` limits it to ones the enemy can still pay for. */
export function pickAttack(ctx: StepContext, e: Enemy, specialsOnly = false, ap = Infinity): LiveAttack | undefined {
  const usable = e.attacks.filter((a) => attackUsable(ctx, e, a) && attackCost(a) <= ap);
  const candidates = specialsOnly ? usable.filter((a) => a.cooldown) : usable;
  return candidates.length > 0 ? pick(candidates) : undefined;
}

function enemyTurn(ctx: StepContext, e: Enemy): void {
  if (e.hp <= 0) return;
  try {
    if (e.tier === "boss") bossTaunt(ctx, e);
    if (enemyTurnPreamble(ctx, e)) {
      if (isGrid(ctx)) runEnemyTurnGrid(ctx, e);
      else runEnemyTurnBands(ctx, e);
    }
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
  if (hasFlag(e.statuses, ctx.content, "noAttack")) {
    ctx.fight(`The ${e.name} can't bring itself to attack you. It just stands there, offering.`, "enemy");
    return false;
  }
  if (hasFlag(e.statuses, ctx.content, "randomTarget") && lashOut(ctx, e)) return false;
  return true;
}

/**
 * Confused (Bait and Switch): half the time, a confused enemy swings at another enemy
 * near it instead of you. Its first attack, a middling hit (tier 2), less armor. Returns
 * true if it did (its turn is spent).
 */
function lashOut(ctx: StepContext, e: Enemy): boolean {
  const near = aliveEnemies(ctx).filter((o) => o !== e &&
    (e.pos && o.pos ? Math.max(Math.abs(e.pos.x - o.pos.x), Math.abs(e.pos.y - o.pos.y)) <= 1 : o.range === e.range));
  if (near.length === 0 || !chance(0.5)) return false;
  const victim = pick(near);
  const attack = e.attacks[0];
  if (!attack) return false;
  const dmg = Math.max(1, attack.power[1] + Math.floor(e.stats[attack.stat] / 4) - enemyArmor(ctx, victim));
  victim.hp -= dmg;
  ctx.fight(`The ${e.name}, confused, turns its ${attack.name} on the ${victim.name}: ${dmg} damage${victim.hp > 0 ? ` (${victim.hp}/${victim.maxHP})` : ""}.`, "enemy");
  if (victim.hp <= 0) {
    ctx.fight(`The ${victim.name} drops. Friendly fire is still fire.`, "enemy");
    ctx.say("combat.kill", { target: victim.name });
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

/** Bands: spend the enemy's AP an action at a time. A band step is 1 AP; attacks cost what they say (2). */
function runEnemyTurnBands(ctx: StepContext, e: Enemy): void {
  let ap = enemyAp(ctx, e);
  let kept = false;
  let did = false;
  const strike = (a: LiveAttack) => {
    ap -= attackCost(a);
    did = true;
    enemyStrike(ctx, e, a);
  };
  const tied = cantMove(ctx, e);
  for (let guard = 0; guard < 8 && ap > 0 && e.hp > 0 && ctx.game.phase === "combat"; guard++) {
    if (!tied && e.ai.some((token) => wantsToFlee(ctx, e, token))) {
      const d = derive(ctx.crawler, ctx.content);
      if (d20() + e.stats.DEX > d20() + d.stats.DEX) markFled(ctx, e);
      else ctx.fight(`The ${e.name} tries to bolt and can't find an opening.`, "enemy");
      return;
    }
    let acted = false;
    for (const priority of e.ai) {
      if (priority === "special_if_ready") {
        const special = pickAttack(ctx, e, true, ap);
        if (special) { strike(special); acted = true; break; }
      }
      if (priority === "keep_range" && !kept && !tied && BAND[e.range] < BAND[e.preferRange]) {
        kept = true;
        ap -= AP_COST.move;
        did = true;
        e.range = BANDS[BAND[e.range] + 1]!;
        ctx.fight(`The ${e.name} skitters back to ${e.range} range.`, "enemy");
        acted = true;
        break;
      }
      if (priority === "attack") {
        const attack = pickAttack(ctx, e, false, ap);
        if (attack) { strike(attack); acted = true; break; }
      }
    }
    if (acted) continue;
    const attack = pickAttack(ctx, e, false, ap);
    if (attack) { strike(attack); continue; }
    // Step toward a band where something works, if there'd be a point.
    const closer = e.attacks.some((a) => a.ready === 0 && BAND[a.range] < BAND[e.range]);
    if (closer && !tied && BAND[e.range] > 0) {
      ap -= AP_COST.move;
      did = true;
      e.range = BANDS[BAND[e.range] - 1]!;
      ctx.fight(`The ${e.name} closes to ${e.range} range.`, "enemy");
      continue;
    }
    break;
  }
  if (!did && e.hp > 0 && ctx.game.phase === "combat") ctx.fight(`The ${e.name} circles, looking for an angle.`, "enemy");
}

/** Bands has no tiles, so ganging up is counted by band: every other enemy at close range with it, up to two. */
function bandsPackBonus(ctx: StepContext, e: Enemy): number {
  if (e.range !== "close") return 0;
  return Math.min(2, aliveEnemies(ctx).filter((o) => o !== e && o.range === "close").length);
}

/**
 * One enemy attack: the power roll, the tier's damage, the status riding on it.
 * Always does at least 1 damage. Doesn't touch the enemy's AP.
 */
export function enemyStrike(ctx: StepContext, e: Enemy, attack: LiveAttack, opts: { edges?: number; banes?: number } = {}): PowerRoll {
  const c = ctx.crawler;
  const mods = collectModifiers(c, ctx.content);
  const d = derive(c, ctx.content);
  if (attack.cooldown) attack.ready = attack.cooldown;
  const enemyMods = statusModifiers(e, ctx);
  const statMod = e.stats[attack.stat] + modTotal(enemyMods, `stat:${attack.stat}`);
  const bonus = Math.floor(statMod / 2) + modTotal(enemyMods, "attack", "hit");
  // Ganging up is an edge per extra body next to you; your guard (braced, hasted...) is banes.
  const pack = isGrid(ctx) ? packBonus(ctx, e) : bandsPackBonus(ctx, e);
  const shift = guardShift(d.guard);
  const hidden = hasFlag(c.statuses, ctx.content, "untargetable") ? 2 : 0;
  const roll = powerRoll(bonus, pack + shift.edges + (opts.edges ?? 0), shift.banes + hidden + (opts.banes ?? 0));
  // Enemies add stat/4 where the crawler adds stat/2: the player's damage edge (see the decision log in docs/DESIGN.md).
  const soak = d.armor + modTotal(mods, `resist:${attack.damageType}`);
  const dmg = Math.max(1, attack.power[roll.tier - 1]! + Math.floor(statMod / 4) + modTotal(enemyMods, "damage") - soak);
  c.hp -= dmg;
  if (ctx.game.combat) e.hitYouRound = ctx.game.combat.round;
  ctx.fight(
    `${e.name} — ${attack.name}: ${describePower(roll)}${pack ? ` (${pack} ganging up)` : ""}. ${roll.crit ? "CRIT, tier 3" : `Tier ${roll.tier}`}: ${dmg} ${attack.damageType} damage${soak > 0 ? ` (${soak} soaked)` : ""}. You: ${Math.max(0, c.hp)}/${d.maxHP}.`,
    "enemy",
  );
  if (c.hp > 0) secondWind(ctx, d.maxHP, mods);
  const thorns = modTotal(mods, "thorns");
  if (thorns > 0 && attack.range === "close" && e.hp > 0) damageEnemy(ctx, e, thorns, `Your gear bites back at the ${e.name}`);
  if (attack.status && c.hp > 0 && riderLands(roll.tier, attack.status.chance)) {
    const def = ctx.content.statusEffects.get(attack.status.id);
    const what = applyStatus(c.statuses, def, attack.status.duration);
    if (what !== "ignored") ctx.fight(`You are ${def.name.toLowerCase()}.`, "status");
  }
  if (c.hp > 0) igniteUnder(ctx, "crawler", attack.damageType === "fire"); // fire, or a fresh burn, on oil
  if (ctx.game.phase !== "combat") return roll; // the fire got you
  if (c.hp <= 0) killInCombat(ctx, e.tier === "boss" ? `the ${e.name}` : `${/^[aeiou]/i.test(e.name) ? "an" : "a"} ${e.name}`);
  return roll;
}

/** Second Wind gear: once a fight, dropping under a quarter of max HP heals some back. */
function secondWind(ctx: StepContext, maxHP: number, mods: readonly { to: string; value: number }[]): void {
  const pct = modTotal(mods, "secondWind");
  const combat = ctx.game.combat;
  const c = ctx.crawler;
  if (pct <= 0 || !combat || c.hp * 4 >= maxHP || combat.used?.includes("secondWind")) return;
  (combat.used ??= []).push("secondWind");
  const healed = Math.max(1, Math.round((maxHP * pct) / 100));
  c.hp = Math.min(maxHP, c.hp + healed);
  ctx.fight(`Second wind: +${healed} HP (${c.hp}/${maxHP}). Not today.`, "you");
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
  const earned = combat.enemies.reduce((sum, e) => sum + (e.hp <= 0 && !e.fate ? e.xp : 0), 0);
  // talked enemies already paid half in playerTalk; fled ones pay nothing
  const { gained: xp, levels } = gainXp(ctx, earned, false);
  if (combat.boss) bossDefeated(ctx);
  const drops = rollDrops(ctx);
  const skills = fightSkillSummary(ctx);
  endCombat(ctx);
  const c = ctx.crawler;
  ctx.emit({
    type: "combatEnded", outcome: "victory", xp, level: c.level, xpNow: c.xp, xpNext: xpToNext(c.level),
    ...(skills.length ? { skills } : {}),
  });
  ctx.say("combat.victory", { xp });
  announceLevels(ctx, levels);
  placeDrops(ctx, drops);
  ctx.setPhase("exploring");
}

/** Killed (not talked down, not fled) enemies may drop a piece of generated gear: floors.json → loot.gear.drops. */
function rollDrops(ctx: StepContext): { from: string; item: ItemInstance }[] {
  const combat = ctx.game.combat!;
  const floor = ctx.game.floor;
  if (!floor) return [];
  const chances = ctx.content.floors.get(floor.theme).loot.gear.drops;
  const out: { from: string; item: ItemInstance }[] = [];
  for (const e of combat.enemies) {
    if (e.hp > 0 || e.fate || e.tier === "boss") continue;
    if (!chance(chances[e.tier] ?? 0)) continue;
    out.push({ from: e.name, item: generateItem(ctx.content, itemLevelFor(floor.floor) + (e.tier === "elite" ? 1 : 0), { floor: floor.floor, narrator: ctx.game.narrator }) });
  }
  return out;
}

function placeDrops(ctx: StepContext, drops: { from: string; item: ItemInstance }[]): void {
  const floor = ctx.game.floor;
  if (!floor || drops.length === 0) return;
  const room = floor.rooms[floor.currentRoom]!;
  room.items ??= [];
  for (const d of drops) {
    addToPile(room.items, d.item);
    ctx.describe(`The ${d.from} dropped ${d.item.name}.`);
  }
}

export function endCombat(ctx: StepContext): void {
  // Whatever junk is still lying on the board goes back on the room's floor.
  const arena = ctx.game.combat?.arena;
  const floor = ctx.game.floor;
  if (arena && arena.items.length && floor) {
    const room = floor.rooms[floor.currentRoom]!;
    room.items ??= [];
    for (const it of arena.items) addToPile(room.items, it.item);
  }
  ctx.game.combat = null;
  // Spell cooldowns are counted in rounds: out of a fight, everything is ready again.
  for (const sp of Object.values(ctx.game.crawler?.spells ?? {})) sp.cooldown = 0;
  // A combat urge goes with the fight.
  if (ctx.game.echo?.urge?.where === "combat") delete ctx.game.echo.urge;
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

/** Find a living enemy by (part of) its name, or by its tile ("d5") in grid fights. */
export function findEnemy(ctx: StepContext, query: string): Enemy | undefined {
  const q = query.toLowerCase().trim();
  const foes = aliveEnemies(ctx);
  const tile = parseCoord(q);
  if (tile && ctx.game.combat?.arena) return foes.find((e) => e.pos && e.pos.x === tile.x && e.pos.y === tile.y);
  return foes.find((e) => e.name.toLowerCase() === q) ?? foes.find((e) => e.name.toLowerCase().includes(q));
}

/** Enemy strip for `look` in combat. */
export function combatSummary(ctx: StepContext): string[] {
  return aliveEnemies(ctx).map((e) => {
    const st = e.statuses.map((s) => ctx.content.statusEffects.byId[s.id]?.name ?? s.id).join(", ");
    const at = e.pos ? `${coord(e.pos)}, ${e.range}` : e.range;
    return `${e.name}  ${e.hp}/${e.maxHP} HP  [${at}]${st ? `  (${st})` : ""}`;
  });
}
