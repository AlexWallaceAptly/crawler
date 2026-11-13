import { clone } from "./clone";
import type { Action } from "./actions";
import type { Content } from "./content/load";
import { availableCommands, normalize, parseCommand, type CommandOption } from "./parser";
import { commitEvents, step, type StepResult } from "./step";
import { ACCOUNT_VERSION, SAVE_VERSION, newAccount, newGameState, type AccountState, type GameState, type World } from "./state";
import { view, type ViewModel } from "./view";
import { narrate } from "./narrate/narrator";

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
      const a = account as AccountState | null;
      return a && typeof a === "object" && a.version === ACCOUNT_VERSION ? a : null;
    },
    restore(game, account) {
      const g = game as GameState | null;
      const a = engine.restoreAccount(account);
      if (!g || typeof g !== "object" || g.version !== SAVE_VERSION || !a) return null;
      return { game: g, account: a };
    },
    step: (world, action) => step(world, action, content),
    input(world, text) {
      const parsed = parseCommand(text, world);
      if (parsed.ok) return step(world, parsed.action, content, normalize(text));
      const draft = clone(world);
      if (parsed.reason === "empty") return { world, events: [] };
      const line = narrate(content, draft.game.narrator, "command.unknown", { input: parsed.input });
      const events = commitEvents(draft, [
        { type: "command", text: parsed.input },
        { type: "narration", voice: "system", key: "command.unknown", text: line },
      ]);
      return { world: draft, events };
    },
    commands: (world) => availableCommands(world),
    view: (world) => view(world, content),
  };
  return engine;
}
