import type { Action } from "./actions";
import { isAllowed } from "./step";
import type { Dir, World } from "./state";

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
};

const DIR_WORDS: Record<string, Dir> = {
  north: "north", n: "north", east: "east", e: "east",
  south: "south", s: "south", west: "west", w: "west",
};

export function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseCommand(input: string, _world: World): ParseResult {
  const text = normalize(input);
  if (text === "") return { ok: false, reason: "empty", input };
  const [rawVerb = "", ...rest] = text.split(" ");
  const verb = VERBS[rawVerb];
  const arg = rest.join(" ");
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
export function availableCommands(world: World): CommandOption[] {
  const out: CommandOption[] = [];
  const phase = world.game.phase;
  if (phase === "creation") {
    out.push({ label: "Accept crawler", input: "accept", primary: true });
    if (world.account.rerolls > 0) out.push({ label: `Reroll (${world.account.rerolls} left)`, input: "reroll" });
  }
  if (phase === "dead") out.push({ label: "Next crawler", input: "new", primary: true });
  if (phase === "combat" && world.game.combat) {
    const foes = world.game.combat.enemies.filter((e) => e.hp > 0);
    for (const e of foes.slice(0, 4)) {
      out.push({ label: `Attack ${e.name}`, input: `attack ${e.name.toLowerCase()}`, primary: foes.indexOf(e) === 0 });
    }
    const statuses = world.game.crawler?.statuses ?? [];
    const minorLimit = statuses.some((s) => s.id === "slowed") ? 0 : statuses.some((s) => s.id === "hasted") ? 2 : 1;
    if (world.game.combat.minorActionsUsed < minorLimit) {
      if (foes.some((e) => e.range !== "close")) out.push({ label: "Advance", input: "advance" });
      if (foes.some((e) => e.range !== "far")) out.push({ label: "Retreat", input: "retreat" });
    }
    if (foes.some((e) => e.talkable)) out.push({ label: "Talk", input: "talk" });
    const crawler = world.game.crawler;
    const potion = crawler?.inventory.find((i) => i.kind === "consumable" && i.tags.includes("healing"));
    if (potion) out.push({ label: `Use ${potion.name}`, input: `use ${potion.name.toLowerCase()}` });
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
