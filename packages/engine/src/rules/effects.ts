/**
 * Status-effect bookkeeping shared by the crawler and enemies.
 * Statuses are data (statusEffects.json): duration, tick effects, stacking, flags.
 */
import type { Content } from "../content/load";
import type { StatusEffect } from "../content/schemas";
import { rollDice } from "./dice";
import type { StatusInstance } from "../state";

/** Apply a status respecting its stacking rule. Returns what happened, for the log. */
export function applyStatus(
  statuses: StatusInstance[],
  def: StatusEffect,
  duration?: number,
): "applied" | "refreshed" | "stacked" | "extended" | "ignored" {
  const dur = duration ?? def.defaultDuration;
  const existing = statuses.find((s) => s.id === def.id);
  if (!existing) {
    statuses.push({ id: def.id, remaining: dur, stacks: 1, fresh: true });
    return "applied";
  }
  switch (def.stacking) {
    case "refresh":
      existing.remaining = Math.max(existing.remaining, dur);
      existing.fresh = true;
      return "refreshed";
    case "stack":
      if (existing.stacks < def.maxStacks) existing.stacks += 1;
      existing.remaining = Math.max(existing.remaining, dur);
      existing.fresh = true;
      return "stacked";
    case "extend":
      existing.remaining += dur;
      existing.fresh = true;
      return "extended";
    case "ignore":
      return "ignored";
  }
}

export interface TickDamage {
  status: string;
  amount: number;
}

/** Start-of-turn ticks: damage (or healing as negative) per active status. */
export function tickStatuses(statuses: StatusInstance[], content: Content): TickDamage[] {
  const out: TickDamage[] = [];
  for (const s of statuses) {
    const def = content.statusEffects.byId[s.id];
    if (!def) continue;
    for (const e of def.tick) {
      if (e.kind !== "damage" && e.kind !== "heal") continue;
      const base = typeof e.value === "number" ? e.value : e.value ? rollDice(e.value).total : 0;
      const amount = (e.kind === "heal" ? -base : base) * s.stacks;
      if (amount !== 0) out.push({ status: def.name, amount });
    }
  }
  return out;
}

/** End-of-round countdown; removes expired statuses and returns their names. */
export function decrementStatuses(statuses: StatusInstance[], content: Content): string[] {
  const expired: string[] = [];
  for (const s of statuses) {
    if (s.fresh) s.fresh = false;
    else s.remaining -= 1;
  }
  for (let i = statuses.length - 1; i >= 0; i--) {
    if (statuses[i]!.remaining <= 0) {
      expired.push(content.statusEffects.byId[statuses[i]!.id]?.name ?? statuses[i]!.id);
      statuses.splice(i, 1);
    }
  }
  return expired;
}

/** True if any active status carries the given behavior flag (skipTurn, fleeOnly, ...). */
export function hasFlag(statuses: StatusInstance[], content: Content, flag: string): boolean {
  return statuses.some((s) => content.statusEffects.byId[s.id]?.flags.includes(flag));
}
