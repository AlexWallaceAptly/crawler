import type { Action } from "./actions";
import { isAllowed } from "./step";
import type { World } from "./state";

export type ParseResult = { ok: true; action: Action } | { ok: false; reason: "empty" | "unknown"; input: string };

/** Verb aliases → canonical verb. */
const VERBS: Record<string, string> = {
  help: "help", h: "help", "?": "help", commands: "help",
  look: "look", l: "look",
  accept: "accept", yes: "accept", y: "accept", ok: "accept",
  reroll: "reroll", no: "reroll",
  abandon: "abandon", quit: "abandon", suicide: "abandon",
  new: "new", next: "new", restart: "new",
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
  if (isAllowed(world, "look")) out.push({ label: "Look", input: "look" });
  out.push({ label: "Help", input: "help" });
  return out;
}
