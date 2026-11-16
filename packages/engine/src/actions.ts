import type { CombatMode, Dir } from "./state";
import type { TileRef } from "./grid/play";

/** Player commands. The parser turns typed text into these; buttons submit text too. */
export type Action =
  | { type: "newCrawler" }
  | { type: "reroll" }
  | { type: "accept" }
  | { type: "look" }
  | { type: "go"; dir: Dir }
  | { type: "map" }
  | { type: "search" }
  | { type: "rest" }
  | { type: "sleep" }
  | { type: "descend" }
  | { type: "attack"; target?: string }
  | { type: "flee" }
  | { type: "advance" }
  | { type: "retreat" }
  | { type: "talk" }
  | { type: "use"; item: string }
  | { type: "wait" }
  /** Grid combat: walk to a tile or a few steps in a direction (doesn't end the turn). */
  | { type: "move"; to: TileRef }
  | { type: "help" }
  /** Account preference; free, allowed any time. */
  | { type: "set"; key: "combat"; value: CombatMode }
  | { type: "abandon"; confirm: boolean };

export type ActionType = Action["type"];
