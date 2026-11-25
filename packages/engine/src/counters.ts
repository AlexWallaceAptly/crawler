/**
 * Counters (Milestone 7). `crawler.counters` is a flat bag of numbers the achievement engine
 * reads (`{ counter: "kills.rat", gte: 50 }`). Handlers don't bump counters themselves: they
 * emit the event, and `countEvents` turns this step's events into bumps in one place.
 *
 * Names: `kills.total`, `kills.<family>`, `kills.<tier>`, `damage.taken`, `hits.taken`,
 * `items.used`, `items.<type>`, `spells.cast`, `spells.<school>`, `crafts`, `checks.total`,
 * `checks.crit`, `checks.fumble`, `rooms.entered`, `rooms.safe`, `combats.won`, `combats.fled`,
 * `gold.earned`, `gold.spent`, `boxes.earned`, `boxes.opened`, `shop.bought`, `shop.sold`,
 * `levels`, `shards`, `modules`, `floors.cleared`, and (Milestone 9) `kills.champion`,
 * `districts.entered`.
 */
import type { GameEventBody } from "./events";
import { derive } from "./rules/derived";
import type { Crawler } from "./state";
import type { StepContext } from "./step";

export function bump(c: Crawler, key: string, n = 1): void {
  c.counters[key] = (c.counters[key] ?? 0) + n;
}

/** What each event adds to the counters. */
function bumpsFor(e: GameEventBody): [string, number][] {
  switch (e.type) {
    case "kill":
      return [["kills.total", 1], [`kills.${e.family}`, 1], [`kills.${e.tier}`, 1], ...(e.champion ? [["kills.champion", 1] as [string, number]] : [])];
    case "damageTaken":
      return [["damage.taken", e.amount], ["hits.taken", 1]];
    case "itemUsed":
      return [["items.used", 1], [`items.${e.itemType}`, 1]];
    case "spellCast":
      return [["spells.cast", 1], [`spells.${e.school}`, 1]];
    case "crafted":
      return [["crafts", 1]];
    case "check": {
      const out: [string, number][] = [["checks.total", 1]];
      if (e.result.natural === 20) out.push(["checks.crit", 1]);
      if (e.result.natural === 1) out.push(["checks.fumble", 1]);
      return out;
    }
    case "roomEntered":
      return e.first ? [["rooms.entered", 1], ...(e.badge === "SAFE ROOM" ? [["rooms.safe", 1] as [string, number]] : [])] : [];
    case "combatEnded":
      return [[e.outcome === "victory" ? "combats.won" : e.outcome === "fled" ? "combats.fled" : "combats.talked", 1]];
    case "goldChanged":
      return e.delta > 0 ? [["gold.earned", e.delta]] : [["gold.spent", -e.delta]];
    case "boxEarned":
      return [["boxes.earned", 1]];
    case "boxOpened":
      return [["boxes.opened", 1]];
    case "shopBought":
      return [["shop.bought", 1]];
    case "shopSold":
      return [["shop.sold", 1]];
    case "levelUp":
      return [["levels", 1]];
    case "shardFound":
      return [["shards", 1]];
    case "moduleBuilt":
      return [["modules", 1]];
    case "floorCleared":
      return [["floors.cleared", 1]];
    case "districtEntered":
      return [["districts.entered", 1]];
    default:
      return [];
  }
}

/** Fold a step's events into the counters. Called once per step, before achievements are checked. */
export function countEvents(c: Crawler, events: readonly GameEventBody[]): void {
  for (const e of events) for (const [key, n] of bumpsFor(e)) bump(c, key, n);
}

/** The crawler lost HP: tell the counters and the achievement engine. Call after the HP is taken off. */
export function emitDamageTaken(ctx: StepContext, amount: number, source: string, cause: string): void {
  const c = ctx.crawler;
  const max = derive(c, ctx.content).maxHP;
  const hp = Math.max(0, c.hp);
  ctx.emit({ type: "damageTaken", amount, source, cause, hp, hpPct: Math.round((hp / max) * 100) });
}
