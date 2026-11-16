import type { CheckResult } from "./rules/checks";
import type { Dir, Phase } from "./state";

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
  /** The room block the log prints: name header, cached description, exits. Empty lines on a revisit. */
  | {
    type: "roomEntered"; name: string; badge?: string; lines: string[]; exits: Dir[]; first: boolean;
    /** What's lying around in plain sight. */
    items?: string[];
    /** You can craft here. */
    workbench?: boolean;
  }
  /** Collapse countdown crossing a threshold (the spoken line arrives as narration). */
  | { type: "timerWarning"; label: string; minutesLeft: number }
  | { type: "floorCleared"; floor: number }
  | { type: "combatStarted"; names: string[] }
  /** One line of fight play-by-play; routed to the battle log only. */
  | { type: "combatLine"; text: string; actor: "you" | "enemy" | "status" }
  | { type: "combatEnded"; outcome: "victory" | "fled" | "talked"; xp?: number }
  | { type: "phaseChanged"; from: Phase; to: Phase }
  | { type: "died"; cause: string }
  /** A new recipe went into the book (first time a combination worked, or nearly did). */
  | { type: "recipeLearned"; name: string }
  | { type: "stateChanged" };

export type GameEventType = GameEventBody["type"];
export type GameEvent = GameEventBody & { id: number };
