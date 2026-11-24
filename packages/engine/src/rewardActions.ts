/** Box and achievement commands (Milestone 7). The rules are in boxes.ts and achievements.ts. */
import { achievementList } from "./achievements";
import { boxName, openBox } from "./boxes";
import type { Box, Room } from "./state";
import type { StepContext } from "./step";

/** `boxes`: free list of the unopened ones. */
export function showBoxes(ctx: StepContext, room: Room): void {
  const boxes = ctx.game.boxes;
  if (boxes.length === 0) {
    ctx.info("No boxes. Go earn something. Humiliate yourself, it counts.");
    return;
  }
  const lines = boxes.map((b, i) => `${i + 1}. ${boxName(ctx.content, b)} — ${b.source}`);
  lines.push("", room.type === "safe" ? "`open` opens the first, `open all` all of them, `open 2` one by number." : "They open in a safe room.");
  ctx.info(`${boxes.length} unopened box${boxes.length === 1 ? "" : "es"}:`, lines);
}

/** Which boxes did the player mean? "", "all", a number, a tier or a type. */
function pickBoxes(boxes: readonly Box[], which: string | undefined, ctx: StepContext): Box[] {
  const w = (which ?? "").trim().toLowerCase();
  if (!w) return boxes.slice(0, 1);
  if (w === "all") return [...boxes];
  const n = Number(w);
  if (Number.isInteger(n)) return boxes[n - 1] ? [boxes[n - 1]!] : [];
  return boxes.filter((b) => boxName(ctx.content, b).toLowerCase().includes(w) || b.tier === w || b.boxType === w).slice(0, 1);
}

/** `open [n|all|tier]`: safe rooms only, and never mid-fight. */
export function openBoxes(ctx: StepContext, room: Room, which?: string): void {
  if (ctx.game.boxes.length === 0) {
    ctx.error("You have no boxes to open.");
    return;
  }
  const picked = pickBoxes(ctx.game.boxes, which, ctx);
  if (picked.length === 0) {
    ctx.error(`You don't have a box like "${which}". \`boxes\` lists them.`);
    return;
  }
  if (room.type !== "safe") {
    ctx.say("box.refused", { box: boxName(ctx.content, picked[0]!) });
    return;
  }
  for (const box of picked) openBox(ctx, box, room);
}

/** `achievements`: free list, earned first. */
export function showAchievements(ctx: StepContext): void {
  const list = achievementList(ctx);
  const earned = list.filter((a) => a.earned);
  const lines = [
    `${earned.length}/${list.length} earned`,
    ...earned.map((a) => `✓ ${a.name}${a.times > 1 ? ` ×${a.times}` : ""} — ${a.text}`),
    ...list.filter((a) => !a.earned).map((a) => `· ${a.name}${a.progress ? ` (${a.progress.have}/${a.progress.need})` : ""} — ${a.text} [${a.reward}]`),
  ];
  ctx.info("Achievements:", lines);
}
