/**
 * Gold (Milestone 7). One place changes it, so every gain and spend is an event the counters
 * and achievements can see. Gold is per run and is not lost on a floor change.
 */
import type { StepContext } from "./step";

/** Add (or, with a negative amount, spend) gold. Never goes below zero; returns the real change. */
export function addGold(ctx: StepContext, amount: number, why: string): number {
  const c = ctx.crawler;
  const delta = Math.max(amount, -c.gold);
  if (delta === 0) return 0;
  c.gold += delta;
  ctx.emit({ type: "goldChanged", delta, total: c.gold, why });
  return delta;
}
