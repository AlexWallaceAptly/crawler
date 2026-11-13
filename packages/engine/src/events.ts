import type { CheckResult } from "./rules/checks";
import type { Phase } from "./state";

/**
 * Everything the UI prints comes from these. The client routes each type to panels;
 * panels never read raw engine internals.
 */
export type GameEventBody =
  /** System AI or plain narrator text. */
  | { type: "narration"; voice: "system" | "narrator"; text: string; key?: string }
  /** Neutral UI text (help output, lists). `lines` render as a block. */
  | { type: "info"; text: string; lines?: string[] }
  /** Echo of the player's typed command. */
  | { type: "command"; text: string }
  /** Bad input or an action that isn't allowed right now. */
  | { type: "error"; text: string }
  | { type: "check"; result: CheckResult; text: string }
  | { type: "crawlerCreated"; name: string }
  | { type: "phaseChanged"; from: Phase; to: Phase }
  | { type: "died"; cause: string }
  | { type: "stateChanged" };

export type GameEventType = GameEventBody["type"];
export type GameEvent = GameEventBody & { id: number };
