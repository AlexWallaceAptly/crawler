import type { Dir } from "./state";

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
  | { type: "help" }
  | { type: "abandon"; confirm: boolean };

export type ActionType = Action["type"];
