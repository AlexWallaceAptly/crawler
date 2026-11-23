/**
 * Things anyone can do in a fight without abilities (Milestone 4b), so early
 * fights are more than trading swings:
 *
 * Each costs 1 AP (see rules/ap.ts), so there's room for one next to a swing.
 *
 *   shove X       STR contest; win and it's pushed a tile (grid: maybe into the
 *                 caltrops, or slammed into a pillar for 1d4) or a band (bands).
 *   throw X at Y  thrown junk. Grid: up to 3 tiles with sight, always lands on the
 *                 tile; splash hits the 3x3 around it (you too, if you're in it);
 *                 hazards (caltrops, glue, fire, smoke) stay on the board.
 *   dash TILE     grid: run up to double your speed for 1 AP; ends the turn.
 *   defend        braced: a double bane on everything swung at you, and unshovable,
 *                 until your next turn.
 *   take X        grid: pick up loose junk from your tile or next to it (1 tile of movement).
 */
import { burn, igniteUnder } from "./grid/fire";
import {
  afterAction, aliveEnemies, applyItemEffects, beginTurn, canAfford, consumeOne, damageEnemy, endCombat, finishRound,
  findEnemy, isGrid, needsEnemy, shiftEnemyBand, spendAp, type EffectTargets,
} from "./combat";
import { AP_COST } from "./rules/ap";
import type { Consumable } from "./content/schemas";
import { rollDice } from "./rules/dice";
import { collectModifiers, derive, modTotal } from "./rules/derived";
import { applyStatus, hasFlag } from "./rules/effects";
import { d20 } from "./rng";
import { killCrawler, type StepContext } from "./step";
import type { ArenaState, Enemy, ItemInstance, Pos } from "./state";
import {
  allTiles, blocksMove, coord, dist, featureAt, inBounds, isCoord, occupied, parseCoord, reaches, same, unitAt,
} from "./grid/geometry";
import { approachCost, approachTarget, moveBudget, payTiles, planPath, type TileRef } from "./grid/play";
import { arenaOf, crawlerSpeed, walk } from "./grid/units";
import { addToPile, findItems, howManyFit } from "./inventory";

/** How far a throw carries, in tiles. */
export const THROW_RANGE = 3;

function fearBlocks(ctx: StepContext, line: string): boolean {
  if (!hasFlag(ctx.crawler.statuses, ctx.content, "fleeOnly")) return false;
  ctx.fight(line, "status");
  finishRound(ctx);
  return true;
}

// ---------------------------------------------------------------- shove

export function playerShove(ctx: StepContext, target: Enemy): void {
  if (!beginTurn(ctx)) return;
  if (fearBlocks(ctx, "Fear has you backing away, not shoving anybody.")) return;
  if (hasFlag(target.statuses, ctx.content, "untargetable")) {
    ctx.error(`${target.name} can't be targeted right now.`);
    return;
  }
  if (!canAfford(ctx, AP_COST.shove, "A shove")) return;
  const grid = isGrid(ctx);
  if (grid) {
    const a = arenaOf(ctx);
    if (dist(a.crawler, target.pos!) > 1) {
      if (approachCost(ctx, target, "close") > moveBudget(ctx, AP_COST.shove)) {
        ctx.error(`The ${target.name} is too far to reach and still shove this turn. Close in first.`);
        return;
      }
      approachTarget(ctx, target, "close", moveBudget(ctx, AP_COST.shove));
      if (ctx.game.phase !== "combat") return;
      if (dist(a.crawler, target.pos!) > 1) {
        ctx.say("combat.cantReach");
        afterAction(ctx);
        return;
      }
    }
  } else if (target.range !== "close") {
    ctx.error(`The ${target.name} is out of arm's reach. Get close to shove it.`);
    return;
  }
  spendAp(ctx, AP_COST.shove);
  if (hasFlag(target.statuses, ctx.content, "noShove")) {
    ctx.fight(`You shove the ${target.name}. It has its feet planted and doesn't budge.`, "you");
    afterAction(ctx);
    return;
  }
  const c = ctx.crawler;
  const d = derive(c, ctx.content);
  const mods = collectModifiers(c, ctx.content);
  const mine = d20() + d.stats.STR + (c.skills["athletics"]?.rank ?? 0) + modTotal(mods, "shove", "skill:athletics");
  const theirs = d20() + Math.max(target.stats.STR, target.stats.DEX);
  if (mine <= theirs) {
    ctx.fight(`You shove the ${target.name}: ${mine} vs ${theirs}. It shoves back harder.`, "you");
    afterAction(ctx);
    return;
  }
  if (!grid) {
    if (shiftEnemyBand(target, 1)) ctx.fight(`You shove the ${target.name}: ${mine} vs ${theirs}. It staggers back to ${target.range} range.`, "you");
    else ctx.fight(`You shove the ${target.name}: ${mine} vs ${theirs}. It skids, but it was already as far away as it gets.`, "you");
    afterAction(ctx);
    return;
  }
  const a = arenaOf(ctx);
  const from = target.pos!;
  const dest = { x: from.x + Math.sign(from.x - a.crawler.x), y: from.y + Math.sign(from.y - a.crawler.y) };
  const wall = !inBounds(a, dest) ? "the wall"
    : blocksMove(a, ctx.content, dest) ? `the ${featureAt(a, ctx.content, dest)!.name.toLowerCase()}`
    : occupied(ctx.game.combat!, dest) ? nameAt(ctx, dest)
    : null;
  if (wall) {
    ctx.fight(`You shove the ${target.name}: ${mine} vs ${theirs}.`, "you");
    damageEnemy(ctx, target, rollDice("1d4").total, `The ${target.name} slams into ${wall}`);
  } else {
    ctx.fight(`You shove the ${target.name}: ${mine} vs ${theirs}. It stumbles back to ${coord(dest)}.`, "you");
    walk(ctx, target, [dest], 99);
  }
  afterAction(ctx);
}

function nameAt(ctx: StepContext, p: Pos): string {
  const u = unitAt(ctx.game.combat!, p);
  return u === "crawler" ? "you" : u ? `the ${u.name}` : "something";
}

// ---------------------------------------------------------------- throw

/** Tiles a thrown hazard covers around where it lands. */
export function shapeTiles(a: ArenaState, at: Pos, shape: "single" | "plus" | "square"): Pos[] {
  const out: Pos[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const keep = shape === "square" || (dx === 0 && dy === 0) || (shape === "plus" && (dx === 0 || dy === 0));
      const p = { x: at.x + dx, y: at.y + dy };
      if (keep && inBounds(a, p)) out.push(p);
    }
  }
  return out;
}

/** Tiles you can throw at from where you stand. */
export function throwTargets(a: ArenaState, content: Parameters<typeof reaches>[1]): Pos[] {
  return allTiles(a).filter((p) =>
    !same(p, a.crawler) && !blocksMove(a, content, p) && dist(p, a.crawler) <= THROW_RANGE &&
    reaches(a, content, a.crawler, p, "near"));
}

export function isThrowable(def: Consumable): boolean {
  return def.tags.includes("thrown") || !!def.hazard || needsEnemy(def);
}

export function playerThrow(ctx: StepContext, item: ItemInstance, at?: string): void {
  const def = ctx.content.items.consumables.byId[item.baseId];
  if (!def || !isThrowable(def)) {
    ctx.error(`Throwing ${item.name} won't do anything useful. Try \`use\`, or combine it with something.`);
    return;
  }
  if (ctx.game.phase !== "combat") {
    ctx.error(`Nothing here deserves the ${item.name}. Yet.`);
    return;
  }
  if (!def.usableInCombat && !def.hazard) {
    ctx.error(`${item.name} takes more peace and quiet than you currently have.`);
    return;
  }
  if (!beginTurn(ctx)) return;
  if (fearBlocks(ctx, "Your hands are shaking too hard to aim anything.")) return;
  if (!canAfford(ctx, AP_COST.throw, `Throwing ${item.name}`)) return;

  if (!isGrid(ctx)) {
    const foes = aliveEnemies(ctx).filter((e) => !hasFlag(e.statuses, ctx.content, "untargetable"));
    const primary = (at ? findEnemy(ctx, at) : undefined) ?? foes[0];
    spendAp(ctx, AP_COST.throw);
    consumeOne(ctx, item);
    const applied = applyItemEffects(ctx, def, { area: foes, ...(primary ? { primary } : {}) });
    ctx.fight(`You throw ${item.name}${primary ? ` at the ${primary.name}` : ""}${applied.length ? ` (${applied.join(", ")})` : ""}.`, "you");
    return afterSelfHarm(ctx, item.name);
  }

  const a = arenaOf(ctx);
  const tile = resolveThrowTile(ctx, at);
  if (typeof tile === "string") {
    ctx.error(tile);
    return;
  }
  const foes = aliveEnemies(ctx).filter((e) => e.pos && !hasFlag(e.statuses, ctx.content, "untargetable"));
  const primary = foes.find((e) => same(e.pos!, tile));
  const t: EffectTargets = {
    area: foes.filter((e) => dist(e.pos!, tile) <= 1),
    selfInArea: dist(a.crawler, tile) <= 1,
    ...(primary ? { primary } : {}),
  };
  spendAp(ctx, AP_COST.throw);
  consumeOne(ctx, item);
  const applied = applyItemEffects(ctx, def, t);
  ctx.fight(`You throw ${item.name} at ${coord(tile)}${primary ? `, right at the ${primary.name}` : ""}${applied.length ? ` (${applied.join(", ")})` : ""}.`, "you");
  if (def.hazard && ctx.crawler.hp > 0) {
    const f = ctx.content.arenaFeatures.get(def.hazard.id);
    const tiles = shapeTiles(a, tile, def.hazard.shape).filter((p) => !blocksMove(a, ctx.content, p));
    for (const p of tiles) {
      a.hazards = a.hazards.filter((h) => !same(h, p));
      a.hazards.push({ x: p.x, y: p.y, id: f.id, ...(f.rounds ? { rounds: f.rounds } : {}) });
    }
    ctx.fight(`${f.name} now covers ${tiles.length === 1 ? coord(tile) : `${coord(tile)} and around it`}.`, "status");
  }
  if (ctx.game.phase === "combat" && ctx.crawler.hp > 0) {
    // Fire meets oil: thrown flame lights touching slicks; thrown oil next to flame catches.
    burn(ctx);
    const fireAt = (target: "target" | "all_enemies") => def.effects.some((e) => e.target === target && e.kind === "damage" && e.damageType === "fire");
    if (primary) igniteUnder(ctx, primary, fireAt("target") || fireAt("all_enemies"));
    for (const e of t.area) if (e !== primary) igniteUnder(ctx, e, fireAt("all_enemies"));
  }
  afterSelfHarm(ctx, item.name);
}

function afterSelfHarm(ctx: StepContext, cause: string): void {
  if (ctx.game.phase !== "combat") return; // already over (the fire you started got you)
  if (ctx.crawler.hp <= 0) {
    endCombat(ctx);
    killCrawler(ctx, `their own ${cause.toLowerCase()}`);
    return;
  }
  afterAction(ctx);
}

/** A coordinate, an enemy's name, or (nothing) the nearest enemy you can hit. */
function resolveThrowTile(ctx: StepContext, at?: string): Pos | string {
  const a = arenaOf(ctx);
  let tile: Pos | null = null;
  if (at && isCoord(at)) tile = parseCoord(at);
  else if (at) {
    const e = findEnemy(ctx, at);
    if (!e?.pos) return `Nothing here called "${at}".`;
    tile = e.pos;
  } else {
    const inRange = aliveEnemies(ctx).filter((e) => e.pos && dist(e.pos, a.crawler) <= THROW_RANGE &&
      reaches(a, ctx.content, a.crawler, e.pos, "near"));
    inRange.sort((x, y) => dist(x.pos!, a.crawler) - dist(y.pos!, a.crawler));
    if (!inRange[0]) return `Nothing's within ${THROW_RANGE} tiles that you can see. Say where: throw it at a tile like d4.`;
    tile = inRange[0].pos!;
  }
  if (!tile || !inBounds(a, tile)) return "That's not on the board.";
  if (dist(a.crawler, tile) > THROW_RANGE) return `${coord(tile)} is too far to throw to (${THROW_RANGE} tiles at most).`;
  if (blocksMove(a, ctx.content, tile)) return `There's a ${featureAt(a, ctx.content, tile)!.name.toLowerCase()} in the way at ${coord(tile)}.`;
  if (!reaches(a, ctx.content, a.crawler, tile, "near")) return `You can't see ${coord(tile)} from here.`;
  return tile;
}

// ---------------------------------------------------------------- dash / defend

export function gridDash(ctx: StepContext, to: TileRef): void {
  if (!isGrid(ctx)) {
    ctx.error("No board in this fight. Advance or retreat instead.");
    return;
  }
  if (!canAfford(ctx, AP_COST.dash, "A dash")) return;
  const a = arenaOf(ctx);
  const budget = a.moveLeft + 2 * crawlerSpeed(ctx);
  const plan = planPath(ctx, to, budget);
  if (typeof plan === "string") {
    ctx.error(plan);
    return;
  }
  spendAp(ctx, AP_COST.dash);
  walk(ctx, "crawler", plan, budget);
  if (ctx.game.phase !== "combat") return;
  a.moveLeft = 0;
  ctx.fight(`You sprint to ${coord(a.crawler)}.`, "you");
  finishRound(ctx);
}

export function playerDefend(ctx: StepContext): void {
  if (!canAfford(ctx, AP_COST.defend, "Bracing")) return;
  spendAp(ctx, AP_COST.defend);
  const def = ctx.content.statusEffects.get("braced");
  applyStatus(ctx.crawler.statuses, def, 1);
  ctx.fight("You plant your feet and get your guard up.", "you");
  afterAction(ctx);
}

/** Statuses that only last until your next turn starts (braced). Called by beginTurn. */
export function dropTurnStatuses(ctx: StepContext): void {
  const c = ctx.crawler;
  c.statuses = c.statuses.filter((s) => !ctx.content.statusEffects.byId[s.id]?.flags.includes("endsOnTurnStart"));
}

// ---------------------------------------------------------------- loose junk on the board

/** Grid: pick up something on your tile or next to it. Costs one tile of movement. */
export function takeInArena(ctx: StepContext, query: string): void {
  if (!isGrid(ctx)) {
    ctx.error("You're a little busy to go through your pockets' future contents. Fight first.");
    return;
  }
  const a = arenaOf(ctx);
  const near = a.items.filter((it) => dist(it, a.crawler) <= 1);
  const pick = findItems(near.map((n) => n.item), query)[0];
  if (!pick) {
    ctx.error(near.length ? `Nothing called "${query}" within reach.` : "Nothing within reach to pick up. Walk next to it first.");
    return;
  }
  if (howManyFit(ctx, pick) < pick.qty) {
    ctx.say("item.tooHeavy", { item: pick.name });
    return;
  }
  if (!payTiles(ctx, 1)) {
    ctx.error("No AP left to bend down this turn.");
    return;
  }
  a.items = a.items.filter((n) => n.item !== pick);
  addToPile(ctx.crawler.inventory, pick);
  ctx.fight(`You snatch up ${pick.name} (${ctx.game.combat!.ap} AP left).`, "you");
  afterAction(ctx);
}
