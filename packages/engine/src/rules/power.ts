/**
 * Power rolls: how every attack in a fight resolves. Nothing misses.
 *
 *   2d10 + bonus, shifted 2 per net edge or bane (at most two either way)
 *   11 or less  tier 1   a weak hit
 *   12 to 16    tier 2   a solid hit
 *   17 or more  tier 3   a great hit
 *   natural 19-20 on the dice: a crit, tier 3 whatever the total
 *
 * An attack lists its damage per tier ([t1, t2, t3]); the roll picks which one.
 * Checks outside combat still use the d20 in checks.ts.
 */
import type { Power } from "../content/schemas";
import { d10 } from "../rng";

export type Tier = 1 | 2 | 3;

export const TIER_2 = 12;
export const TIER_3 = 17;
export const CRIT_NATURAL = 19;
/** What one edge or bane is worth on the total. */
export const EDGE = 2;
export const MAX_EDGES = 2;

export interface PowerRoll {
  dice: [number, number];
  natural: number;
  bonus: number;
  /** Net edges (positive) or banes (negative) after capping. */
  net: number;
  total: number;
  tier: Tier;
  crit: boolean;
}

export function tierOf(total: number): Tier {
  return total >= TIER_3 ? 3 : total >= TIER_2 ? 2 : 1;
}

export function powerRoll(bonus: number, edges = 0, banes = 0): PowerRoll {
  const a = d10();
  const b = d10();
  const natural = a + b;
  const net = Math.max(-MAX_EDGES, Math.min(MAX_EDGES, edges - banes));
  const total = natural + bonus + net * EDGE;
  const crit = natural >= CRIT_NATURAL;
  return { dice: [a, b], natural, bonus, net, total, tier: crit ? 3 : tierOf(total), crit };
}

/** "2d10(7+5)+4, edge = 18" */
export function describePower(r: PowerRoll): string {
  const bonus = r.bonus === 0 ? "" : r.bonus > 0 ? `+${r.bonus}` : `${r.bonus}`;
  const shift = r.net === 0 ? "" : `, ${Math.abs(r.net) > 1 ? "double " : ""}${r.net > 0 ? "edge" : "bane"}`;
  return `2d10(${r.dice[0]}+${r.dice[1]})${bonus}${shift} = ${r.total}`;
}

/** A defender's guard as edges or banes for whoever is swinging at it: every 2 points counts once. */
export function guardShift(guard: number): { edges: number; banes: number } {
  const n = Math.trunc(Math.abs(guard) / EDGE);
  return guard > 0 ? { edges: 0, banes: n } : { edges: n, banes: 0 };
}

/** Flat bonus to every tier (never below 1). */
export function addPower(p: Power, flat: number): Power {
  return [Math.max(1, p[0] + flat), Math.max(1, p[1] + flat), Math.max(1, p[2] + flat)];
}

/** A crafting "step": the good hits get better, the weak one stays weak. */
export function stepPower(p: Power, steps: number): Power {
  return [p[0], p[1] + steps, p[2] + 2 * steps];
}

export function formatPower(p: Power): string {
  return p.join("/");
}

/** Rough per-swing worth for comparing weapons (tier 2 counts most). */
export function powerScore(p: Power): number {
  return (p[0] + 2 * p[1] + p[2]) / 4;
}
