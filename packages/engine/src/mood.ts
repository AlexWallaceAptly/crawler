/**
 * The System AI's hidden mood (Milestone 7): -10 (contempt) .. +10 (grudging respect).
 * Achievements, CHA wins, stylish kills and stupid things move it; narration templates can
 * condition on `mood`. It also nudges box quality a little (see boxes.ts).
 */
import type { StepContext } from "./step";

export const MOOD_MIN = -10;
export const MOOD_MAX = 10;

export function clampMood(n: number): number {
  return Math.max(MOOD_MIN, Math.min(MOOD_MAX, Math.round(n)));
}

/** Shift the mood. Emits `moodChanged` only if it actually moved. */
export function moveMood(ctx: StepContext, delta: number, why: string): void {
  const n = ctx.game.narrator;
  const next = clampMood(n.mood + delta);
  const moved = next - n.mood;
  if (moved === 0) return;
  n.mood = next;
  ctx.emit({ type: "moodChanged", mood: next, delta: moved, why });
}

/** A word for the mood, for the panels. */
export function moodWord(mood: number): string {
  if (mood <= -7) return "contempt";
  if (mood <= -3) return "disdain";
  if (mood < 3) return "bored";
  if (mood < 7) return "amused";
  return "grudging respect";
}
