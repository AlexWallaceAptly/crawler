import type { CombatMode, Dir } from "./state";
import type { TileRef } from "./grid/play";
import type { ModuleVerb } from "./modules";

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
  /** Spend stat points from leveling: `raise STR`, `raise dex 2`. */
  | { type: "raise"; stat: string; times: number }
  | { type: "drop"; item: string }
  | { type: "equip"; item: string }
  | { type: "unequip"; item: string }
  /** Grid combat: walk to a tile or a few steps in a direction (doesn't end the turn). */
  | { type: "move"; to: TileRef }
  | { type: "help" }
  /** Account preference; free, allowed any time. */
  | { type: "set"; key: "combat"; value: CombatMode }
  | { type: "abandon"; confirm: boolean }
  /** A boss fight: "no, thank you" (the Free Sample Mimic's weakness). */
  | { type: "decline" }
  /** Echo asked to do something: let it, or hush it. */
  | { type: "allowEcho" }
  | { type: "refuseEcho" }
  /** Give Echo a piece of salvage. */
  | { type: "feed"; item: string }
  /** Free: print the account's Codex / how Echo is doing. */
  | { type: "codex" }
  | { type: "echo" }
  /** Echo's module abilities: shout, bind <enemy>, coat, break <dir>. */
  | { type: "module"; verb: ModuleVerb; arg?: string };

export type ActionType = Action["type"];
