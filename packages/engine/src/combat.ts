/**
 * Combat (spec: Core rules / Combat). Initiative is rolled once; enemies that
 * beat the crawler act first in round 1, after that each round is the player's
 * action followed by every living enemy in initiative order. One action and one
 * band-step minor per round. Range is three bands per enemy, relative to you.
 */
import type { Content } from "./content/load";
import type { EnemyAttack, RangeBand } from "./content/schemas";
import { generateGroup } from "./gen/enemy";
import { enterRoom, advanceTime, TIME_COST } from "./explore";
import { dcFor } from "./rules/checks";
import { rollDice } from "./rules/dice";
import { collectModifiers, derive, modTotal } from "./rules/derived";
import { applyStatus, decrementStatuses, hasFlag, tickStatuses } from "./rules/effects";
import { chance, d20, pick } from "./rng";
import { killCrawler, type StepContext } from "./step";
import type { Enemy, ItemInstance, Room, StatusInstance } from "./state";

const BAND: Record<RangeBand, number> = { close: 0, near: 1, far: 2 };
const BANDS: RangeBand[] = ["close", "near", "far"];

export function aliveEnemies(ctx: StepContext): Enemy[] {
  return ctx.game.combat?.enemies.filter((e) => e.hp > 0) ?? [];
}

// ---------------------------------------------------------------- encounters

/** Encounter odds by room type. Lairs always fight (elite); corridors roll every entry. */
export function maybeEncounter(ctx: StepContext, room: Room, firstVisit: boolean): boolean {
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
  startCombat(ctx, enemies);
  return true;
}

export function startCombat(ctx: StepContext, enemies: Enemy[]): void {
  const floor = ctx.game.floor!;
  const d = derive(ctx.crawler, ctx.content);
  const playerInit = d20() + d.initiativeBonus;
  for (const e of enemies) e.initiative += d20() + e.stats.DEX;
  enemies.sort((a, b) => b.initiative - a.initiative);

  ctx.game.combat = {
    enemies,
    round: 1,
    playerInitiative: playerInit,
    minorActionsUsed: 0,
    fromRoom: floor.currentRoom,
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

// ---------------------------------------------------------------- player turn

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
  combat.round += 1;
  advanceTime(ctx, TIME_COST.combatRound);
}

/** Player status ticks at the start of their action; returns false if the turn is lost. */
export function playerTurnStart(ctx: StepContext): boolean {
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

export function playerWeapon(ctx: StepContext): { name: string; dice: string; stat: "STR" | "DEX"; reach: RangeBand; skillId?: string; damageType?: string } {
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
    };
  }
  return { name: "bare hands", dice: "1d2", stat: "STR", reach: "close", skillId: "unarmed" };
}

export function playerAttack(ctx: StepContext, target: Enemy): void {
  if (!playerTurnStart(ctx)) return;
  const combat = ctx.game.combat!;
  const c = ctx.crawler;
  const w = playerWeapon(ctx);

  if (hasFlag(c.statuses, ctx.content, "fleeOnly")) {
    ctx.fight("Fear locks your legs. You can only try to flee.", "status");
    finishRound(ctx);
    return;
  }
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

  if (BAND[target.range] > BAND[w.reach]) {
    if (canUseMinor(ctx)) {
      stepBands(ctx, -1);
      combat.minorActionsUsed += 1;
    }
    if (BAND[target.range] > BAND[w.reach]) {
      ctx.say("combat.cantReach");
      finishRound(ctx);
      return;
    }
  }

  const mods = collectModifiers(c, ctx.content);
  const d = derive(c, ctx.content);
  const skillRank = w.skillId ? (c.skills[w.skillId]?.rank ?? 0) : 0;
  const hitMod = d.stats[w.stat] + skillRank + modTotal(mods, "attack", "hit");
  const nat = d20();
  const total = nat + hitMod;
  const crit = nat === 20;
  const targetMods = statusModifiers(target, ctx);
  const dex = target.stats.DEX + modTotal(targetMods, "stat:DEX");
  const targetDefense = target.defense + Math.floor(dex / 2) - Math.floor(target.stats.DEX / 2) + modTotal(targetMods, "defense");
  const hit = crit || (nat !== 1 && total >= targetDefense);
  for (const name of consumeFlaggedStatuses(c.statuses, ctx, "breaksOnAttack")) {
    ctx.fight(`${name} ends when you attack.`, "status");
  }

  if (!hit) {
    ctx.fight(`You attack the ${target.name} with ${w.name}: d20(${nat})+${hitMod} = ${total} vs ${targetDefense}. Miss.`, "you");
    if (nat === 1) ctx.say("combat.critFail", { target: target.name });
    else if (chance(0.3)) ctx.say("combat.playerMiss");
    finishRound(ctx);
    return;
  }
  let dmg = rollDice(w.dice).total + (crit ? rollDice(w.dice).total : 0);
  dmg += Math.floor(d.stats[w.stat] / 2) + modTotal(mods, "damage");
  dmg = Math.max(1, dmg);
  target.hp -= dmg;
  ctx.fight(
    `You ${crit ? "CRIT" : "hit"} the ${target.name} with ${w.name}: d20(${nat})+${hitMod} = ${total} vs ${targetDefense} — ${dmg} damage${target.hp > 0 ? ` (${target.hp}/${target.maxHP})` : ""}.`,
    "you",
  );
  if (crit) ctx.say("combat.crit");
  if (target.hp <= 0) {
    ctx.fight(`The ${target.name} drops.`, "you");
    ctx.say("combat.kill", { target: target.name });
  }
  finishRound(ctx);
}

export function playerFlee(ctx: StepContext): void {
  if (!playerTurnStart(ctx)) return;
  const c = ctx.crawler;
  const combat = ctx.game.combat!;
  const mods = collectModifiers(c, ctx.content);
  const d = derive(c, ctx.content);
  const mine = d20() + d.stats.DEX + modTotal(mods, "flee", "skill:dodge");
  const best = aliveEnemies(ctx).reduce((m, e) => Math.max(m, e.stats.DEX), 0);
  const theirs = d20() + best;
  if (mine > theirs) {
    ctx.fight(`You bolt: ${mine} vs ${theirs}. Clean getaway.`, "you");
    ctx.say("combat.fleeSuccess");
    const from = combat.fromRoom;
    endCombat(ctx);
    ctx.emit({ type: "combatEnded", outcome: "fled" });
    ctx.setPhase("exploring");
    if (ctx.game.floor && from !== ctx.game.floor.currentRoom) enterRoom(ctx, from, "revisit");
    return;
  }
  ctx.fight(`You bolt: ${mine} vs ${theirs}. They're faster.`, "you");
  ctx.say("combat.fleeFail");
  // The failed flee IS the opening: every enemy that can reach takes one free swing.
  for (const e of aliveEnemies(ctx)) {
    if (ctx.game.phase !== "combat") return;
    const attack = pickAttack(e);
    if (attack) enemyStrike(ctx, e, attack);
  }
  if (ctx.game.phase === "combat") {
    endOfRound(ctx);
    checkVictory(ctx);
  }
}

export function playerTalk(ctx: StepContext): void {
  const listeners = aliveEnemies(ctx).filter((e) => e.talkable);
  if (listeners.length === 0) {
    ctx.error("Nothing here is interested in your material.");
    return;
  }
  if (!playerTurnStart(ctx)) return;
  if (hasFlag(ctx.crawler.statuses, ctx.content, "fleeOnly")) {
    ctx.fight("Fear leaves you with nothing to say but goodbye.", "status");
    finishRound(ctx);
    return;
  }
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

/** Minor action: shift every enemy one band (you reposition relative to the pack). */
export function playerStep(ctx: StepContext, delta: 1 | -1): void {
  const combat = ctx.game.combat!;
  if (!canUseMinor(ctx)) {
    ctx.error("You've already moved this round.");
    return;
  }
  combat.minorActionsUsed += 1;
  stepBands(ctx, delta);
}

function canUseMinor(ctx: StepContext): boolean {
  const statuses = ctx.crawler.statuses;
  if (hasFlag(statuses, ctx.content, "noMinor")) return false;
  const limit = hasFlag(statuses, ctx.content, "extraMinor") ? 2 : 1;
  return ctx.game.combat!.minorActionsUsed < limit;
}

function stepBands(ctx: StepContext, delta: 1 | -1): void {
  for (const e of aliveEnemies(ctx)) {
    e.range = BANDS[Math.max(0, Math.min(2, BAND[e.range] + delta))]!;
  }
  ctx.fight(delta < 0 ? "You close in." : "You fall back a step.", "you");
}

export function playerUseItem(ctx: StepContext, item: ItemInstance): void {
  const consumable = ctx.content.items.consumables.byId[item.baseId];
  if (!consumable) {
    ctx.error(`${item.name} isn't something you can use.`);
    return;
  }
  const inCombat = ctx.game.phase === "combat";
  if (inCombat && !consumable.usableInCombat) {
    ctx.error(`${item.name} takes more peace and quiet than you currently have.`);
    return;
  }
  if (inCombat && !playerTurnStart(ctx)) return;
  if (inCombat && hasFlag(ctx.crawler.statuses, ctx.content, "fleeOnly")) {
    ctx.fight("Fear makes using an item seem like a long-term plan.", "status");
    finishRound(ctx);
    return;
  }
  const c = ctx.crawler;
  const d = derive(c, ctx.content);
  const applied: string[] = [];
  for (const e of consumable.effects) {
    const value = typeof e.value === "number" ? e.value : e.value ? rollDice(e.value).total : 0;
    if (e.kind === "heal") {
      const before = c.hp;
      c.hp = Math.min(d.maxHP, c.hp + value);
      applied.push(`+${c.hp - before} HP`);
    } else if (e.kind === "damage") {
      c.hp = Math.max(0, c.hp - value);
      applied.push(`-${value} HP (it said so on the label)`);
    } else if (e.kind === "cure" && e.statusId) {
      const i = c.statuses.findIndex((s) => s.id === e.statusId);
      if (i >= 0) {
        c.statuses.splice(i, 1);
        applied.push(`cured ${ctx.content.statusEffects.byId[e.statusId]?.name ?? e.statusId}`);
      }
    } else if (e.kind === "status" && e.statusId) {
      const def = ctx.content.statusEffects.get(e.statusId);
      applyStatus(c.statuses, def, e.duration);
      applied.push(def.name.toLowerCase());
    }
  }
  item.qty -= 1;
  if (item.qty <= 0) c.inventory.splice(c.inventory.findIndex((i) => i.uid === item.uid), 1);
  const summary = applied.length ? ` (${applied.join(", ")})` : "";
  if (inCombat) {
    ctx.fight(`You use ${item.name}${summary}.`, "you");
    if (c.hp <= 0) {
      endCombat(ctx);
      killCrawler(ctx, item.name);
      return;
    }
    finishRound(ctx);
  } else {
    ctx.describe(`You use ${item.name}${summary}.`);
    if (c.hp <= 0) killCrawler(ctx, item.name);
  }
}

// ---------------------------------------------------------------- enemy turn

function pickAttack(e: Enemy, specialsOnly = false): (EnemyAttack & { ready: number }) | undefined {
  const usable = e.attacks.filter((a) => a.ready === 0 && BAND[e.range] <= BAND[a.range]);
  const candidates = specialsOnly ? usable.filter((a) => a.cooldown) : usable;
  return candidates.length > 0 ? pick(candidates) : undefined;
}

function enemyTurn(ctx: StepContext, e: Enemy): void {
  if (e.hp <= 0) return;
  try {
    runEnemyTurn(ctx, e);
  } finally {
    for (const name of decrementStatuses(e.statuses, ctx.content)) {
      ctx.fight(`${e.name} is no longer ${name.toLowerCase()}.`, "status");
    }
  }
}

function runEnemyTurn(ctx: StepContext, e: Enemy): void {
  if (e.hp <= 0) return;
  for (const t of tickStatuses(e.statuses, ctx.content)) {
    e.hp -= t.amount;
    ctx.fight(`The ${e.name} takes ${t.amount} from ${t.status.toLowerCase()}.`, "status");
  }
  if (e.hp <= 0) {
    ctx.fight(`The ${e.name} succumbs.`, "status");
    ctx.say("combat.kill", { target: e.name });
    return;
  }
  if (hasFlag(e.statuses, ctx.content, "skipTurn")) {
    ctx.fight(`The ${e.name} is stunned and does nothing. Savor it.`, "status");
    return;
  }
  if (hasFlag(e.statuses, ctx.content, "noAttackCharmer")) {
    ctx.fight(`${e.name} is too busy admiring you to attack.`, "enemy");
    return;
  }
  let repositioned = false;
  for (const priority of e.ai) {
    const fleeMatch = /^flee_below_(\d+)$/.exec(priority);
    if (hasFlag(e.statuses, ctx.content, "fleeOnly") ||
      (fleeMatch && e.hp / e.maxHP < Number(fleeMatch[1]) / 100) ||
      (e.fleeBelow > 0 && e.hp / e.maxHP < e.fleeBelow)) {
      const c = ctx.crawler;
      const d = derive(c, ctx.content);
      if (d20() + e.stats.DEX > d20() + d.stats.DEX) {
        e.hp = 0;
        e.fate = "fled";
        ctx.fight(`The ${e.name} breaks and scrambles into the dark.`, "enemy");
        ctx.say("combat.enemyFled", { target: e.name });
      } else {
        ctx.fight(`The ${e.name} tries to bolt and can't find an opening.`, "enemy");
      }
      return;
    }
    if (priority === "special_if_ready") {
      const special = pickAttack(e, true);
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
      const attack = pickAttack(e);
      if (attack) {
        enemyStrike(ctx, e, attack);
        return;
      }
    }
  }
  let attack = pickAttack(e);
  if (!attack) {
    // step toward a band where something works
    if (BAND[e.range] > 0) {
      e.range = BANDS[BAND[e.range] - 1]!;
      ctx.fight(`The ${e.name} closes to ${e.range} range.`, "enemy");
    }
    attack = pickAttack(e);
    if (!attack) {
      if (!repositioned) ctx.fight(`The ${e.name} circles, looking for an angle.`, "enemy");
      return;
    }
  }
  enemyStrike(ctx, e, attack);
}

function enemyStrike(ctx: StepContext, e: Enemy, attack: EnemyAttack & { ready: number }): void {
  const c = ctx.crawler;
  const mods = collectModifiers(c, ctx.content);
  const d = derive(c, ctx.content);
  if (attack.cooldown) attack.ready = attack.cooldown;
  const enemyMods = statusModifiers(e, ctx);
  const statMod = e.stats[attack.stat] + modTotal(enemyMods, `stat:${attack.stat}`);
  const nat = d20();
  const hitMod = statMod + modTotal(enemyMods, "attack", "hit");
  const total = nat + hitMod;
  const crit = nat === 20;
  const defense = d.defense + (hasFlag(c.statuses, ctx.content, "untargetable") ? 5 : 0);
  const hit = !hasFlag(c.statuses, ctx.content, "untargetable") && (crit || (nat !== 1 && total >= defense));
  if (!hit) {
    ctx.fight(`${e.name} — ${attack.name}: d20(${nat})+${hitMod} = ${total} vs your ${defense}. Miss.`, "enemy");
    return;
  }
  // Enemies add stat/4 where the crawler adds stat/2: the player's damage edge (see DECISIONS.md).
  let dmg = rollDice(attack.dice).total + (crit ? rollDice(attack.dice).total : 0) + Math.floor(statMod / 4);
  dmg -= modTotal(mods, "damageReduction", "dr", `resist:${attack.damageType}`);
  dmg = Math.max(1, dmg);
  c.hp -= dmg;
  ctx.fight(
    `${e.name} — ${attack.name}${crit ? " (CRIT)" : ""}: d20(${nat})+${hitMod} = ${total} vs your ${defense} — ${dmg} ${attack.damageType} damage. You: ${Math.max(0, c.hp)}/${d.maxHP}.`,
    "enemy",
  );
  if (attack.status && c.hp > 0 && chance(attack.status.chance)) {
    const def = ctx.content.statusEffects.get(attack.status.id);
    const what = applyStatus(c.statuses, def, attack.status.duration);
    if (what !== "ignored") ctx.fight(`You are ${def.name.toLowerCase()}.`, "status");
  }
  if (c.hp <= 0) {
    const name = e.name;
    endCombat(ctx);
    killCrawler(ctx, `a ${name}`);
  }
}

// ---------------------------------------------------------------- endings

function checkVictory(ctx: StepContext): void {
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

function endCombat(ctx: StepContext): void {
  ctx.game.combat = null;
}

function statusModifiers(e: Enemy, ctx: StepContext) {
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

/** Enemy strip for `look` in combat. */
export function combatSummary(ctx: StepContext): string[] {
  return aliveEnemies(ctx).map((e) => {
    const st = e.statuses.map((s) => ctx.content.statusEffects.byId[s.id]?.name ?? s.id).join(", ");
    return `${e.name}  ${e.hp}/${e.maxHP} HP  [${e.range}]${st ? `  (${st})` : ""}`;
  });
}
