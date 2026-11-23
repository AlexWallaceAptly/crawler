import type { EnemyAttack, Power, RangeBand, Rarity, RoomShape, Slot, StatBlock, Modifier, ROOM_TYPES } from "./content/schemas";
import type { GameEvent } from "./events";

/** Bump when the save shape changes incompatibly; old saves are discarded (see the decision log in docs/DESIGN.md). */
export const SAVE_VERSION = 6;
/** Bump with a migration in engine.ts `restoreAccount`: accounts are upgraded, never discarded. */
export const ACCOUNT_VERSION = 2;
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
  /** Weapons: damage by power-roll tier [t1, t2, t3]. */
  power?: Power;
  /** Weapons: AP per swing (default 2). */
  apCost?: number;
  /** Weapons: a swing ends your turn. */
  unwieldy?: boolean;
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
  /** Generated gear (Milestone 5): the item level it rolled at. */
  itemLevel?: number;
  /** Generated gear: materials.json id ("rusty"). */
  material?: string;
  /** Generated gear: its affixes, with what each rolled ("+2 STR"). Their effects are in `modifiers`/`onHit`. */
  affixes?: { id: string; name: string; kind: "prefix" | "suffix"; text: string }[];
  /** Legendary gear: its one unique power. */
  legendary?: { id: string; name: string; text: string };
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
  /** Recipe ids discovered by combining things at a workbench. */
  recipes?: string[];
  /** Recipe ids the System AI has already hinted at. */
  ideas?: string[];
  /** Salt Reader (Fed): hits left on a poisoned weapon. */
  coat?: number;
}

// ---------------------------------------------------------------- floors

export const DIRS = ["north", "east", "south", "west"] as const;
export type Dir = (typeof DIRS)[number];

/** What a room *is*. Lair/trap/event get mechanics in later milestones; until then they just read spooky. */
export type RoomType = (typeof ROOM_TYPES)[number];

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
  /** Lying in plain sight (listed on entry, `take`-able). */
  items?: ItemInstance[];
  /** Turned up by `search`. */
  hidden?: ItemInstance[];
  /** Crafting happens here (safe rooms always count). */
  workbench?: boolean;
  /**
   * A shard is here. Until it's found (a search), the room only has its faint voice;
   * once found, its clue replaces the voice line in `desc`. Found = in `echo.shards`.
   */
  shard?: string;
  /** A floor boss lives here (bosses.json id) until it's beaten. */
  boss?: string;
  /** Gate floors: a stairwell that reads as an ordinary room until it's found. */
  concealed?: boolean;
  /** Fault Sense or a boss's warning has marked it on the map before you've been in. */
  marked?: boolean;
}

// ---------------------------------------------------------------- combat

export type EnemyTier = "minion" | "mob" | "elite" | "boss";

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
  /** Flat damage taken off every hit (never below 1). */
  armor: number;
  /** From mods: positive is hard to hit cleanly (banes on your roll), negative is easy (edges). */
  guard: number;
  attacks: (EnemyAttack & { ready: number })[];
  ai: string[];
  preferRange: RangeBand;
  talkable: boolean;
  /** Distance from the crawler. */
  range: RangeBand;
  statuses: StatusInstance[];
  regen: number;
  /** The round it last hurt you (Spiteful weapons hit it harder the round after). */
  hitYouRound?: number;
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
  /** Tiles of movement already paid for this turn (1 AP buys your speed in tiles). */
  moveLeft: number;
  /** Ground terrain per tile, row-major. Looks only (tiles/ground.ts); missing means the floor's base terrain. */
  ground?: string[];
  /** Seed for which floor art each square gets. Looks only. */
  lookSeed?: number;
}

export interface CombatState {
  /** Fixed when the fight starts; changing the setting mid-fight only affects the next one. */
  mode: CombatMode;
  enemies: Enemy[];
  round: number;
  /** The crawler's rolled initiative for this fight. */
  playerInitiative: number;
  /** Action points left this turn. Everything costs some; the turn ends at zero. */
  ap: number;
  /** What the turn started with (3, give or take haste and slow). */
  apMax: number;
  /**
   * Set once the crawler's turn has started this round (statuses ticked). Makes the
   * turn start idempotent: a rejected command or a grid move doesn't tick twice.
   */
  turnBegun: boolean;
  /** Room the crawler came from; fleeing back the way you came lands there. */
  fromRoom: number;
  /** Grid mode only. */
  arena?: ArenaState;
  /** A floor boss fight: which boss, and how far its weakness has got. */
  boss?: { id: string; uid: string; declines: number; triggered: boolean };
  /** Once-a-fight module abilities already used (`shout`, `bind`). */
  used?: string[];
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
  /** Fights started on this floor: the first few roll from the easy pool. */
  fights: number;
  /** Room the floor boss lives in, and whether it's been beaten. */
  bossRoom?: number;
  bossDefeated?: boolean;
}

export interface NarratorState {
  recent: string[];
  /** -10 contempt .. +10 grudging respect */
  mood: number;
}

/** Something Echo has asked to do; `let echo` or `hush`. Lapses when you leave the room or the fight. */
export interface EchoUrge {
  kind: "rummage" | "listen" | "zap";
  /** Where it was asked: a room id, or "combat". */
  where: number | "combat";
}

/** Echo, per run. Wholeness and the stage come from the floor (see echo.ts). */
export interface EchoState {
  /** thread.json vessel id. */
  vessel: string;
  /** -5 (Calm) .. +5 (Fed). */
  temper: number;
  /** Modules built this run (module ids). */
  modules: string[];
  /** Shards found this run. */
  shards: string[];
  urge?: EchoUrge;
  /** Temper pushes counted this floor, per source (for the per-floor caps). */
  pushes: Record<string, number>;
  /** Once-a-floor module uses (`coat`). */
  floorUsed: string[];
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
  /**
   * Free rerolls left for the crawler being created: FREE_REROLLS for every new
   * crawler, spent before the account's own rerolls (unlocks). Missing = all of them.
   */
  freeRerolls?: number;
  narrator: NarratorState;
  /** The thing in your pocket. Null before the run starts. */
  echo: EchoState | null;
}

/** One finished run, for the account's history. */
export interface RunRecord {
  run: number;
  crawler: string;
  /** Deepest floor reached. */
  floor: number;
  /** "died: a Sump Rat", "descended past Floor 3", "quit". */
  outcome: string;
  shards: number;
  temper: number;
  vessel: string;
}

/** The thread Codex: what the account remembers across runs. */
export interface AccountThread {
  /** Every shard ever found, in the order found. */
  shards: string[];
  /** Modules ever built (their Codex recipe entries). */
  recipes: string[];
  /** Bosses whose weakness is known. */
  weaknesses: string[];
  endings: string[];
  /** The last 50 runs, newest last. */
  history: RunRecord[];
}

export const HISTORY_LIMIT = 50;

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
  thread: AccountThread;
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
    thread: newThreadCodex(),
  };
}

export function newThreadCodex(): AccountThread {
  return { shards: [], recipes: [], weaknesses: [], endings: [], history: [] };
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
    echo: null,
  };
}
