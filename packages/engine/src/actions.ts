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
  /** Scouting (Milestone 6c): listen to an adjacent room; assess this one (or a neighbor). */
  | { type: "listen"; dir: Dir }
  | { type: "assess"; dir?: Dir }
  | { type: "disarm" }
  /** A meal in a safe room: "Well fed" until the next sleep. */
  | { type: "meal" }
  /** Loot boxes (Milestone 7): list them (free), open one or all (safe rooms only), and the achievements list (free). */
  | { type: "boxes" }
  | { type: "open"; which?: string }
  | { type: "achievements" }
  /** Shops (safe rooms only): the shelf is free to look at. Costs no time. */
  | { type: "shop" }
  | { type: "buy"; item: string; qty?: string }
  | { type: "sell"; item: string; qty?: string }
  /** Free: the run's Game Guide. */
  | { type: "guide"; quiet?: boolean }
  | { type: "rest" }
  | { type: "sleep" }
  | { type: "descend" }
  | { type: "attack"; target?: string }
  | { type: "flee" }
  | { type: "advance" }
  | { type: "retreat" }
  | { type: "talk" }
  /** Drink, eat or read something. Scrolls can take a target, like `cast`. */
  | { type: "use"; item: string; at?: string }
  /** Cast a spell you know (or read a scroll of it): `cast grease fire at d4`. */
  | { type: "cast"; spell: string; at?: string }
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
