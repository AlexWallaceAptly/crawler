import { clone } from "./clone";
import type { Action } from "./actions";
import type { Content } from "./content/load";
import { availableCommands, normalize, parseCommand, type CommandOption } from "./parser";
import { commitEvents, step, type StepResult } from "./step";
import { ACCOUNT_VERSION, SAVE_VERSION, newAccount, newGameState, newThreadCodex, type AccountState, type GameState, type World } from "./state";
import { view, type ViewModel } from "./view";
import { narrate } from "./narrate/narrator";
import { catchUpLevels } from "./progression";

export interface Engine {
  content: Content;
  /** Fresh run (keeps the account if given) with a newly generated crawler. */
  newWorld(account?: AccountState): StepResult;
  /** Restore from saved JSON; returns null if missing or from an incompatible version. */
  restore(game: unknown, account: unknown): World | null;
  /** Restore just the account (survives a discarded run save). */
  restoreAccount(account: unknown): AccountState | null;
  step(world: World, action: Action): StepResult;
  /** Parse typed text and step. Unknown commands produce an error line, not a state change. */
  input(world: World, text: string): StepResult;
  commands(world: World): CommandOption[];
  view(world: World): ViewModel;
}

export function createEngine(content: Content): Engine {
  const engine: Engine = {
    content,
    newWorld(account) {
      const world: World = { game: newGameState(), account: account ?? newAccount() };
      return step(world, { type: "newCrawler" }, content);
    },
    restoreAccount(account) {
      return migrateAccount(account, content);
    },
    restore(game, account) {
      const g = game as GameState | null;
      const a = engine.restoreAccount(account);
      if (!g || typeof g !== "object" || g.version !== SAVE_VERSION || !a) return null;
      if (g.crawler) catchUpLevels(g.crawler);
      return { game: g, account: a };
    },
    step: (world, action) => step(world, action, content),
    input(world, text) {
      const parsed = parseCommand(text, world);
      if (parsed.ok) {
        // Marking the Guide read is bookkeeping, not something the player typed: no echo line.
        const quiet = parsed.action.type === "guide" && parsed.action.quiet;
        return step(world, parsed.action, content, quiet ? undefined : normalize(text));
      }
      const draft = clone(world);
      if (parsed.reason === "empty") return { world, events: [] };
      const line = narrate(content, draft.game.narrator, "command.unknown", { input: parsed.input });
      const events = commitEvents(draft, [
        { type: "command", text: parsed.input },
        { type: "narration", voice: "system", key: "command.unknown", text: line },
      ]);
      return { world: draft, events };
    },
    commands: (world) => availableCommands(world, content),
    view: (world) => view(world, content),
  };
  return engine;
}

/**
 * Bring a saved account up to the current shape. Accounts are never thrown away for being old:
 * version 1 (before the thread Codex) gains an empty Codex; version 2 (before Milestone 8) gains
 * the bequest slot, lifetime legacy, the bestiary's tallies and the vessels seen (read back out of
 * the run history when the content is at hand). Everything else is kept.
 */
export function migrateAccount(account: unknown, content?: Content): AccountState | null {
  if (!account || typeof account !== "object") return null;
  let a = account as AccountState & { version: number };
  if (a.version === 1) a = { ...a, version: 2, thread: newThreadCodex() };
  if (a.version === 2) {
    const names = new Map((content?.thread.vessels ?? []).map((v) => [v.name, v.id]));
    const seen = [...new Set(a.thread.history.map((r) => names.get(r.vessel)).filter((id): id is string => !!id))];
    a = {
      ...a,
      version: 3,
      legacyEarned: a.legacyEarned ?? a.legacyPoints ?? 0,
      codex: { ...a.codex, tallies: a.codex.tallies ?? {} },
      thread: { ...a.thread, vessels: a.thread.vessels ?? seen },
      bequest: a.bequest ?? null,
    };
  }
  if (a.version === ACCOUNT_VERSION) return a;
  return null;
}
