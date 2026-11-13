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
  died: ["log", "ticker"],
  phaseChanged: [],
  stateChanged: [],
};

export function routeEvent(e: GameEvent): LogPanel[] {
  return ROUTES[e.type] ?? ["log"];
}

export function eventsFor(panel: LogPanel, events: readonly GameEvent[]): GameEvent[] {
  return events.filter((e) => routeEvent(e).includes(panel));
}
