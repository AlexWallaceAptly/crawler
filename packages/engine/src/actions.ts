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
  | { type: "shove"; target?: string }
  | { type: "throw"; item: string; at?: string }
  | { type: "dash"; to: TileRef }
  | { type: "defend" }
  | { type: "take"; item: string }
  /** At a workbench: put the named things together. */
  | { type: "combine"; items: string }
  /** At a workbench: make a recipe you already know. */
  | { type: "craft"; recipe: string }
  | { type: "recipes" }
  | { type: "drop"; item: string }
  | { type: "equip"; item: string }
  | { type: "unequip"; item: string }
  /** Grid combat: walk to a tile or a few steps in a direction (doesn't end the turn). */
  | { type: "move"; to: TileRef }
  | { type: "help" }
  /** Account preference; free, allowed any time. */
  | { type: "set"; key: "combat"; value: CombatMode }
  | { type: "abandon"; confirm: boolean };

export type ActionType = Action["type"];
