/**
 * Grid enemy AI: the same priority tokens as bands mode, read spatially.
 *
 *   attack            strike if anything reaches; otherwise path to a tile where
 *                     something does (adjacent, or in range with sight) and strike
 *                     if it gets there this turn. Surrounding happens on its own
 *                     because occupied tiles are off limits.
 *   keep_range        back off to its preferred distance (close 1, near 3, far 5)
 *                     while keeping sight of you.
 *   special_if_ready  if a cooldown attack is ready, use it — moving into position
 *                     first if that's possible this turn.
 *   flee_below_N      run for the nearest door; reaching it means it got away.
 *
 * An enemy's turn is AP (3, elites 4): an attack costs 2 unless it says otherwise,
 * and 1 AP buys its speed in tiles. It keeps acting until the AP is gone, so an
 * elite standing next to you swings twice.
 *
 * Ties between equally good tiles go through rng so tests can pin them.
 */
import { attackCost, enemyAp, enemyStrike, markFled, pickAttack, wantsToFlee, type LiveAttack } from "../combat";
import { AP_COST } from "../rules/ap";
import { hazardAt, occupied, pathField, pathTo, affordable, coord, dist, lineOfSight, allTiles, index, reaches, same, type PathField } from "./geometry";
import { pick } from "../rng";
import type { StepContext } from "../step";
import type { ArenaState, Enemy, Pos } from "../state";
import { arenaOf, enemySpeed, standInHazard, walk } from "./units";

const KEEP: Record<string, number> = { close: 1, near: 3, far: 5 };
/** Extra path weight for hazards an enemy can see. */
const AVOID = 3;

function fieldFor(ctx: StepContext, e: Enemy): PathField {
  const combat = ctx.game.combat!;
  const a = arenaOf(ctx);
  return pathField(a, ctx.content, e.pos!, {
    blocked: (p) => occupied(combat, p, e),
    penalty: (p) => {
      const h = hazardAt(a, p);
      return h && ctx.content.arenaFeatures.byId[h.id]?.aiAvoids ? AVOID : 0;
    },
  });
}

/** Best of `tiles` by `score` (higher is better), then cheapest to reach, then a coin flip. */
function choose(a: ArenaState, field: PathField, tiles: Pos[], score: (p: Pos) => number): Pos | undefined {
  if (tiles.length === 0) return undefined;
  const best = Math.max(...tiles.map(score));
  const top = tiles.filter((p) => score(p) === best);
  const cheapest = Math.min(...top.map((p) => field.cost[index(a, p)]!));
  return pick(top.filter((p) => field.cost[index(a, p)] === cheapest));
}

function reachable(a: ArenaState, field: PathField): Pos[] {
  return allTiles(a).filter((p) => field.cost[index(a, p)]! < Infinity);
}

function usableFrom(ctx: StepContext, e: Enemy, from: Pos, specialsOnly: boolean): boolean {
  const a = arenaOf(ctx);
  return e.attacks.some((at) => at.ready === 0 && (!specialsOnly || at.cooldown) && reaches(a, ctx.content, from, a.crawler, at.range));
}

/**
 * Walk toward the cheapest tile from which an attack works (as far as `budget`
 * goes). If nothing works from anywhere, shuffle as close as possible.
 * Returns movement spent.
 */
function approach(ctx: StepContext, e: Enemy, budget: number, specialsOnly: boolean): number {
  const combat = ctx.game.combat!;
  const a = arenaOf(ctx);
  if (budget <= 0) return 0;
  const field = fieldFor(ctx, e);
  const goals = reachable(a, field).filter((p) => !occupied(combat, p, e) && usableFrom(ctx, e, p, specialsOnly));
  const goal = choose(a, field, goals, () => 0);
  if (goal) {
    const steps = affordable(a, ctx.content, pathTo(a, field, goal), budget);
    return steps.length ? walk(ctx, e, steps, budget) : 0;
  }
  if (specialsOnly) return 0;
  // Nothing can reach from any free tile (boxed in): get as close as possible.
  const before = dist(e.pos!, a.crawler);
  const options = reachable(a, field).filter((p) => {
    if (occupied(combat, p, e)) return false;
    const path = pathTo(a, field, p);
    return affordable(a, ctx.content, path, budget).length === path.length;
  });
  const spot = choose(a, field, options, (p) => -dist(p, a.crawler));
  return spot && dist(spot, a.crawler) < before ? walk(ctx, e, pathTo(a, field, spot), budget) : 0;
}

/** Back off toward the preferred distance, keeping sight. Returns movement spent. */
function keepRange(ctx: StepContext, e: Enemy, budget: number): number {
  const combat = ctx.game.combat!;
  const a = arenaOf(ctx);
  const want = KEEP[e.preferRange] ?? 1;
  const now = dist(e.pos!, a.crawler);
  if (now >= want) return 0;
  const field = fieldFor(ctx, e);
  const options = reachable(a, field).filter((p) => {
    if (occupied(combat, p, e)) return false;
    const path = pathTo(a, field, p);
    if (affordable(a, ctx.content, path, budget).length !== path.length) return false;
    const d = dist(p, a.crawler);
    return d > now && d <= want && lineOfSight(a, ctx.content, p, a.crawler);
  });
  const spot = choose(a, field, options, (p) => dist(p, a.crawler));
  if (!spot) return 0;
  const spent = walk(ctx, e, pathTo(a, field, spot), budget);
  if (ctx.game.phase === "combat" && e.hp > 0) ctx.fight(`The ${e.name} skitters back to ${coord(e.pos!)}.`, "enemy");
  return spent;
}

/** Run for the nearest door. On it at the end of the move = gone. */
function runForIt(ctx: StepContext, e: Enemy, budget: number): void {
  const a = arenaOf(ctx);
  if (a.exits.some((x) => same(x, e.pos!))) {
    markFled(ctx, e);
    return;
  }
  const field = fieldFor(ctx, e);
  const doors = a.exits.filter((x) => field.cost[index(a, x)]! < Infinity && !occupied(ctx.game.combat!, x, e));
  const door = choose(a, field, doors, () => 0);
  if (!door) {
    ctx.fight(`The ${e.name} tries to bolt and can't find an opening.`, "enemy");
    return;
  }
  walk(ctx, e, pathTo(a, field, door), budget);
  if (ctx.game.phase !== "combat" || e.hp <= 0) return;
  if (same(e.pos!, door)) markFled(ctx, e);
  else ctx.fight(`The ${e.name} scrambles for the door.`, "enemy");
}

export function runEnemyTurnGrid(ctx: StepContext, e: Enemy): void {
  if (!e.pos) return;
  standInHazard(ctx, e);
  if (ctx.game.phase !== "combat" || e.hp <= 0) return;
  const a = arenaOf(ctx);
  const startDist = dist(e.pos, a.crawler);
  const speed = enemySpeed(ctx, e);
  let ap = enemyAp(ctx, e);
  /** Tiles already paid for. */
  let tiles = 0;
  let struck = false;
  let moved = false;
  let kept = false;
  const ignoreRange = (e.stall ?? 0) >= 2;
  const alive = () => ctx.game.phase === "combat" && e.hp > 0 && !!e.pos;
  /** Tiles it can walk while holding `reserve` AP back for a swing. */
  const budget = (reserve: number) => tiles + Math.max(0, ap - reserve) * AP_COST.move * speed;
  const pay = (spent: number) => {
    if (spent > 0) moved = true;
    tiles -= spent;
    while (tiles < 0 && ap > 0) { ap -= AP_COST.move; tiles += speed; }
    tiles = Math.max(0, tiles);
  };
  const strike = (specialsOnly: boolean): boolean => {
    const attack: LiveAttack | undefined = pickAttack(ctx, e, specialsOnly, ap);
    if (!attack) return false;
    ap -= attackCost(attack);
    struck = true;
    enemyStrike(ctx, e, attack);
    return true;
  };
  /** Cheapest attack that's off cooldown, so it knows how much AP to hold back while walking. */
  const cheapest = (specialsOnly: boolean) => Math.min(...e.attacks
    .filter((at) => at.ready === 0 && (!specialsOnly || at.cooldown)).map(attackCost), Infinity);

  for (let guard = 0; guard < 8 && ap > 0 && alive(); guard++) {
    if (e.ai.some((token) => wantsToFlee(ctx, e, token))) {
      runForIt(ctx, e, budget(0));
      return;
    }
    let acted = false;
    const tokens = e.ai.includes("attack") ? e.ai : [...e.ai, "attack"];
    for (const token of tokens) {
      if (token === "special_if_ready" && cheapest(true) <= ap) {
        if (strike(true)) { acted = true; break; }
        pay(approach(ctx, e, budget(cheapest(true)), true));
        if (!alive()) return;
        if (strike(true)) { acted = true; break; }
      }
      if (token === "keep_range" && !ignoreRange && !kept) {
        kept = true;
        pay(keepRange(ctx, e, budget(cheapest(false))));
        if (!alive()) return;
      }
      if (token === "attack") {
        if (strike(false)) { acted = true; break; }
        const hold = cheapest(false) <= ap ? cheapest(false) : 0;
        const spent = approach(ctx, e, budget(hold), false);
        pay(spent);
        if (!alive()) return;
        if (strike(false)) { acted = true; break; }
        // Couldn't get a swing in: use what was held back to keep closing.
        if (hold > 0 && spent > 0) {
          pay(approach(ctx, e, budget(0), false));
          if (!alive()) return;
        }
        break;
      }
    }
    if (!acted) break;
  }
  if (!alive()) return;
  if (!struck && !moved) ctx.fight(`The ${e.name} circles, looking for an angle.`, "enemy");
  // Stall guard: an enemy that neither hits nor closes for two turns forgets about keeping range.
  const closer = dist(e.pos!, a.crawler) < startDist;
  e.stall = struck || closer ? 0 : (e.stall ?? 0) + 1;
}
