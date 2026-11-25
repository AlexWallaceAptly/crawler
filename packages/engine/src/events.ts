import type { CheckResult } from "./rules/checks";
import type { Dir, Phase } from "./state";

export type DeathSource = "enemy" | "hazard" | "collapse" | "self" | "status" | "show" | "craft" | "quit";

/**
 * Everything the UI prints comes from these. The client routes each type to panels;
 * panels never read raw engine internals.
 */
export type GameEventBody =
  /** System AI or plain narrator text. */
  | { type: "narration"; voice: "system" | "narrator" | "echo"; text: string; key?: string }
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
  /** `families`: each enemy's family (or boss) id, for the account's bestiary. */
  | { type: "combatStarted"; names: string[]; families: string[] }
  /** One line of fight play-by-play; routed to the battle log only. */
  | { type: "combatLine"; text: string; actor: "you" | "enemy" | "status" }
  | {
    type: "combatEnded"; outcome: "victory" | "fled" | "talked"; xp?: number;
    /** After the fight's XP: your level and how far into it you are. */
    level?: number; xpNow?: number; xpNext?: number;
    /** Skill XP the fight earned: "Blades +5 (rank 2 · 4/10)". */
    skills?: { id: string; name: string; gained: number; rank: number; xp: number; next: number }[];
  }
  /** You went up a level: a full heal and stat points to spend. */
  | { type: "levelUp"; level: number; statPoints: number; unspent: number; next: number }
  /** A skill went up a rank. `perk` when this rank unlocks one (every 5th). */
  | {
    type: "skillUp"; skillId: string; name: string; rank: number; perk?: string; perkName?: string;
    nextPerk?: { rank: number; name: string };
  }
  /** Skill XP out of a fight (a search, a crafting check): "Perception +1 (2/6)". */
  | { type: "skillXp"; skillId: string; name: string; gained: number; rank: number; xp: number; next: number }
  | { type: "phaseChanged"; from: Phase; to: Phase }
  /**
   * The crawler died (or quit). `source`: enemy, hazard, collapse, self (your own item or spell),
   * status (bleeding out), show (a show event), craft (a botch), quit. `killer` is the enemy
   * family (or boss) id and `tier` its tier, when an enemy did it. `asleep`: during a sleep or rest.
   * `rounds`: the fight's round, or 0 out of a fight. `gold` is what was in your pockets.
   */
  | {
    type: "died"; cause: string; source: DeathSource; floor: number; gold: number; asleep: boolean; rounds: number;
    killer?: string; tier?: string;
  }
  // ---- Milestone 8: the end of a run and the account.
  /** A run is over and paid out (after the death's own achievements). `legacy` is the run's total. */
  | { type: "runEnded"; kind: "died" | "quit" | "descended"; cause: string; floor: number; legacy: number; points: number }
  /** Legacy points reached the account: from an achievement, or the run's tally. */
  | { type: "legacyEarned"; amount: number; points: number; why: string }
  /** The dead crawler picked something to leave the next one. */
  | { type: "bequeathed"; item: string }
  | { type: "unlockBought"; unlockId: string; name: string; cost: number; points: number }
  /** A new recipe went into the book (first time a combination worked, or nearly did). */
  | { type: "recipeLearned"; name: string }
  /** A room has a shard in it: a faint voice. A search finds what's talking. */
  | { type: "shardVoice"; room: string; text: string }
  /**
   * A shard of the thread turned up: a search found the thing talking (room), or the
   * boss said it. Carries the words so the client can show them in a popup.
   */
  | {
    type: "shardFound"; id: string; strand: string; floor: number; first: boolean;
    delivery: "room" | "boss"; clue: string; reaction: string;
    /** Room shards: "You walk up to the cracked handheld, and it speaks to you." */
    intro?: string;
    /** Boss shards: who said it. */
    speaker?: string;
  }
  /** The account's Codex gained something. */
  /** The crawler crossed into another sleep state (Rested / Tired / Exhausted / Delirious). */
  | { type: "sleepStageChanged"; from: string; to: string; name: string; worse: boolean }
  | { type: "codexUpdated"; entry: string; kind: "unlocked" | "line" | "recipe" | "weakness" | "ending" }
  | { type: "temperChanged"; temper: number; delta: number; side: "calm" | "base" | "fed" }
  /** Echo has a new module for this run. */
  | { type: "moduleBuilt"; name: string }
  /** You came down the stairs onto a new floor. */
  | { type: "floorEntered"; floor: number; name: string }
  // ---- Milestone 7: facts the achievement engine and the counters read. Most print nothing.
  /** An enemy died. `how` is a short tag: "swing", "spell", "item", "status", "friendlyFire", "echo". */
  | { type: "kill"; target: string; family: string; tier: string; overkill: number; how: string; champion?: string }
  // ---- Milestone 9: districts and their champions.
  /** First time in a district this floor. `allSeen`: that was the floor's last unvisited district. */
  | { type: "districtEntered"; floor: number; district: string; name: string; index: number; of: number; allSeen: boolean }
  /** The floor's last living district champion just died. */
  | { type: "championsCleared"; floor: number; count: number }
  /** The crawler lost HP. `source`: enemy, hazard, self (your own item), show (a show event), craft (a botch). */
  | { type: "damageTaken"; amount: number; source: string; cause: string; hp: number; hpPct: number }
  /** A consumable was used. `itemType` is its consumables.json type (potion, food, explosive...). */
  | { type: "itemUsed"; item: string; baseId: string; itemType: string; tags: string[]; inCombat: boolean }
  /** A spell went off. */
  | { type: "spellCast"; spell: string; school: string; scroll: boolean; first: boolean; inCombat: boolean }
  /** Something was crafted at a bench. */
  | { type: "crafted"; recipe: string; item?: string }
  | { type: "goldChanged"; delta: number; total: number; why: string }
  /** An achievement paid out a box, or a boss or floor did. */
  | { type: "boxEarned"; boxId: string; tier: string; boxType: string; source: string }
  | { type: "boxOpened"; boxId: string; tier: string; boxType: string; contents: string[] }
  /** Printed in the ticker: the achievement's name, the System AI's insult and what it paid. */
  | { type: "achievementEarned"; achievementId: string; name: string; text: string; tags: string[]; reward: string }
  | { type: "moodChanged"; mood: number; delta: number; why: string }
  | { type: "shopBought"; item: string; price: number; shopkeeper: string }
  | { type: "shopSold"; item: string; price: number; shopkeeper: string }
  | { type: "stateChanged" };

export type GameEventType = GameEventBody["type"];
export type GameEvent = GameEventBody & { id: number };
