import type { EnemyAttack, RangeBand, Rarity, RoomShape, Slot, StatBlock, Modifier } from "./content/schemas";
import type { GameEvent } from "./events";

/** Bump when the save shape changes incompatibly; old saves are discarded (see DECISIONS.md). */
export const SAVE_VERSION = 3;
export const ACCOUNT_VERSION = 1;
export const LOG_LIMIT = 300;

export type Phase = "creation" | "exploring" | "combat" | "dead";

export type EquipSlot = Exclude<Slot, "ring"> | "ring1" | "ring2";
export const EQUIP_SLOTS: EquipSlot[] = [
  "mainHand", "offHand", "head", "eyes", "chest", "hands", "legs", "feet", "back", "belt", "neck", "ring1", "ring2",
];

export interface ItemInstance {
  uid: string;
  /** Item base id or consumable id. */
  baseId: string;
  kind: "gear" | "consumable";
  name: string;
  rarity: Rarity;
  slot?: Slot;
  twoHanded?: boolean;
  weaponType?: string;
  damage?: string;
  damageType?: string;
  stat?: "STR" | "DEX";
  range?: "close" | "near" | "far";
  armor?: number;
  modifiers: Modifier[];
  weight: number;
  value: number;
  qty: number;
  flavor?: string;
  tags: string[];
}

export interface SkillState {
  rank: number;
  xp: number;
}

export interface SpellState {
  level: number;
  casts: number;
  cooldown: number;
}

export interface StatusInstance {
  id: string;
  remaining: number;
  stacks: number;
  /** A status applied during the current round starts counting down next round. */
  fresh?: boolean;
}

export interface Backstory {
  occupation: string;
  event: string;
  quirk: string;
  location: string;
}

export interface Crawler {
  name: string;
  age: number;
  hometown: string;
  backstory: Backstory;
  level: number;
  xp: number;
  /** Stats from creation plus spent level-up points. Race/class/gear apply on top. */
  baseStats: StatBlock;
  unspentStatPoints: number;
  skillPoints: number;
  hp: number;
  mp: number;
  skills: Record<string, SkillState>;
  spells: Record<string, SpellState>;
  race: string | null;
  charClass: string | null;
  /** Equipped item uids by slot. Equipped items also live in inventory. */
  equipment: Partial<Record<EquipSlot, string>>;
  inventory: ItemInstance[];
  statuses: StatusInstance[];
  gold: number;
  counters: Record<string, number>;
  achievements: string[];
}

// ---------------------------------------------------------------- floors

export const DIRS = ["north", "east", "south", "west"] as const;
export type Dir = (typeof DIRS)[number];

/** What a room *is*. Lair/trap/event get mechanics in later milestones; until then they just read spooky. */
export type RoomType =
  | "corridor" | "chamber" | "empty"
  | "lair" | "trap" | "treasure" | "puzzle" | "event" | "npc"
  | "safe" | "stairwell";

export interface Room {
  /** Index into FloorState.rooms. */
  id: number;
  x: number;
  y: number;
  type: RoomType;
  shape: RoomShape;
  name: string;
  /** Neighboring room ids by direction. */
  exits: Partial<Record<Dir, number>>;
  visited: boolean;
  /** Spotted from an adjacent room; drawn as "?" on the map. */
  seen: boolean;
  searched: boolean;
  /** Trap rooms only: which trap, and whether it has already gone off or been disarmed. */
  trap?: string;
  trapSprung?: boolean;
  /** Description lines, generated on first entry and cached so revisits read the same. */
  desc: string[] | null;
}

// ---------------------------------------------------------------- combat

/** A live enemy. Everything is resolved at spawn (family + mods baked in) so the state stays flat JSON. */
export interface Enemy {
  uid: string;
  familyId: string;
  /** Mods baked into the display name: "Rabid Sump Rat". */
  name: string;
  level: number;
  tier: "mob" | "elite";
  stats: StatBlock;
  maxHP: number;
  hp: number;
  armor: number;
  defense: number;
  attacks: (EnemyAttack & { ready: number })[];
  ai: string[];
  preferRange: RangeBand;
  talkable: boolean;
  /** Distance from the crawler. */
  range: RangeBand;
  statuses: StatusInstance[];
  regen: number;
  fleeBelow: number;
  initiative: number;
  xp: number;
  /** Set when the enemy left the fight alive; no XP from these. */
  fate?: "fled" | "pacified";
}

export interface CombatState {
  enemies: Enemy[];
  round: number;
  /** The crawler's rolled initiative for this fight. */
  playerInitiative: number;
  /** Number of step-a-band minor actions used this round. */
  minorActionsUsed: number;
  /** Room the crawler came from; a successful flee retreats there. */
  fromRoom: number;
}

export interface FloorState {
  floor: number;
  /** Theme id in floors.json. */
  theme: string;
  width: number;
  height: number;
  rooms: Room[];
  startRoom: number;
  currentRoom: number;
  /** Game minutes until the floor collapses. */
  timeLeft: number;
  /** Warning thresholds (in minutes) that have already fired. */
  warned: number[];
}

export interface NarratorState {
  recent: string[];
  /** -10 contempt .. +10 grudging respect */
  mood: number;
}

export interface GameState {
  version: number;
  phase: Phase;
  /** Player actions taken this run. */
  turn: number;
  /** Game minutes elapsed this run. */
  clock: number;
  crawler: Crawler | null;
  floor: FloorState | null;
  combat: CombatState | null;
  log: GameEvent[];
  nextEventId: number;
  narrator: NarratorState;
}

export interface AccountState {
  version: number;
  legacyPoints: number;
  rerolls: number;
  unlocks: string[];
  bestFloor: number;
  runs: number;
  deaths: number;
  codex: { enemies: string[]; items: string[]; achievements: string[] };
}

export interface World {
  game: GameState;
  account: AccountState;
}

export function newAccount(): AccountState {
  return {
    version: ACCOUNT_VERSION,
    legacyPoints: 0,
    rerolls: 0,
    unlocks: [],
    bestFloor: 0,
    runs: 0,
    deaths: 0,
    codex: { enemies: [], items: [], achievements: [] },
  };
}

export function newGameState(): GameState {
  return {
    version: SAVE_VERSION,
    phase: "dead",
    turn: 0,
    clock: 0,
    crawler: null,
    floor: null,
    combat: null,
    log: [],
    nextEventId: 1,
    narrator: { recent: [], mood: 0 },
  };
}
