/**
 * The crawler's grid actions. Movement is bought with AP: 1 AP pays for your
 * speed in tiles, spent across as many `move` commands as you like. Walking
 * farther than what's paid for buys another AP's worth automatically.
 */
import {
  afterAction, aliveEnemies, canAfford, closeRound, finishRound, fledEvent, fleeContest, freeSwings, leaveCombat, endCombat, spendAp,
} from "../combat";
import type { RangeBand } from "../content/schemas";
import { AP_COST } from "../rules/ap";
import { hasFlag } from "../rules/effects";
import { travel, type StepContext } from "../step";
import type { ArenaExit, Enemy, Pos } from "../state";
import {
  affordable, allTiles, coord, DIR8, dist, exitAt, index, inBounds, occupied, pathField, pathTo, reaches, same,
  stepCost, blocksMove, type Dir8, type PathField,
} from "./geometry";
import { pick } from "../rng";
import { arenaOf, crawlerSpeed, walk } from "./units";

export type TileRef = Pos | { dir: Dir8; steps: number };

function crawlerField(ctx: StepContext): PathField {
  const combat = ctx.game.combat!;
  const a = arenaOf(ctx);
  return pathField(a, ctx.content, a.crawler, { blocked: (p) => occupied(combat, p, "crawler") });
}

/**
 * Tiles the crawler can still walk this turn: what's already paid for, plus what
 * the remaining AP would buy. `reserve` holds AP back (for the swing at the end).
 */
export function moveBudget(ctx: StepContext, reserve = 0): number {
  const combat = ctx.game.combat!;
  return arenaOf(ctx).moveLeft + Math.max(0, combat.ap - reserve) * AP_COST.move * crawlerSpeed(ctx);
}

/** What one more "go somewhere" is worth: the paid-for tiles if there are any, else one AP's worth. */
function oneMove(ctx: StepContext): number {
  const a = arenaOf(ctx);
  if (a.moveLeft > 0) return a.moveLeft;
  return ctx.game.combat!.ap >= AP_COST.move ? crawlerSpeed(ctx) : 0;
}

/**
 * Pay `n` tiles of movement for something that isn't walking (stooping for junk,
 * swapping gear), buying an AP's worth if nothing's in hand. False if it can't be paid.
 */
export function payTiles(ctx: StepContext, n: number): boolean {
  const combat = ctx.game.combat!;
  const a = arenaOf(ctx);
  if (moveBudget(ctx) < n) return false;
  a.moveLeft -= n;
  while (a.moveLeft < 0) {
    combat.ap -= AP_COST.move;
    a.moveLeft += crawlerSpeed(ctx);
  }
  return true;
}

/** Every tile the crawler can walk to with the movement it can still pay for this turn. */
export function reachableTiles(ctx: StepContext, budget = moveBudget(ctx)): Pos[] {
  const a = arenaOf(ctx);
  const field = crawlerField(ctx);
  return allTiles(a).filter((p) => {
    const c = field.cost[index(a, p)]!;
    return c > 0 && c <= budget;
  });
}

/** Walk `path` (already trimmed to `budget`), paying from the tiles in hand and buying more with AP as needed. */
function spend(ctx: StepContext, path: Pos[], budget: number): number {
  const speed = crawlerSpeed(ctx);
  const spent = walk(ctx, "crawler", path, budget);
  const combat = ctx.game.combat;
  if (combat?.arena) {
    combat.arena.moveLeft -= spent;
    while (combat.arena.moveLeft < 0 && combat.ap > 0) {
      combat.ap -= AP_COST.move;
      combat.arena.moveLeft += speed;
    }
    combat.arena.moveLeft = Math.max(0, combat.arena.moveLeft);
  }
  return spent;
}

/**
 * Route for `move`/`dash`: a tile ("c4") or a direction with a step count. Returns
 * the affordable steps, or a reason it can't be done.
 */
export function planPath(ctx: StepContext, to: TileRef, budget: number): Pos[] | string {
  const a = arenaOf(ctx);
  if (budget <= 0) return "You're out of AP to move with this turn.";
  let path: Pos[];
  if ("dir" in to) {
    path = [];
    let at = a.crawler;
    const [dx, dy] = DIR8[to.dir];
    for (let i = 0; i < to.steps; i++) {
      const next = { x: at.x + dx, y: at.y + dy };
      if (!inBounds(a, next) || blocksMove(a, ctx.content, next) || occupied(ctx.game.combat!, next, "crawler")) break;
      if (dx !== 0 && dy !== 0 &&
        blocksMove(a, ctx.content, { x: at.x + dx, y: at.y }) && blocksMove(a, ctx.content, { x: at.x, y: at.y + dy })) break;
      path.push(next);
      at = next;
    }
    if (path.length === 0) return "Something's in the way.";
  } else {
    if (!inBounds(a, to)) return `${coord(to)} isn't on the board.`;
    if (same(to, a.crawler)) return "You're already standing there. Impressive commitment.";
    const field = crawlerField(ctx);
    const cost = field.cost[index(a, to)]!;
    if (cost === Infinity) return `You can't get to ${coord(to)} from here.`;
    if (cost > budget) return `${coord(to)} is ${cost} movement away; you have ${budget}.`;
    path = pathTo(a, field, to);
  }
  const steps = affordable(a, ctx.content, path, budget);
  if (steps.length === 0) return `That costs ${stepCost(a, ctx.content, path[0]!)} movement; you have ${budget}.`;
  return steps;
}

/** `move c4` or `move ne 2`. 1 AP per stretch of your speed. */
export function gridMove(ctx: StepContext, to: TileRef): void {
  const a = arenaOf(ctx);
  const budget = moveBudget(ctx);
  const plan = planPath(ctx, to, budget);
  if (typeof plan === "string") {
    ctx.error(plan);
    return;
  }
  spend(ctx, plan, budget);
  if (ctx.game.phase !== "combat") return;
  ctx.fight(`You move to ${coord(a.crawler)}${leftover(ctx)}.`, "you");
  afterAction(ctx);
}

function leftover(ctx: StepContext): string {
  const combat = ctx.game.combat!;
  const tiles = combat.arena?.moveLeft ?? 0;
  return ` (${combat.ap} AP left${tiles > 0 ? `, ${tiles} more ${tiles === 1 ? "tile" : "tiles"} paid for` : ""})`;
}

function approachPlan(ctx: StepContext, target: Enemy, reach: RangeBand): { goal: Pos; cost: number; field: PathField } | null {
  const a = arenaOf(ctx);
  const combat = ctx.game.combat!;
  if (!target.pos) return null;
  const field = crawlerField(ctx);
  const goals = allTiles(a).filter((p) =>
    field.cost[index(a, p)]! < Infinity && !occupied(combat, p, "crawler") &&
    reaches(a, ctx.content, p, target.pos!, reach));
  if (goals.length === 0) return null;
  const cheapest = Math.min(...goals.map((p) => field.cost[index(a, p)]!));
  return { goal: pick(goals.filter((p) => field.cost[index(a, p)] === cheapest)), cost: cheapest, field };
}

/** Movement it takes to get somewhere `reach` works against `target` (0 if it already does; Infinity if nowhere does). */
export function approachCost(ctx: StepContext, target: Enemy, reach: RangeBand): number {
  const a = arenaOf(ctx);
  if (target.pos && reaches(a, ctx.content, a.crawler, target.pos, reach)) return 0;
  return approachPlan(ctx, target, reach)?.cost ?? Infinity;
}

/**
 * Walk (up to `budget` tiles, buying movement with AP as needed) to the cheapest
 * tile from which `reach` works against `target`. Returns true if it's in reach now.
 */
export function approachTarget(ctx: StepContext, target: Enemy, reach: RangeBand, budget: number): boolean {
  const a = arenaOf(ctx);
  const plan = approachPlan(ctx, target, reach);
  if (!plan) return false;
  const steps = affordable(a, ctx.content, pathTo(a, plan.field, plan.goal), budget);
  if (steps.length) {
    spend(ctx, steps, budget);
    if (ctx.game.phase !== "combat") return false;
    ctx.fight(`You close in to ${coord(a.crawler)}.`, "you");
  }
  return reaches(a, ctx.content, a.crawler, target.pos!, reach);
}

/** `advance`: walk toward the nearest enemy, one AP's worth at a time. */
export function gridAdvance(ctx: StepContext): void {
  const a = arenaOf(ctx);
  const budget = oneMove(ctx);
  if (budget <= 0) {
    ctx.error("You're out of AP to move with this turn.");
    return;
  }
  const foes = aliveEnemies(ctx).filter((e) => e.pos);
  if (foes.length === 0) return;
  const nearest = Math.min(...foes.map((e) => dist(e.pos!, a.crawler)));
  const target = pick(foes.filter((e) => dist(e.pos!, a.crawler) === nearest));
  if (nearest <= 1) {
    ctx.error("You're already in its face.");
    return;
  }
  const from = { ...a.crawler };
  approachTarget(ctx, target, "close", budget);
  if (ctx.game.phase !== "combat") return;
  if (same(from, a.crawler)) {
    ctx.error("There's no way to get any closer from here.");
    return;
  }
  afterAction(ctx);
}

/** `retreat`: the reachable tile farthest from every enemy. */
export function gridRetreat(ctx: StepContext): void {
  const a = arenaOf(ctx);
  const budget = oneMove(ctx);
  if (budget <= 0) {
    ctx.error("You're out of AP to move with this turn.");
    return;
  }
  const foes = aliveEnemies(ctx).filter((e) => e.pos);
  const safety = (p: Pos) => Math.min(...foes.map((e) => dist(e.pos!, p)), 99);
  const options = reachableTiles(ctx, budget);
  if (options.length === 0) {
    ctx.error("Nowhere to back off to.");
    return;
  }
  const best = Math.max(...options.map(safety));
  if (best <= safety(a.crawler)) {
    ctx.error("Backing up won't buy you anything from here.");
    return;
  }
  const field = crawlerField(ctx);
  const spot = pick(options.filter((p) => safety(p) === best));
  spend(ctx, pathTo(a, field, spot), budget);
  if (ctx.game.phase === "combat") ctx.fight(`You fall back to ${coord(a.crawler)}${leftover(ctx)}.`, "you");
  afterAction(ctx);
}

/**
 * `flee`: on a door, 2 AP runs the DEX contest against anything within 3 tiles
 * that can see you (nothing close = a free exit). Not on a door: run for the
 * nearest one with whatever AP it takes; if there's still 2 AP when you get
 * there the contest happens now, otherwise the turn ends where you stand.
 */
export function gridFlee(ctx: StepContext): void {
  const a = arenaOf(ctx);
  const combat = ctx.game.combat!;
  let exit = exitAt(a, a.crawler);
  if (!exit) {
    const field = crawlerField(ctx);
    const doors = a.exits.filter((x) => field.cost[index(a, x)]! < Infinity && !occupied(combat, x, "crawler"));
    if (doors.length === 0) {
      ctx.fight("Every way out is blocked. Fight or die; your choice, briefly.", "you");
      finishRound(ctx);
      return;
    }
    const cheapest = Math.min(...doors.map((x) => field.cost[index(a, x)]!));
    const door = doors.find((x) => field.cost[index(a, x)] === cheapest)!;
    const budget = moveBudget(ctx);
    spend(ctx, affordable(a, ctx.content, pathTo(a, field, door), budget), budget);
    if (ctx.game.phase !== "combat") return;
    exit = exitAt(a, a.crawler);
    if (!exit || combat.ap < AP_COST.flee) {
      ctx.fight(exit ? `You reach the ${door.dir} door with nothing left to get through it.` : `You run for the ${door.dir} door.`, "you");
      finishRound(ctx);
      return;
    }
  }
  if (!canAfford(ctx, AP_COST.flee, "Getting out the door")) return;
  spendAp(ctx, AP_COST.flee);
  const chasers = aliveEnemies(ctx).filter((e) => e.pos && dist(e.pos, a.crawler) <= 3 &&
    !hasFlag(e.statuses, ctx.content, "skipTurn") && reaches(a, ctx.content, e.pos, a.crawler, "near"));
  if (fleeContest(ctx, chasers)) {
    leaveThrough(ctx, exit);
    return;
  }
  freeSwings(ctx, chasers);
  closeRound(ctx);
}

function leaveThrough(ctx: StepContext, exit: ArenaExit): void {
  const combat = ctx.game.combat!;
  const floor = ctx.game.floor!;
  if (exit.entry) {
    leaveCombat(ctx, combat.fromRoom);
    return;
  }
  const dest = floor.rooms[floor.currentRoom]!.exits[exit.dir];
  if (dest === undefined) {
    leaveCombat(ctx, combat.fromRoom);
    return;
  }
  const ended = fledEvent(ctx);
  endCombat(ctx);
  ctx.emit(ended);
  ctx.setPhase("exploring");
  ctx.describe(`You crash through the ${exit.dir} door and keep going.`);
  travel(ctx, dest);
}
