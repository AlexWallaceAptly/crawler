/**
 * Seams for Milestone 7 (Rewards and narration), left empty on purpose (floor pacing pass).
 * Nothing here changes play yet; milestone 7 fills these in rather than editing the actions.
 */
import type { Room } from "./state";
import type { StepContext } from "./step";

/**
 * Echo's reaction to the crawler's sleep state changing. Milestone 7 adds the narration
 * templates (Echo's voice follows the act: worried when Tired, frantic when Delirious) and
 * calls `ctx.echoSay` here. `worse` is true going down a stage, false after a good sleep.
 */
export function onSleepStageChange(_ctx: StepContext, _from: string, _to: string, _worse: boolean): void {
  /* hook */
}

/** What a safe room offers. The first three work now; the rest are slots for milestone 7. */
export interface SafeService {
  id: "sleep" | "rest" | "meal" | "shop" | "lootBox" | "achievements";
  label: string;
  available: boolean;
  /** Why it's not available yet, for the Guide. */
  note?: string;
}

export function safeServices(room: Room): SafeService[] {
  if (room.type !== "safe") return [];
  const later = "Arrives with Milestone 7.";
  return [
    { id: "sleep", label: "Sleep", available: true },
    { id: "rest", label: "Short rest", available: true },
    { id: "meal", label: "Meal", available: true },
    { id: "shop", label: "Shop", available: false, note: later },
    { id: "lootBox", label: "Open loot boxes", available: false, note: later },
    { id: "achievements", label: "Achievements", available: false, note: later },
  ];
}
