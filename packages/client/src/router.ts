/**
 * Event router: sends each engine event type to the panel(s) that print it.
 * Sheet-style panels (character, equipment, effects, map) re-render from the view model on stateChanged.
 */
import type { GameEvent, GameEventType } from "@crawler/engine";

export type LogPanel = "log" | "battle" | "ticker";

const ROUTES: Record<GameEventType, LogPanel[]> = {
  narration: ["log"],
  info: ["log"],
  command: ["log"],
  error: ["log"],
  check: ["log"],
  crawlerCreated: ["log"],
  roomEntered: ["log"],
  timerWarning: ["ticker"],
  floorCleared: ["log", "ticker"],
  combatStarted: ["log", "battle"],
  combatLine: ["battle"],
  combatEnded: ["log", "battle"],
  died: ["log", "ticker", "battle"],
  recipeLearned: ["log", "ticker"],
  shardVoice: ["log", "ticker"],
  shardFound: ["log", "battle", "ticker"],
  codexUpdated: ["log", "ticker"],
  temperChanged: ["log"],
  moduleBuilt: ["log", "ticker"],
  floorEntered: ["log", "ticker"],
  phaseChanged: [],
  stateChanged: [],
};

export function routeEvent(e: GameEvent): LogPanel[] {
  // Echo talks in fights too: its lines go to the battle log as well.
  if (e.type === "narration" && e.voice === "echo") return ["log", "battle"];
  return ROUTES[e.type] ?? ["log"];
}

export function eventsFor(panel: LogPanel, events: readonly GameEvent[]): GameEvent[] {
  return events.filter((e) => routeEvent(e).includes(panel));
}
