/**
 * The crawler's grid actions. Movement is the grid's minor action: up to your
 * speed in tiles per turn, any number of `move` commands, and it never ends the
 * turn. Every main action (attack, flee, use, talk, wait) does.
 */
import {
  aliveEnemies, closeRound, finishRound, fleeContest, freeSwings, leaveCombat, endCombat, type WeaponProfile,
} from "../combat";
import { hasFlag } from "../rules/effects";
import { travel, type StepContext } from "../step";
import type { ArenaExit, Enemy, Pos } from "../state";
import {
  affordable, allTiles, coord, DIR8, dist, exitAt, index, inBounds, occupied, pathField, pathTo, reaches, same,
  stepCost, blocksMove, type Dir8, type PathField,
} from "./geometry";
import { pick } from "../rng";
import { arenaOf, walk } from "./units";

export type TileRef = Pos | { dir: Dir8; steps: number };

function crawlerField(ctx: StepContext): PathField {
  const combat = ctx.game.combat!;
  const a = arenaOf(ctx);
  return pathField(a, ctx.content, a.crawler, { blocked: (p) => occupied(combat, p, "crawler") });
}

/** Every tile the crawler can walk to with the movement left this turn. */
export function reachableTiles(ctx: StepContext, budget = arenaOf(ctx).moveLeft): Pos[] {
  const a = arenaOf(ctx);
  const field = crawlerField(ctx);
  return allTiles(a).filter((p) => {
    const c = field.cost[index(a, p)]!;
    return c > 0 && c <= budget;
  });
}

function spend(ctx: StepContext, path: Pos[]): number {
  const a = arenaOf(ctx);
  const spent = walk(ctx, "crawler", path, a.moveLeft);
  if (ctx.game.combat?.arena) ctx.game.combat.arena.moveLeft -= spent;
  return spent;
}

/** `move c4` or `move ne 2`. Doesn't end the turn. */
export function gridMove(ctx: StepContext, to: TileRef): void {
  const a = arenaOf(ctx);
  if (a.moveLeft <= 0) {
    ctx.error("You're out of movement this turn. Act, or `wait`.");
    return;
  }
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
    if (path.length === 0) {
      ctx.error("Something's in the way.");
      return;
    }
  } else {
    if (!inBounds(a, to)) {
      ctx.error(`${coord(to)} isn't on the board.`);
      return;
    }
    if (same(to, a.crawler)) {
      ctx.error("You're already standing there. Impressive commitment.");
      return;
    }
    const field = crawlerField(ctx);
    const cost = field.cost[index(a, to)]!;
    if (cost === Infinity) {
      ctx.error(`You can't get to ${coord(to)} from here.`);
      return;
    }
    if (cost > a.moveLeft) {
      ctx.error(`${coord(to)} is ${cost} movement away; you have ${a.moveLeft} left this turn.`);
      return;
    }
    path = pathTo(a, field, to);
  }
  const steps = affordable(a, ctx.content, path, a.moveLeft);
  if (steps.length === 0) {
    ctx.error(`That costs ${stepCost(a, ctx.content, path[0]!)} movement; you have ${a.moveLeft} left.`);
    return;
  }
  spend(ctx, steps);
  if (ctx.game.phase !== "combat") return;
  ctx.fight(`You move to ${coord(a.crawler)}${a.moveLeft > 0 ? ` (${a.moveLeft} movement left)` : ""}.`, "you");
}

/**
 * Attack helper: walk (with the movement left) to the cheapest tile from which
 * the weapon reaches `target`. Returns true if the target is now in reach.
 */
export function approachTarget(ctx: StepContext, target: Enemy, w: WeaponProfile): boolean {
  const a = arenaOf(ctx);
  const combat = ctx.game.combat!;
  if (!target.pos) return false;
  const field = crawlerField(ctx);
  const goals = allTiles(a).filter((p) =>
    field.cost[index(a, p)]! < Infinity && !occupied(combat, p, "crawler") &&
    reaches(a, ctx.content, p, target.pos!, w.reach));
  if (goals.length === 0) return false;
  const cheapest = Math.min(...goals.map((p) => field.cost[index(a, p)]!));
  const goal = pick(goals.filter((p) => field.cost[index(a, p)] === cheapest));
  const steps = affordable(a, ctx.content, pathTo(a, field, goal), a.moveLeft);
  if (steps.length) {
    spend(ctx, steps);
    if (ctx.game.phase !== "combat") return false;
    ctx.fight(`You close in to ${coord(a.crawler)}.`, "you");
  }
  return reaches(a, ctx.content, a.crawler, target.pos!, w.reach);
}

/** `advance`: walk toward the nearest enemy with the movement left. */
export function gridAdvance(ctx: StepContext): void {
  const a = arenaOf(ctx);
  if (a.moveLeft <= 0) {
    ctx.error("You've used your movement this turn.");
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
  approachTarget(ctx, target, { name: "", dice: "1", stat: "STR", reach: "close" });
}

/** `retreat`: the reachable tile farthest from every enemy. */
export function gridRetreat(ctx: StepContext): void {
  const a = arenaOf(ctx);
  if (a.moveLeft <= 0) {
    ctx.error("You've used your movement this turn.");
    return;
  }
  const foes = aliveEnemies(ctx).filter((e) => e.pos);
  const safety = (p: Pos) => Math.min(...foes.map((e) => dist(e.pos!, p)), 99);
  const options = reachableTiles(ctx);
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
  spend(ctx, pathTo(a, field, spot));
  if (ctx.game.phase === "combat") ctx.fight(`You fall back to ${coord(a.crawler)}.`, "you");
}

/**
 * `flee`: on a door, run the DEX contest against anything within 3 tiles that can
 * see you (nothing close = a free exit). Not on a door: run for the nearest one;
 * if you get there this turn the contest happens now, otherwise the turn ends.
 */
export function gridFlee(ctx: StepContext): void {
  const a = arenaOf(ctx);
  let exit = exitAt(a, a.crawler);
  if (!exit) {
    const field = crawlerField(ctx);
    const doors = a.exits.filter((x) => field.cost[index(a, x)]! < Infinity && !occupied(ctx.game.combat!, x, "crawler"));
    if (doors.length === 0) {
      ctx.fight("Every way out is blocked. Fight or die; your choice, briefly.", "you");
      finishRound(ctx);
      return;
    }
    const cheapest = Math.min(...doors.map((x) => field.cost[index(a, x)]!));
    const door = doors.find((x) => field.cost[index(a, x)] === cheapest)!;
    spend(ctx, affordable(a, ctx.content, pathTo(a, field, door), a.moveLeft));
    if (ctx.game.phase !== "combat") return;
    exit = exitAt(a, a.crawler);
    if (!exit) {
      ctx.fight(`You run for the ${door.dir} door.`, "you");
      finishRound(ctx);
      return;
    }
  }
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
  endCombat(ctx);
  ctx.emit({ type: "combatEnded", outcome: "fled" });
  ctx.setPhase("exploring");
  ctx.describe(`You crash through the ${exit.dir} door and keep going.`);
  travel(ctx, dest);
}
