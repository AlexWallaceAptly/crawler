import type { Action } from "./actions";
import type { Content } from "./content/load";
import { minorLimit } from "./combat";
import { isAllowed } from "./step";
import { COMBAT_MODES, type CombatMode, type Dir, type World } from "./state";
import { DIR8, parseCoord, type Dir8 } from "./grid/geometry";

export type ParseResult = { ok: true; action: Action } | { ok: false; reason: "empty" | "unknown"; input: string };

/** Verb aliases → canonical verb. */
const VERBS: Record<string, string> = {
  help: "help", h: "help", "?": "help", commands: "help",
  look: "look", l: "look",
  accept: "accept", yes: "accept", y: "accept", ok: "accept",
  reroll: "reroll", no: "reroll",
  abandon: "abandon", quit: "abandon", suicide: "abandon",
  new: "new", next: "new", restart: "new",
  go: "go", move: "go", walk: "go",
  north: "north", n: "north", east: "east", e: "east",
  south: "south", s: "south", west: "west", w: "west",
  ne: "diag", nw: "diag", se: "diag", sw: "diag",
  northeast: "diag", northwest: "diag", southeast: "diag", southwest: "diag",
  map: "map", m: "map",
  search: "search", loot: "search",
  rest: "rest", sleep: "sleep", nap: "sleep",
  descend: "descend", down: "descend", stairs: "descend",
  attack: "attack", a: "attack", hit: "attack", kill: "attack", fight: "attack",
  flee: "flee", run: "flee", escape: "flee",
  advance: "advance", approach: "advance", closer: "advance",
  retreat: "retreat", back: "retreat",
  talk: "talk", parley: "talk", negotiate: "talk",
  use: "use", drink: "use", eat: "use", quaff: "use",
  wait: "wait", pass: "wait", end: "wait",
  set: "set", setting: "set", settings: "set",
};

const DIR_WORDS: Record<string, Dir> = {
  north: "north", n: "north", east: "east", e: "east",
  south: "south", s: "south", west: "west", w: "west",
};

/** Grid directions, long or short. */
const DIR8_WORDS: Record<string, Dir8> = {
  n: "n", north: "n", ne: "ne", northeast: "ne", e: "e", east: "e", se: "se", southeast: "se",
  s: "s", south: "s", sw: "sw", southwest: "sw", w: "w", west: "w", nw: "nw", northwest: "nw",
};

function inGridFight(world: World): boolean {
  return world.game.phase === "combat" && world.game.combat?.mode === "grid" && world.game.combat.arena !== undefined;
}

/** "c4", "3 2" (x y, 1-based), "ne", "ne 2", "north 3". */
function parseTileRef(arg: string): Extract<Action, { type: "move" }>["to"] | null {
  const words = arg.split(" ").filter(Boolean);
  if (words.length === 1) {
    const tile = parseCoord(words[0]!);
    if (tile) return tile;
  }
  if (words.length === 2 && /^\d+$/.test(words[0]!) && /^\d+$/.test(words[1]!)) {
    return { x: Number(words[0]) - 1, y: Number(words[1]) - 1 };
  }
  const dir = DIR8_WORDS[words[0] ?? ""];
  if (dir && words.length <= 2) {
    const steps = words[1] === undefined ? 1 : Number(words[1]);
    if (Number.isInteger(steps) && steps >= 1 && steps <= 9) return { dir, steps };
  }
  return null;
}

export function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseCommand(input: string, world: World): ParseResult {
  const text = normalize(input);
  if (text === "") return { ok: false, reason: "empty", input };
  const [rawVerb = "", ...rest] = text.split(" ");
  const verb = VERBS[rawVerb];
  const arg = rest.join(" ");
  if (inGridFight(world)) {
    // On the board, movement words walk tiles instead of rooms.
    if (verb === "go") {
      const to = parseTileRef(arg);
      return to ? { ok: true, action: { type: "move", to } } : { ok: false, reason: "unknown", input: text };
    }
    if (verb === "north" || verb === "east" || verb === "south" || verb === "west" || verb === "diag") {
      const to = parseTileRef(text);
      if (to) return { ok: true, action: { type: "move", to } };
    }
  }
  switch (verb) {
    case "help":
      return { ok: true, action: { type: "help" } };
    case "look":
      return { ok: true, action: { type: "look" } };
    case "go": {
      const dir = DIR_WORDS[arg];
      if (!dir) return { ok: false, reason: "unknown", input: text };
      return { ok: true, action: { type: "go", dir } };
    }
    case "north": case "east": case "south": case "west":
      return { ok: true, action: { type: "go", dir: verb as Dir } };
    case "map":
      return { ok: true, action: { type: "map" } };
    case "search":
      return { ok: true, action: { type: "search" } };
    case "rest":
      return { ok: true, action: { type: "rest" } };
    case "sleep":
      return { ok: true, action: { type: "sleep" } };
    case "descend":
      return { ok: true, action: { type: "descend" } };
    case "attack":
      return { ok: true, action: arg ? { type: "attack", target: arg } : { type: "attack" } };
    case "flee":
      return { ok: true, action: { type: "flee" } };
    case "advance":
      return { ok: true, action: { type: "advance" } };
    case "retreat":
      return { ok: true, action: { type: "retreat" } };
    case "talk":
      return { ok: true, action: { type: "talk" } };
    case "use":
      if (!arg) return { ok: false, reason: "unknown", input: text };
      return { ok: true, action: { type: "use", item: arg } };
    case "accept":
      return { ok: true, action: { type: "accept" } };
    case "reroll":
      return { ok: true, action: { type: "reroll" } };
    case "abandon":
      return { ok: true, action: { type: "abandon", confirm: arg === "confirm" || arg === "yes" } };
    case "new":
      return { ok: true, action: { type: "newCrawler" } };
    case "wait":
      return { ok: true, action: { type: "wait" } };
    case "set": {
      // "set combat grid" / "set combat bands" (also "set grid")
      const words = arg.split(" ").filter((w) => w !== "combat" && w !== "mode" && w !== "to");
      const value = words[0] === "band" ? "bands" : words[0];
      if (words.length !== 1 || !COMBAT_MODES.includes(value as CombatMode)) {
        return { ok: false, reason: "unknown", input: text };
      }
      return { ok: true, action: { type: "set", key: "combat", value: value as CombatMode } };
    }
    default:
      return { ok: false, reason: "unknown", input: text };
  }
}

export interface CommandOption {
  /** Button text. */
  label: string;
  /** Command text submitted when clicked (same path as typing). */
  input: string;
  /** Visual emphasis for the primary choice. */
  primary?: boolean;
}

/** Every valid command for the current state, shown as clickable buttons. */
export function availableCommands(world: World, content: Content): CommandOption[] {
  const out: CommandOption[] = [];
  const phase = world.game.phase;
  if (phase === "creation") {
    out.push({ label: "Accept crawler", input: "accept", primary: true });
    if (world.account.rerolls > 0) out.push({ label: `Reroll (${world.account.rerolls} left)`, input: "reroll" });
  }
  if (phase === "dead") out.push({ label: "Next crawler", input: "new", primary: true });
  if (phase === "combat" && world.game.combat) {
    const combat = world.game.combat;
    const foes = combat.enemies.filter((e) => e.hp > 0);
    const grid = combat.mode === "grid" && combat.arena;
    for (const e of foes.slice(0, 4)) {
      out.push({ label: `Attack ${e.name}`, input: `attack ${e.name.toLowerCase()}`, primary: foes.indexOf(e) === 0 });
    }
    const statuses = world.game.crawler?.statuses ?? [];
    if (grid) {
      if (combat.arena!.moveLeft > 0 || !combat.turnBegun) {
        out.push({ label: "Advance", input: "advance" });
        out.push({ label: "Retreat", input: "retreat" });
      }
    } else if (combat.minorActionsUsed < minorLimit(statuses, content)) {
      if (foes.some((e) => e.range !== "close")) out.push({ label: "Advance", input: "advance" });
      if (foes.some((e) => e.range !== "far")) out.push({ label: "Retreat", input: "retreat" });
    }
    if (foes.some((e) => e.talkable)) out.push({ label: "Talk", input: "talk" });
    const crawler = world.game.crawler;
    const potion = crawler?.inventory.find((i) => i.kind === "consumable" && i.tags.includes("healing"));
    if (potion) out.push({ label: `Use ${potion.name}`, input: `use ${potion.name.toLowerCase()}` });
    out.push({ label: "Wait", input: "wait" });
    out.push({ label: "Flee", input: "flee" });
  }
  const floor = world.game.floor;
  if (phase === "exploring" && floor) {
    const room = floor.rooms[floor.currentRoom]!;
    for (const dir of ["north", "west", "east", "south"] as const) {
      if (room.exits[dir] !== undefined) out.push({ label: dir[0]!.toUpperCase() + dir.slice(1), input: dir });
    }
    if (room.type === "stairwell") out.push({ label: "Descend", input: "descend", primary: true });
    if (room.type === "safe") out.push({ label: "Sleep", input: "sleep" });
    if (!room.searched) out.push({ label: "Search", input: "search" });
    out.push({ label: "Rest", input: "rest" });
    out.push({ label: "Map", input: "map" });
  }
  if (isAllowed(world, "look")) out.push({ label: "Look", input: "look" });
  out.push({ label: "Help", input: "help" });
  return out;
}
