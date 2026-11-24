/**
 * The Game Guide (Milestone 6c): the run's reference text, kept off the main screens.
 * Run-scoped (reset with each crawler); the account's Codex is separate and stays in echo.ts.
 */
import type { Content } from "./content/load";
import type { GameState, GuideEntry } from "./state";

export type GuideSection = GuideEntry["section"];

export const GUIDE_SECTIONS: { id: GuideSection; name: string }[] = [
  { id: "events", name: "Show events" },
  { id: "scouting", name: "Scout reports" },
  { id: "rooms", name: "Rooms" },
  { id: "rules", name: "Rules" },
  { id: "echo", name: "Notes from Echo" },
];

/** Add (or replace, by id) a Guide entry. A changed entry is "new" again. */
export function guideAdd(game: GameState, id: string, section: GuideSection, title: string, text: string): void {
  const existing = game.guide.find((e) => e.id === id);
  if (existing) {
    if (existing.text !== text) { existing.text = text; existing.title = title; existing.seen = false; }
    return;
  }
  game.guide.push({ id, section, title, text, at: game.clock, seen: false });
}

export const unseenGuide = (game: GameState): number => game.guide.filter((e) => !e.seen).length;

/** What every crawler is told up front, so the main screens don't have to. Numbers come from pacing.json. */
export function guideRules(content: Content): { id: string; title: string; text: string }[] {
  const p = content.pacing;
  const c = p.costs;
  const stages = p.sleepStages.filter((st) => st.fromHours > 0).map((st) => `${st.name} after ${st.fromHours}`).join(", ");
  return [
    { id: "rule.time", title: "Time", text: `Everything costs minutes: moving ${c.move}, a search pass ${c.search}, a short rest ${c.rest}, sleep ${c.sleepMin / 60}-${c.sleepMax / 60} hours. The floor collapses when its timer runs out. You can't do everything. Choose.` },
    { id: "rule.safe", title: "Safe rooms", text: "Marked S on the map once you've seen one, or listened to one. No fights, no hazards, nothing hidden. Sleep here for a full recovery, or eat a meal for a small bonus. Sleeping anywhere else works, but half as well, and something may come." },
    { id: "rule.sleep", title: "Sleep", text: `Hours awake wear you down: ${stages}. Only sleep clears it. There is no hunger. Food is a bonus, never a need.` },
    { id: "rule.scout", title: "Scouting", text: `A glance at a door is free: a room's name and exits. \`listen <dir>\` (${p.scout.listenMinutes} min) tells you the danger of the room next door and whether it has a hazard. \`assess\` (${p.scout.assessMinutes} min) tells you everything about the room you're in; \`assess <dir>\` does it for the next one. Results are kept in this Guide.` },
    { id: "rule.search", title: "Searching", text: "Loot is hidden until found. Each `search` pass finds what is within your reach; more passes reach deeper. An assess tells you how much is left." },
    { id: "rule.hazards", title: "Hazards", text: "Traps and the like stay where they are, and grow worse the longer you're away. `disarm` switches them off, or they burn out after biting a few times. None of them blocks a path for good." },
    { id: "rule.rooms", title: "Rooms remember", text: "Cleared rooms stay cleared. A room you fled in the first round is alerted when you return. Dense rooms hold more enemies and better loot." },
  ];
}
