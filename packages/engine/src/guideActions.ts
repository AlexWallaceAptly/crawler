/** Guide and meal commands (Milestone 6c). The Guide's data and helpers are in guide.ts. */
import { guideRules, GUIDE_SECTIONS, guideAdd } from "./guide";
import { timePassed, timeCosts } from "./explore";
import type { Content } from "./content/load";
import type { GameState, Room } from "./state";
import type { StepContext } from "./step";

/** A fresh run: an empty event log and the rules entries (all "new"). */
export function seedGuide(game: GameState, content: Content): void {
  game.guide = [];
  for (const r of guideRules(content)) guideAdd(game, r.id, "rules", r.title, r.text);
}

/** `guide`: print the Guide (the client also shows it as a panel) and mark it read. */
export function showGuide(ctx: StepContext, quiet = false): void {
  const game = ctx.game;
  if (quiet) { for (const e of game.guide) e.seen = true; return; }
  const lines: string[] = [];
  for (const sec of GUIDE_SECTIONS) {
    const entries = game.guide.filter((e) => e.section === sec.id);
    if (entries.length === 0) continue;
    lines.push(`== ${sec.name} ==`);
    for (const e of entries) {
      lines.push(`${e.seen ? "" : "[new] "}${e.title}`);
      for (const l of e.text.split("\n")) lines.push(`   ${l}`);
    }
  }
  ctx.info("Game Guide", lines.length ? lines : ["Nothing yet."]);
  for (const e of game.guide) e.seen = true;
}

/** `meal`: in a safe room, spend a little time and a food item for "Well fed" until the next sleep. */
export function eatMeal(ctx: StepContext, room: Room): void {
  if (room.type !== "safe") {
    ctx.error("Meals are for safe rooms. Anywhere else, eating is just a thing that happens to you.");
    return;
  }
  const c = ctx.crawler;
  const food = c.inventory.find((i) => i.kind === "consumable" && i.tags.includes("food"));
  if (!food) {
    ctx.error("You have nothing to eat. Nobody has to. That's the deal.");
    return;
  }
  if (c.wellFed) {
    ctx.describe("You're already well fed. The System would like you to stop showing off.");
    return;
  }
  if (!timePassed(ctx, timeCosts(ctx).meal, "meal")) return;
  food.qty -= 1;
  if (food.qty <= 0) c.inventory = c.inventory.filter((i) => i !== food);
  c.wellFed = true;
  ctx.describe(`You eat the ${food.name}. Well fed: +${ctx.content.pacing.meal.xpPct}% XP until you sleep.`);
}
