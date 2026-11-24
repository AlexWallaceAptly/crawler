/**
 * Floor bosses (docs/DESIGN.md, "Floor bosses"). One hand-written boss per floor
 * (bosses.json), placed by the floor generator:
 *   - Floors 1-4 ("none"): an optional mini-boss in its own dead-end lair.
 *   - Floors 5+ ("obviousStairs"): the boss stands on the stairwell nearest the start,
 *     and every other stairwell is hidden.
 *
 * Each boss's weakness is a rule the engine applies, whatever the narration says. Until
 * Milestone 10 bosses run on the ordinary priority-list AI.
 */
import { grantBox } from "./boxes";
import type { Content } from "./content/load";
import type { Boss } from "./content/schemas";
import { generateEnemy } from "./gen/enemy";
import { rollLoot } from "./gen/loot";
import { generateItem, itemFromRef, itemLevelFor } from "./gen/item";
import { addToPile } from "./inventory";
import { applyStatus } from "./rules/effects";
import { AP_COST } from "./rules/ap";
import { chance, pick } from "./rng";
import { arcRow, maybeBossShard, recordWeakness, shardFound } from "./echo";
import { afterAction, beginTurn, canAfford, consumeOne, spendAp, startCombat } from "./combat";
import type { Enemy, ItemInstance, Room } from "./state";
import type { StepContext } from "./step";

/** The floor's boss, if its fight is built (has a stat block). */
export function bossOfFloor(content: Content, floor: number): Boss | undefined {
  const row = arcRow(content, floor);
  const boss = row ? content.bosses.byId[row.boss] : undefined;
  return boss?.family ? boss : undefined;
}

export function bossGateOf(content: Content, floor: number) {
  return arcRow(content, floor)?.bossGate ?? "none";
}

export function spawnBoss(content: Content, boss: Boss, floor: number): Enemy {
  const e = generateEnemy(boss.family!, "boss", floor, content);
  e.maxHP = e.hp = Math.max(1, Math.round(e.maxHP * boss.hpMult));
  e.xp = Math.round(e.xp * boss.xpMult);
  return e;
}

/** Walking into the boss's room while it's alive. */
export function startBossFight(ctx: StepContext, room: Room, fromRoom: number): void {
  const floor = ctx.game.floor!;
  const boss = room.boss ? ctx.content.bosses.byId[room.boss] : undefined;
  if (!boss?.family) return;
  const enemy = spawnBoss(ctx.content, boss, floor.floor);
  startCombat(ctx, [enemy], {
    fromRoom,
    boss: { id: boss.id, uid: enemy.uid, declines: 0, triggered: false },
    prelude: (c) => bossIntro(c, boss),
  });
}

/** The boss's opening: its intro lines, and maybe its throwaway shard. Runs before any ambush turn. */
function bossIntro(ctx: StepContext, boss: Boss): void {
  for (const line of boss.intro) ctx.fight(line, "enemy");
  const shard = maybeBossShard(ctx, boss.floor);
  if (shard) {
    ctx.fight(shard.clue, "enemy");
    shardFound(ctx, shard, { speaker: boss.name });
  }
}

/** Now and then a boss says something on its turn. */
export function bossTaunt(ctx: StepContext, e: Enemy): void {
  const b = ctx.game.combat?.boss;
  if (!b || b.uid !== e.uid) return;
  const boss = ctx.content.bosses.byId[b.id];
  if (boss && boss.taunts.length && chance(0.35)) ctx.fight(pick(boss.taunts), "enemy");
}

function bossEnemy(ctx: StepContext): { boss: Boss; enemy: Enemy } | undefined {
  const b = ctx.game.combat?.boss;
  const boss = b ? ctx.content.bosses.byId[b.id] : undefined;
  const enemy = b ? ctx.game.combat!.enemies.find((e) => e.uid === b.uid && e.hp > 0) : undefined;
  return boss && enemy ? { boss, enemy } : undefined;
}

/** The weakness lands: its status goes on the boss and the Codex learns it. */
function applyWeakness(ctx: StepContext, boss: Boss, enemy: Enemy): void {
  const eff = boss.weakness.effect;
  if (eff) applyStatus(enemy.statuses, ctx.content.statusEffects.get(eff.status), eff.rounds);
  ctx.game.combat!.boss!.triggered = true;
  if (boss.weakness.line) ctx.fight(boss.weakness.line, "you");
  ctx.say("boss.weakness", { boss: boss.name });
  recordWeakness(ctx, boss.id);
}

/** `decline`: no thank you. Twice, politely, and the Mimic can't touch you. 1 AP. */
export function playerDecline(ctx: StepContext): void {
  const found = bossEnemy(ctx);
  const trigger = found?.boss.weakness.trigger;
  if (!found || trigger?.kind !== "decline") {
    ctx.error("Nobody's offering you anything. Savor it.");
    return;
  }
  if (!beginTurn(ctx) || !canAfford(ctx, AP_COST.item, "Declining politely")) return;
  spendAp(ctx, AP_COST.item);
  const b = ctx.game.combat!.boss!;
  b.declines += 1;
  if (b.declines < trigger.count) {
    ctx.fight(`"No, thank you," you say, politely. The ${found.enemy.name} looks hurt, and a little interested.`, "you");
    ctx.say("boss.declineOne");
  } else if (b.declines === trigger.count) {
    applyWeakness(ctx, found.boss, found.enemy);
  } else {
    ctx.fight(`You decline again. It's already got the message. It's sulking about it.`, "you");
  }
  afterAction(ctx);
}

/**
 * Using (or returning) an item mid-fight: if it's the boss's counter (the tag its
 * weakness names), the weakness lands and the item is spent. Returns true if it handled
 * the item, so the ordinary `use` doesn't.
 */
export function useAgainstBoss(ctx: StepContext, item: ItemInstance): boolean {
  const found = bossEnemy(ctx);
  const trigger = found?.boss.weakness.trigger;
  if (!found || trigger?.kind !== "item" || !item.tags.includes(trigger.tag)) return false;
  if (!beginTurn(ctx) || !canAfford(ctx, AP_COST.item, `Using ${item.name}`)) return true;
  spendAp(ctx, AP_COST.item);
  consumeOne(ctx, item);
  applyWeakness(ctx, found.boss, found.enemy);
  afterAction(ctx);
  return true;
}

/** The boss's counter items you're carrying right now (for buttons). */
export function counterItems(ctx: { game: StepContext["game"]; content: Content }): ItemInstance[] {
  const b = ctx.game.combat?.boss;
  const boss = b ? ctx.content.bosses.byId[b.id] : undefined;
  const trigger = boss?.weakness.trigger;
  if (trigger?.kind !== "item" || !ctx.game.crawler) return [];
  return ctx.game.crawler.inventory.filter((i) => i.tags.includes(trigger.tag));
}

/** Called when a boss fight is won: the lair is cleared, the drops land, the Codex learns the weakness. */
export function bossDefeated(ctx: StepContext): void {
  const b = ctx.game.combat?.boss;
  const floor = ctx.game.floor;
  if (!b || !floor) return;
  const boss = ctx.content.bosses.byId[b.id];
  const room = floor.rooms[floor.currentRoom]!;
  floor.bossDefeated = true;
  delete room.boss;
  if (!boss) return;
  if (boss.defeat) ctx.describe(boss.defeat);
  room.items ??= [];
  if (boss.drops.table) {
    const table = ctx.content.lootTables.get(boss.drops.table);
    for (let n = boss.drops.rolls; n > 0; n--) addToPile(room.items, rollLoot(table, ctx.content, floor.floor));
  }
  for (const id of boss.drops.items) addToPile(room.items, itemFromRef(ctx.content, id, 1, floor.floor));
  // Skills only come from use, or from one of these: every floor boss leaves one.
  const training = ctx.content.lootTables.byId["training"];
  if (training) addToPile(room.items, rollLoot(training, ctx.content, floor.floor));
  // One piece of generated gear, never worse than the floor's boss minimum.
  const gear = ctx.content.floors.get(floor.theme).loot.gear;
  const piece = generateItem(ctx.content, itemLevelFor(floor.floor) + 2, { floor: floor.floor, minRarity: gear.bossMinRarity, narrator: ctx.game.narrator });
  addToPile(room.items, piece);
  ctx.describe(`The ${boss.name} leaves ${piece.name} behind.`);
  ctx.say("boss.defeated", { boss: boss.name });
  // A boss leaves a box: gold for the optional ones, platinum for the one that holds the stairs.
  grantBox(ctx, boss.kind === "mini" ? "gold" : "platinum", "boss", `boss: ${boss.name}`);
  recordWeakness(ctx, boss.id);
}

/** First visit to a room next to a living boss's lair: you hear it, and the lair goes on the map. */
export function bossNearby(ctx: StepContext, room: Room): void {
  const floor = ctx.game.floor!;
  if (floor.bossRoom === undefined || floor.bossDefeated || room.id === floor.bossRoom) return;
  const lair = floor.rooms[floor.bossRoom]!;
  if (lair.marked || !Object.values(room.exits).includes(lair.id)) return;
  lair.marked = true;
  lair.seen = true;
  const boss = lair.boss ? ctx.content.bosses.byId[lair.boss] : undefined;
  if (boss?.nearby) ctx.describe(boss.nearby);
}

/** Picking up a hint item records its boss's weakness (once), with a System AI aside. */
export function noticeHints(ctx: StepContext): void {
  for (const it of ctx.crawler.inventory) {
    const odd = ctx.content.oddities.byId[it.baseId];
    if (!odd?.hintFor || ctx.account.thread.weaknesses.includes(odd.hintFor)) continue;
    const boss = ctx.content.bosses.byId[odd.hintFor];
    if (!boss) continue;
    recordWeakness(ctx, boss.id);
    ctx.say("codex.hint", { item: it.name, boss: boss.name, weakness: boss.weakness.text });
  }
}
