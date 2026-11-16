import type { EnemyAttack, RangeBand, Rarity, RoomShape, Slot, StatBlock, Modifier } from "./content/schemas";
import type { GameEvent } from "./events";

/** Bump when the save shape changes incompatibly; old saves are discarded (see DECISIONS.md). */
export const SAVE_VERSION = 4;
export const ACCOUNT_VERSION = 1;
export const LOG_LIMIT = 300;

export type Phase = "creation" | "exploring" | "combat" | "dead";

/**
 * How fights play. "bands" is the original abstract close/near/far model; "grid" is
 * the Milestone 4b tactical arena. Chosen per account, fixed per fight.
 */
export type CombatMode = "bands" | "grid";
export const COMBAT_MODES: readonly CombatMode[] = ["grid", "bands"];
/** Used when the account has never picked a mode. */
export const DEFAULT_COMBAT_MODE: CombatMode = "grid";

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
  /** Weapons: a status that may land on a hit (crafted upgrades add these). */
  onHit?: { id: string; chance: number; duration?: number };
  /** Recipe ids already applied to this item as upgrades (each applies once). */
  crafted?: string[];
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

export type EnemyTier = "minion" | "mob" | "elite";

/** A live enemy. Everything is resolved at spawn (family + mods baked in) so the state stays flat JSON. */
export interface Enemy {
  uid: string;
  familyId: string;
  /** Mods baked into the display name: "Rabid Sump Rat". */
  name: string;
  level: number;
  /** minion: weak pack filler; mob: a standard foe; elite: a lair boss-lite. */
  tier: EnemyTier;
  /** Letter that tells same-named enemies apart ("Sump Rat B"); also in the name. */
  mark?: string;
  /** Grid mode: tiles per turn. */
  speed: number;
  /** Grid mode: where it stands. */
  pos?: Pos;
  /** Grid AI: turns in a row without closing in or attacking. */
  stall?: number;
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

// ---------------------------------------------------------------- grid arenas

export interface Pos {
  x: number;
  y: number;
}

/** A hazard on one tile. Placed ones (thrown caltrops, fire) may burn out. */
export interface ArenaHazard extends Pos {
  /** arenaFeatures.json id */
  id: string;
  /** Rounds left; undefined = lasts the fight. */
  rounds?: number;
}

/** A door on the arena edge. Fleeing through it leaves the fight that way. */
export interface ArenaExit extends Pos {
  dir: Dir;
  /** The door the crawler came in by; leads back to `fromRoom`. */
  entry: boolean;
}

export interface ArenaItem extends Pos {
  item: ItemInstance;
}

/**
 * Grid mode's battlefield: a small board built from the room's shape when the
 * fight starts. Thrown away when the fight ends (only loose items survive).
 */
export interface ArenaState {
  w: number;
  h: number;
  /** Static feature id per tile, row-major (y * w + x); "" is plain floor. */
  tiles: string[];
  hazards: ArenaHazard[];
  items: ArenaItem[];
  exits: ArenaExit[];
  crawler: Pos;
  /** Movement points left this turn (the grid's minor action). */
  moveLeft: number;
}

export interface CombatState {
  /** Fixed when the fight starts; changing the setting mid-fight only affects the next one. */
  mode: CombatMode;
  enemies: Enemy[];
  round: number;
  /** The crawler's rolled initiative for this fight. */
  playerInitiative: number;
  /** Number of step-a-band minor actions used this round (bands mode). */
  minorActionsUsed: number;
  /**
   * Set once the crawler's turn has started this round (statuses ticked). Makes the
   * turn start idempotent: a rejected command or a grid move doesn't tick twice.
   */
  turnBegun: boolean;
  /** Room the crawler came from; fleeing back the way you came lands there. */
  fromRoom: number;
  /** Grid mode only. */
  arena?: ArenaState;
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

export interface AccountSettings {
  combatMode: CombatMode;
}

export interface AccountState {
  version: number;
  /** Player preferences that outlive a crawler. Optional so older accounts still load. */
  settings?: AccountSettings;
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

export function combatModeOf(account: AccountState): CombatMode {
  return account.settings?.combatMode ?? DEFAULT_COMBAT_MODE;
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
