/**
 * Seams for Milestone 7 (Rewards and narration), left empty on purpose (floor pacing pass).
 * Nothing here changes play yet; milestone 7 fills these in rather than editing the actions.
 */
import type { Room } from "./state";
import type { StepContext } from "./step";

/**
 * Echo's reaction to the crawler's sleep state changing (Milestone 7): worried when Tired, frantic
 * when Delirious, and its voice follows the act. `worse` is true going down a stage, false after a good sleep.
 */
export function onSleepStageChange(ctx: StepContext, from: string, to: string, worse: boolean): void {
  // Echo only fusses when you're sliding into Tired or worse, or when sleep fixed it.
  if (worse && to === "rested") return;
  ctx.echoSay(worse ? "echo.sleep.worse" : "echo.sleep.better", { stage: to, from });
}

/** What a safe room offers. */
export interface SafeService {
  id: "sleep" | "rest" | "meal" | "shop" | "lootBox" | "achievements";
  label: string;
  available: boolean;
  /** Why it's not available right now, for the Guide. */
  note?: string;
}

export function safeServices(room: Room, boxes = 0): SafeService[] {
  if (room.type !== "safe") return [];
  return [
    { id: "sleep", label: "Sleep", available: true },
    { id: "rest", label: "Short rest", available: true },
    { id: "meal", label: "Meal", available: true },
    room.shop
      ? { id: "shop", label: "Shop", available: true }
      : { id: "shop", label: "Shop", available: false, note: "Nobody is minding the till." },
    boxes > 0
      ? { id: "lootBox", label: `Open loot boxes (${boxes})`, available: true }
      : { id: "lootBox", label: "Open loot boxes", available: false, note: "You aren't carrying any. Go earn something." },
    { id: "achievements", label: "Achievements", available: true },
  ];
}
