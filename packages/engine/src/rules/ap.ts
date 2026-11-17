/**
 * Action points. A turn is a small pool of AP and everything costs some; the turn
 * ends itself when the pool is empty (or you `wait`).
 */
import type { Content } from "../content/load";
import type { CombatState, Crawler, StatusInstance } from "../state";
import { hasFlag } from "./effects";

/** What the crawler's turn starts with. */
export const BASE_AP = 3;

export const AP_COST = {
  /** A weapon swing, unless the weapon says otherwise (light 1, heavy 3). */
  attack: 2,
  /** Buys your speed in tiles (grid) or one band step (bands). */
  move: 1,
  shove: 1,
  throw: 1,
  /** Twice your speed in one go, and the turn ends. */
  dash: 1,
  defend: 1,
  item: 1,
  /** Swapping gear in a bands fight. On the grid it costs a tile of movement. */
  swap: 1,
  flee: 2,
  talk: 2,
} as const;

/** AP for a turn: the base, +1 hasted, -1 slowed, never below 1. */
export function turnAp(statuses: StatusInstance[], content: Content, base = BASE_AP): number {
  let ap = base;
  if (hasFlag(statuses, content, "apUp")) ap += 1;
  if (hasFlag(statuses, content, "apDown")) ap -= 1;
  return Math.max(1, ap);
}

/** AP the crawler has right now. Before the first command of a round, the whole turn is still ahead. */
export function apNow(combat: CombatState, crawler: Crawler, content: Content): { ap: number; max: number } {
  if (combat.turnBegun) return { ap: combat.ap, max: combat.apMax };
  const ap = turnAp(crawler.statuses, content);
  return { ap, max: ap };
}
