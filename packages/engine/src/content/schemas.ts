/**
 * Zod schemas for every JSON content file. Types are inferred from these, so the
 * schema is the single source of truth. Objects are strict: a typo'd key fails loudly.
 */
import { z } from "zod";
import { isDice } from "../rules/dice";
import { DC_TIER_NAMES } from "../rules/checks";

export const STATS = ["STR", "DEX", "CON", "INT", "CHA"] as const;
export const StatSchema = z.enum(STATS);
export type Stat = z.infer<typeof StatSchema>;

export const StatBlockSchema = z.strictObject({
  STR: z.number(),
  DEX: z.number(),
  CON: z.number(),
  INT: z.number(),
  CHA: z.number(),
});
export type StatBlock = z.infer<typeof StatBlockSchema>;
export const PartialStatBlockSchema = StatBlockSchema.partial();

export const IdSchema = z.string().regex(/^[a-z0-9_]+$/, "ids must be lowercase snake_case");
export const DiceSchema = z.string().refine(isDice, { message: "not a valid dice expression (e.g. 2d6+1)" });

/**
 * Damage by power-roll tier: [tier 1 (11 or less), tier 2 (12-16), tier 3 (17+)].
 * Every attack lands; the roll only decides how hard.
 */
export const PowerSchema = z.tuple([z.number().int().min(1), z.number().int().min(1), z.number().int().min(1)])
  .refine((p) => p[0] <= p[1] && p[1] <= p[2], { message: "power tiers must not decrease: [t1, t2, t3]" });
export type Power = z.infer<typeof PowerSchema>;
export const DcTierSchema = z.enum(DC_TIER_NAMES as [string, ...string[]]);
/** A weighted pick list of content ids. */
export const WeightedIdsSchema = z.array(z.strictObject({ id: IdSchema, weight: z.number().positive().default(1) }));
export type WeightedIds = z.infer<typeof WeightedIdsSchema>;

/** Inclusive [min, max]. */
export const IntRangeSchema = z.tuple([z.number().int().min(0), z.number().int().min(0)])
  .refine(([a, b]) => a <= b, { message: "range min must be <= max" });

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export const RaritySchema = z.enum(RARITIES);
export type Rarity = z.infer<typeof RaritySchema>;

/**
 * Item slots as written on item bases. Rings occupy ring1/ring2 when equipped.
 * `eyes` is separate from `head` so goggles and glasses stack with hats and helmets.
 */
export const SLOTS = ["head", "eyes", "chest", "legs", "feet", "hands", "neck", "ring", "back", "belt", "mainHand", "offHand"] as const;
export const SlotSchema = z.enum(SLOTS);
export type Slot = z.infer<typeof SlotSchema>;

export const DAMAGE_TYPES = [
  "physical", "fire", "frost", "lightning", "necrotic", "light", "poison", "psychic", "acid",
] as const;
export const DamageTypeSchema = z.enum(DAMAGE_TYPES);

/**
 * Shared effect shape for items, spells, events and boss rulings (per spec).
 * `cure` (removes `statusId`) is an addition to the spec's kinds; see the decision log in docs/DESIGN.md.
 */
export const EffectSchema = z.strictObject({
  kind: z.enum(["damage", "heal", "status", "cure", "stat", "xp", "loot", "flag", "mood", "move", "spawn"]),
  value: z.union([DiceSchema, z.number()]).optional(),
  statusId: IdSchema.optional(),
  stat: StatSchema.optional(),
  flag: z.string().optional(),
  duration: z.number().int().optional(),
  damageType: DamageTypeSchema.optional(),
  target: z.enum(["self", "target", "all_enemies", "all_allies"]).optional(),
}).refine((e) => e.kind !== "cure" || e.statusId !== undefined, { message: "cure effects need a statusId", path: ["statusId"] });
export type Effect = z.infer<typeof EffectSchema>;

/** A status that may land when something hits (attacks, hazards, crafted weapons). */
export const OnHitStatusSchema = z.strictObject({
  id: IdSchema,
  chance: z.number().min(0).max(1),
  duration: z.number().int().min(1).optional(),
});
export type OnHitStatus = z.infer<typeof OnHitStatusSchema>;

/**
 * A passive bonus applied to any roll or value whose tags include `to`.
 * Examples: { to: "flee", value: 2 }, { to: "skill:perception", value: 1 },
 * { to: "stat:DEX", value: 1 }, { to: "resist:poison", value: 3 }.
 */
export const ModifierSchema = z.strictObject({
  to: z.string().min(1),
  value: z.number(),
  note: z.string().optional(),
});
export type Modifier = z.infer<typeof ModifierSchema>;

// ---------------------------------------------------------------- skills

export const SkillSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  category: z.enum(["weapon", "defense", "utility", "social", "class"]),
  /** Stat that usually pairs with this skill on a check. */
  stat: StatSchema.optional(),
  /** For weapon skills: the weaponType that trains it. */
  weaponType: z.string().optional(),
  description: z.string(),
  perks: z.array(z.strictObject({
    rank: z.number().int().min(1).max(15),
    text: z.string(),
    modifiers: z.array(ModifierSchema).default([]),
  })).default([]),
});
export type Skill = z.infer<typeof SkillSchema>;

// ---------------------------------------------------------------- status effects

export const StatusEffectSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  kind: z.enum(["buff", "debuff"]),
  description: z.string(),
  defaultDuration: z.number().int().min(1),
  /** Applied at the start of the affected combatant's turn. */
  tick: z.array(EffectSchema).default([]),
  modifiers: z.array(ModifierSchema).default([]),
  stacking: z.enum(["refresh", "stack", "extend", "ignore"]),
  maxStacks: z.number().int().min(1).default(1),
  /** Behavior flags the combat rules understand: skipTurn, noAction, fleeOnly, cantTarget, ... */
  flags: z.array(z.string()).default([]),
});
export type StatusEffect = z.infer<typeof StatusEffectSchema>;

// ---------------------------------------------------------------- backstory

export const OccupationSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  /** Stat weights for spending the 12-point creation pool. */
  weights: StatBlockSchema,
  /** Starting skill (rank 1). */
  skill: IdSchema,
  /** Starting item (item base or consumable id). */
  item: IdSchema,
  ageRange: z.tuple([z.number().int(), z.number().int()]).default([19, 64]),
});
export type Occupation = z.infer<typeof OccupationSchema>;

export const FormativeEventSchema = z.strictObject({
  id: IdSchema,
  /** Fits "you once ___". */
  phrase: z.string(),
  plus: StatSchema,
  minus: StatSchema,
  tags: z.array(z.string()).default([]),
}).refine((e) => e.plus !== e.minus, { message: "plus and minus must be different stats" });
export type FormativeEvent = z.infer<typeof FormativeEventSchema>;

export const QuirkSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  /** Fits "you ___" (e.g. "cannot swim"). */
  phrase: z.string(),
  kind: z.enum(["perk", "flaw", "mixed"]),
  /** Rules text shown on the character sheet. */
  text: z.string(),
  statMods: PartialStatBlockSchema.default({}),
  modifiers: z.array(ModifierSchema).default([]),
  tags: z.array(z.string()).default([]),
});
export type Quirk = z.infer<typeof QuirkSchema>;

export const LocationSchema = z.strictObject({
  id: IdSchema,
  /** Fits "when the planet was harvested you were ___". */
  phrase: z.string(),
  clothing: z.array(IdSchema).min(1),
  item: IdSchema,
});
export type Location = z.infer<typeof LocationSchema>;

export const NamesSchema = z.strictObject({
  first: z.array(z.string()).min(5),
  last: z.array(z.string()).min(5),
  hometowns: z.array(z.string()).min(5),
});
export type Names = z.infer<typeof NamesSchema>;

// ---------------------------------------------------------------- items

export const ItemBaseSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  slot: SlotSchema,
  twoHanded: z.boolean().optional(),
  weaponType: z.string().optional(),
  /** Weapons: damage by power-roll tier. */
  power: PowerSchema.optional(),
  /** Weapons: AP per swing (default 2). Light junk pokes for 1; the heavy stuff takes the whole turn. */
  apCost: z.number().int().min(1).max(3).optional(),
  /** Big two-handed lumps: a swing ends your turn, and hits like a 3-AP swing. */
  unwieldy: z.boolean().optional(),
  damageType: DamageTypeSchema.optional(),
  stat: z.enum(["STR", "DEX"]).optional(),
  range: z.enum(["close", "near", "far"]).optional(),
  armor: z.number().optional(),
  weight: z.number().min(0),
  value: z.number().min(0),
  minLevel: z.number().int().min(1).default(1),
  /** If false, the generator never rolls this base (starting kit only). */
  generate: z.boolean().default(true),
  /** Intrinsic bonuses while equipped (affixes add more in the generator). */
  modifiers: z.array(ModifierSchema).default([]),
  /** Weapons: a status that may land on a hit. */
  onHit: OnHitStatusSchema.optional(),
  tags: z.array(z.string()).default([]),
  flavor: z.string().optional(),
}).superRefine((b, ctx) => {
  if (b.slot === "mainHand" && b.weaponType && (!b.power || !b.stat)) {
    ctx.addIssue({ code: "custom", message: "weapons need power and stat" });
  }
  if (b.twoHanded && b.slot !== "mainHand") {
    ctx.addIssue({ code: "custom", message: "only mainHand items can be twoHanded" });
  }
});
export type ItemBase = z.infer<typeof ItemBaseSchema>;

export const ConsumableSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  type: z.enum(["potion", "scroll", "tome", "food", "explosive", "junk"]),
  text: z.string(),
  effects: z.array(EffectSchema).default([]),
  /** Food buffs last this many rooms; potions use effect.duration. */
  rooms: z.number().int().optional(),
  /** If true, numeric effect values scale with floor. */
  scales: z.boolean().default(false),
  usableInCombat: z.boolean().default(true),
  weight: z.number().min(0),
  value: z.number().min(0),
  generate: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  /** Grid fights: thrown, it leaves this arena hazard behind (bands mode just applies the effects). */
  hazard: z.strictObject({
    id: IdSchema,
    /** single tile, a plus of five, or the 3x3 square. */
    shape: z.enum(["single", "plus", "square"]).default("single"),
  }).optional(),
});
export type Consumable = z.infer<typeof ConsumableSchema>;

// ---------------------------------------------------------------- loot

/** A weighted table of item ids (bases or consumables). Seeds room contents now; drops and boxes later. */
export const LootTableSchema = z.strictObject({
  id: IdSchema,
  entries: z.array(z.strictObject({
    item: IdSchema,
    weight: z.number().positive().default(1),
    qty: IntRangeSchema.optional(),
  })).min(1),
});
export type LootTable = z.infer<typeof LootTableSchema>;

// ---------------------------------------------------------------- floors

export const ROOM_TYPES = [
  "corridor", "chamber", "empty", "lair", "trap", "treasure", "puzzle", "event", "npc", "safe", "stairwell",
] as const;
export const RoomTypeSchema = z.enum(ROOM_TYPES);

const RoomLootSchema = z.strictObject({
  table: IdSchema,
  /** Lying in plain sight. */
  visible: IntRangeSchema,
  /** Turned up by `search`. */
  hidden: IntRangeSchema.default([0, 0]),
});

/** Physical shape of a room; drives name nouns and opening lines. */
export const ROOM_SHAPES = ["corridor", "chamber", "small"] as const;
export const RoomShapeSchema = z.enum(ROOM_SHAPES);
export type RoomShape = z.infer<typeof RoomShapeSchema>;

const LinePool = z.array(z.string().min(1));
const ShapePools = z.strictObject({
  corridor: LinePool.min(1),
  chamber: LinePool.min(1),
  small: LinePool.min(1),
});

// ---------------------------------------------------------------- tilesets (floor tiling)

/*
 * Floor tilesets, shaped like Godot 4's TileSet so a set built in the Godot
 * editor imports one-to-one (`npm run import:tileset`). The names follow Godot's:
 * terrain sets with a match mode, tiles with a center terrain and peering bits,
 * per-tile probability, and flipped/transposed alternative tiles. Terrains are
 * referred to by name here (Godot uses their index). See "Floor tiling" in
 * docs/DESIGN.md for how the tiler picks a tile.
 */

/** Godot's TileSet.TerrainMode: which neighbours a tile's art has to agree with. */
export const TERRAIN_MODES = ["cornersAndSides", "corners", "sides"] as const;

/** Godot's square-tile peering bits, clockwise from the right. */
export const PEERING_BITS = [
  "right_side", "bottom_right_corner", "bottom_side", "bottom_left_corner",
  "left_side", "top_left_corner", "top_side", "top_right_corner",
] as const;
export type PeeringBit = (typeof PEERING_BITS)[number];

/** Terrain name per bit. A missing or null bit is Godot's -1 (no terrain). */
const PeeringSchema = z.partialRecord(z.enum(PEERING_BITS), IdSchema.nullable());

const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i, "colors are #rrggbb or #rrggbbaa");

/** Crawler's shortcut (Godot has no equivalent): also use the art flipped or turned, with its bits turned to match. */
export const TILE_TRANSFORMS = ["none", "flips", "rotations", "all"] as const;

const TileFlipsSchema = {
  /** Godot flip_h / flip_v / transpose (swap x and y; applied before the flips). */
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
  transpose: z.boolean().default(false),
};

export const TilesetTileSchema = z.strictObject({
  /** Atlas sources: the tile's column and row in the sheet (Godot's atlas coords). */
  atlas: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  /** Image sources: the PNG under public/combat/floor/, without ".png". */
  image: z.string().regex(/^[a-z0-9_-]+$/).optional(),
  ...TileFlipsSchema,
  /** Index into the tileset's terrainSets (Godot terrain_set). */
  terrainSet: z.number().int().min(0).default(0),
  /** The terrain at the tile's center (Godot terrain). */
  terrain: IdSchema,
  peering: PeeringSchema.default({}),
  /** Relative chance among tiles that fit equally well (Godot probability). */
  probability: z.number().min(0).default(1),
  /**
   * Godot alternative tiles: the same art flipped or transposed. Peering bits and
   * terrain default to the base tile's, turned to match the flip.
   */
  alternatives: z.array(z.strictObject({
    ...TileFlipsSchema,
    terrain: IdSchema.optional(),
    peering: PeeringSchema.optional(),
    probability: z.number().min(0).default(1),
  })).default([]),
  /** Generate the flipped/turned copies automatically; the tile's probability is split between them. */
  transforms: z.enum(TILE_TRANSFORMS).default("none"),
}).refine((t) => (t.atlas === undefined) !== (t.image === undefined), { message: "a tile needs exactly one of atlas or image" });
export type TilesetTile = z.infer<typeof TilesetTileSchema>;

const PairSchema = z.tuple([z.number().int().min(0), z.number().int().min(0)]);

export const TilesetSourceSchema = z.strictObject({
  /** Godot's source id (sources/<id> in a .tres). */
  id: z.number().int().min(0),
  /**
   * "atlas": tiles cut from one sheet (Godot's TileSetAtlasSource).
   * "images": one PNG per tile, for art drawn as separate squares (a Crawler shortcut).
   */
  kind: z.enum(["atlas", "images"]),
  /** Atlas: the sheet under public/combat/floor/, without ".png". */
  texture: z.string().regex(/^[a-z0-9_-]+$/).optional(),
  /** Atlas: the sheet's size in pixels (the board needs it to cut tiles out with CSS). */
  textureSize: PairSchema.optional(),
  /** Atlas: each tile's size in the sheet (Godot texture_region_size). */
  regionSize: PairSchema.optional(),
  margins: PairSchema.default([0, 0]),
  separation: PairSchema.default([0, 0]),
  tiles: z.array(TilesetTileSchema).min(1),
}).superRefine((s, ctx) => {
  if (s.kind === "atlas") {
    for (const k of ["texture", "textureSize", "regionSize"] as const) {
      if (s[k] === undefined) ctx.addIssue({ code: "custom", message: `atlas sources need ${k}`, path: [k] });
    }
    s.tiles.forEach((t, i) => {
      if (!t.atlas) ctx.addIssue({ code: "custom", message: "tiles in an atlas source need atlas coords", path: ["tiles", i] });
    });
  } else {
    s.tiles.forEach((t, i) => {
      if (!t.image) ctx.addIssue({ code: "custom", message: "tiles in an images source need an image", path: ["tiles", i] });
    });
  }
});
export type TilesetSource = z.infer<typeof TilesetSourceSchema>;

export const TilesetSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  /** Godot tile_size: the art's square size in pixels. Informative; the board scales every tile to its squares. */
  tileSize: z.number().int().positive().default(128),
  terrainSets: z.array(z.strictObject({
    mode: z.enum(TERRAIN_MODES).default("cornersAndSides"),
    /**
     * Listed bottom first: where two terrains meet, the later one draws the edge
     * over the earlier one (so the first is the floor everything sits on).
     */
    terrains: z.array(z.strictObject({
      name: IdSchema,
      /** Godot's terrain color. The board fills the square with it under the art, and on its own until the art exists. */
      color: HexColorSchema,
    })).min(1),
  })).min(1),
  sources: z.array(TilesetSourceSchema).min(1),
  /** The Godot .tres this was imported from, if any (for re-importing). */
  importedFrom: z.string().optional(),
});
export type Tileset = z.infer<typeof TilesetSchema>;

/** A floor's ground layout: the terrain under everything, and areas of other terrains painted over it. */
export const GroundSchema = z.strictObject({
  terrainSet: z.number().int().min(0).default(0),
  /** The terrain that fills the board. */
  base: IdSchema,
  areas: z.array(z.strictObject({
    terrain: IdSchema,
    /** "blob": a grown puddle of `size` squares. "strip": a runner `size` squares wide across the board's long side. */
    shape: z.enum(["blob", "strip"]),
    /** How many areas of this kind an arena gets. */
    count: IntRangeSchema,
    size: IntRangeSchema,
  })).default([]),
});
export type Ground = z.infer<typeof GroundSchema>;

/** A floor's text identity: name parts and description fragment pools. */
export const FloorThemeSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  /** Dungeon floor number this theme is used on. */
  floor: z.number().int().min(1),
  /** How many rooms to carve. */
  rooms: z.number().int().min(10),
  /** Grid dimensions the rooms are carved into. */
  width: z.number().int().min(4),
  height: z.number().int().min(4),
  /** Collapse timer in game days. */
  days: z.number().positive(),
  roomNames: z.strictObject({
    adjectives: LinePool.min(5),
    nouns: ShapePools,
  }),
  fragments: z.strictObject({
    openings: ShapePools,
    sights: LinePool.min(5),
    sounds: LinePool.min(5),
    smells: LinePool.min(5),
  }),
  /** Traps that trap rooms on this floor roll from. */
  trapTypes: z.array(z.strictObject({
    id: IdSchema,
    name: z.string(),
    dice: DiceSchema,
    damageType: DamageTypeSchema.default("physical"),
    status: z.strictObject({
      id: IdSchema,
      chance: z.number().min(0).max(1),
      duration: z.number().int().min(1).optional(),
    }).optional(),
    spotTier: DcTierSchema,
    avoidTier: DcTierSchema,
    avoidStat: z.enum(["DEX", "INT"]),
    spotted: z.string(),
    triggered: z.string(),
    avoided: z.string(),
    /** Grid fights in this trap room get one tile of this arena feature. */
    arenaHazard: IdSchema.optional(),
  })).default([]),
  /** What's lying around: per room type, plus the tutorial bench and workshops. */
  loot: z.strictObject({
    rooms: z.partialRecord(RoomTypeSchema, RoomLootSchema).default({}),
    /** Always in the first safe room, so the first craft is within reach. */
    firstSafe: z.array(z.strictObject({ item: IdSchema, qty: z.number().int().min(1).default(1) })).default([]),
    /** Extra rooms with a workbench (safe rooms always have one). */
    workshops: IntRangeSchema.default([0, 0]),
    /** Extra junk on a workshop's floor. */
    workshopTable: IdSchema.optional(),
    workbenchLines: LinePool.default([]),
    /**
     * Things scattered across the floor's ordinary rooms (not the start, stairwells or
     * safe rooms): Echo's module parts, a boss's counter item, the odd hand-written oddity.
     * Each entry rolls `count` pickups from exactly one source.
     */
    scatter: z.array(z.strictObject({
      table: IdSchema.optional(),
      item: IdSchema.optional(),
      /** A random oddity whose floor range includes this floor (boss counters excluded). */
      oddity: z.literal(true).optional(),
      count: IntRangeSchema,
      /** Chance each one is only turned up by `search`. */
      hiddenChance: z.number().min(0).max(1).default(0.5),
    }).refine((s) => [s.table, s.item, s.oddity].filter((v) => v !== undefined).length === 1, {
      message: "a scatter entry needs exactly one of table, item or oddity",
    })).default([]),
  }).prefault({}),
  /** Grid-combat dressing: what arenas on this floor are furnished with (ids in arenaFeatures.json). */
  arena: z.strictObject({
    /** The tileset (tilesets.json) the board's floor is drawn from. */
    tileset: IdSchema.optional(),
    /** Where each ground terrain goes. Looks only: no rule reads it. */
    ground: GroundSchema.optional(),
    obstacles: WeightedIdsSchema.default([]),
    terrain: WeightedIdsSchema.default([]),
    hazards: WeightedIdsSchema.default([]),
    /** Loot table for 0-2 extra pickups lying on the board (pipes, glass). */
    scrap: IdSchema.optional(),
  }).prefault({}),
  /**
   * Encounter makeup. Ordinary fights are packs of weak minions (possibly two
   * families); elites lead lairs, sometimes with escorts.
   */
  encounters: z.strictObject({
    pack: IntRangeSchema.default([2, 4]),
    corridorPack: IntRangeSchema.default([2, 3]),
    /** Chance a pack mixes in a second family even when the first could fill it. */
    mixedChance: z.number().min(0).max(1).default(0.35),
    eliteAloneChance: z.number().min(0).max(1).default(0.5),
    eliteEscorts: IntRangeSchema.default([1, 2]),
    /** The first this-many fights on the floor roll from the easy pool, lairs included. */
    easyFights: z.number().int().min(0).default(3),
    /** Families for the easy opening fights. Empty = any family on the floor. */
    easyPool: z.array(IdSchema).default([]),
    /** Families for every fight after that. Empty = any family on the floor. */
    hardPool: z.array(IdSchema).default([]),
    /** Pack size for easy fights; a lone enemy is allowed here. */
    easyPack: IntRangeSchema.default([1, 2]),
    /** Added to enemy level in easy fights (on top of the tier's offset). */
    easyLevelOffset: z.number().int().default(-1),
    /** Added to every enemy's level on this floor: the floor-wide difficulty knob. */
    levelOffset: z.number().int().default(0),
    /** Chance a hard pack is led by a full-strength mob in place of two of its minions. */
    mobChance: z.number().min(0).max(1).default(0.25),
  }).prefault({}),
  /** Extra closing lines by special room type; empty array = no extra line. */
  typeLines: z.strictObject({
    stairwell: LinePool.default([]),
    safe: LinePool.default([]),
    treasure: LinePool.default([]),
    puzzle: LinePool.default([]),
    npc: LinePool.default([]),
    empty: LinePool.default([]),
  }),
}).refine((t) => t.rooms <= t.width * t.height * 0.7, {
  message: "rooms must fit the grid with slack (<= 70% of cells) or the walk jams",
});
export type FloorTheme = z.infer<typeof FloorThemeSchema>;

// ---------------------------------------------------------------- enemies

export const RANGE_BANDS = ["close", "near", "far"] as const;
export const RangeBandSchema = z.enum(RANGE_BANDS);
export type RangeBand = z.infer<typeof RangeBandSchema>;

export const EnemyAttackSchema = z.strictObject({
  name: z.string(),
  /** Damage by power-roll tier. */
  power: PowerSchema,
  /** AP this attack costs the enemy (default 2). */
  ap: z.number().int().min(1).max(4).optional(),
  damageType: DamageTypeSchema.default("physical"),
  /** Stat added to the power roll and quarter-added to damage. */
  stat: StatSchema,
  range: RangeBandSchema,
  /** Rounds between uses; attacks with a cooldown are "specials" to the AI. */
  cooldown: z.number().int().min(1).optional(),
  status: OnHitStatusSchema.optional(),
});
export type EnemyAttack = z.infer<typeof EnemyAttackSchema>;

/** AI priority tokens, checked in order each enemy turn. */
const AiTokenSchema = z.string().regex(/^(flee_below_\d+|special_if_ready|keep_range|attack)$/);

export const EnemyFamilySchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  /** Which floor's encounter table rolls this family. */
  floor: z.number().int().min(1),
  /** Codex line. */
  description: z.string(),
  /** Baseline stats at the floor's typical level; shifted 1 per level away from it. */
  stats: StatBlockSchema,
  hpBase: z.number().min(1),
  /** Subtracted from every hit it takes (never below 1 damage). */
  armor: z.number().default(0),
  attacks: z.array(EnemyAttackSchema).min(1),
  ai: z.array(AiTokenSchema).min(1),
  preferRange: RangeBandSchema.default("close"),
  talkable: z.boolean().default(false),
  /** How many of this family a pack can hold (packs may mix in a second family). */
  groupSize: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  /** Grid mode: tiles moved per turn. The crawler moves 4. */
  speed: z.number().int().min(1).max(8).default(4),
  /** One or two characters drawn when there's no sprite; defaults to the first letter. */
  glyph: z.string().min(1).max(2).optional(),
  /** Base XP per kill, scaled by level. */
  xp: z.number().min(0),
  tags: z.array(z.string()).default([]),
});
export type EnemyFamily = z.infer<typeof EnemyFamilySchema>;

export const EnemyModSchema = z.strictObject({
  id: IdSchema,
  /** Name prefix: "Rabid Sump Rat". */
  name: z.string(),
  hpMult: z.number().positive().default(1),
  damageBonus: z.number().default(0),
  armorBonus: z.number().default(0),
  defenseBonus: z.number().default(0),
  initiativeBonus: z.number().default(0),
  regen: z.number().default(0),
  fleeBelow: z.number().min(0).max(1).optional(),
  talkable: z.boolean().optional(),
  statusOnHit: OnHitStatusSchema.optional(),
  weight: z.number().positive().default(1),
});
export type EnemyMod = z.infer<typeof EnemyModSchema>;

// ---------------------------------------------------------------- grid arenas

/** What happens to a unit that walks into (enter) or starts its turn on (stay) a feature. */
export const HazardEffectSchema = z.strictObject({
  dice: DiceSchema.optional(),
  damageType: DamageTypeSchema.default("physical"),
  status: OnHitStatusSchema.optional(),
});
export type HazardEffect = z.infer<typeof HazardEffectSchema>;

/**
 * One tile of grid-combat furniture. Obstacles and terrain are laid out when the
 * arena is generated; hazards can also be placed mid-fight (thrown caltrops, fire).
 */
export const ArenaFeatureSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  kind: z.enum(["obstacle", "terrain", "hazard"]),
  /** Drawn when there's no sprite. */
  glyph: z.string().min(1).max(2),
  blocksMove: z.boolean().default(false),
  blocksSight: z.boolean().default(false),
  /** Movement points to step onto this tile. */
  moveCost: z.number().int().min(1).max(3).default(1),
  enter: HazardEffectSchema.optional(),
  stay: HazardEffectSchema.optional(),
  /** Placed hazards burn out after this many rounds; omitted = lasts the fight. */
  rounds: z.number().int().min(1).optional(),
  /** Gone after it triggers once (trip wire, glue). */
  consumedOnTrigger: z.boolean().default(false),
  /** Enemies path around it. False for things they can't see coming. */
  aiAvoids: z.boolean().default(true),
  description: z.string(),
}).refine((f) => f.kind !== "obstacle" || f.blocksMove, { message: "obstacles must block movement" });
export type ArenaFeature = z.infer<typeof ArenaFeatureSchema>;

// ---------------------------------------------------------------- crafting

/** One slot in a recipe: an item with any of these tags (or exactly this id). */
export const RecipeInputSchema = z.strictObject({
  /** Any one of these tags qualifies (item tags, weapon type, weapon/armor, slot:<slot>). */
  tags: z.array(z.string().min(1)).min(1).optional(),
  id: IdSchema.optional(),
  /** Units needed: one stack of 2, or two items that each match. */
  qty: z.number().int().min(1).default(1),
  /** Tools (a hammer) aren't used up. */
  consumed: z.boolean().default(true),
  /** Upgrades: the item that gets improved instead of used up. */
  base: z.boolean().default(false),
}).refine((i) => i.tags !== undefined || i.id !== undefined, { message: "an input needs tags or an id" });
export type RecipeInput = z.infer<typeof RecipeInputSchema>;

export const UpgradeSchema = z.strictObject({
  kind: z.literal("upgrade"),
  /** "Nail-Studded Aluminum Baseball Bat" */
  prefix: z.string().min(1),
  damageBonus: z.number().int().default(0),
  /** Bump the weapon's power this many steps (each step: +1 at tier 2, +2 at tier 3). */
  damageStep: z.number().int().min(0).max(2).default(0),
  damageType: DamageTypeSchema.optional(),
  armorBonus: z.number().int().default(0),
  modifiers: z.array(ModifierSchema).default([]),
  onHit: OnHitStatusSchema.optional(),
  range: RangeBandSchema.optional(),
  addTags: z.array(z.string()).default([]),
});

export const RecipeSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  inputs: z.array(RecipeInputSchema).min(2).max(4),
  output: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("item"), ref: IdSchema, qty: z.number().int().min(1).default(1) }),
    UpgradeSchema,
  ]),
  /** Optional skill check; failing loses a part (and still teaches the recipe). */
  check: z.strictObject({
    stat: StatSchema,
    skill: IdSchema.optional(),
    tier: DcTierSchema,
    /** What a critical failure does to you. */
    mishap: z.strictObject({ dice: DiceSchema.optional(), damageType: DamageTypeSchema.default("physical"), statusId: IdSchema.optional() }).optional(),
  }).optional(),
  /** Game minutes at the bench. */
  minutes: z.number().int().min(1).default(20),
  /** Breaks ties between equally specific recipes. */
  priority: z.number().int().default(0),
  /** The recipe book's cryptic nudge, shown once you're carrying every part. */
  hint: z.string().min(1),
  /** Said when it works. */
  text: z.string().min(1),
}).refine((r) => r.output.kind !== "upgrade" || r.inputs.filter((i) => i.base).length === 1, {
  message: "upgrade recipes need exactly one base input",
}).refine((r) => r.output.kind === "upgrade" || r.inputs.every((i) => !i.base), {
  message: "only upgrades have a base input",
});
export type Recipe = z.infer<typeof RecipeSchema>;

// ---------------------------------------------------------------- narration

/** A `where`/`when` clause: path -> literal or comparison. Shared by achievements and templates. */
export const ComparisonSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.strictObject({
    eq: z.union([z.number(), z.string(), z.boolean()]).optional(),
    ne: z.union([z.number(), z.string(), z.boolean()]).optional(),
    gte: z.number().optional(),
    lte: z.number().optional(),
    gt: z.number().optional(),
    lt: z.number().optional(),
    in: z.array(z.union([z.number(), z.string()])).optional(),
    has: z.union([z.number(), z.string()]).optional(),
  }),
]);
export const WhereSchema = z.record(z.string(), ComparisonSchema);
export type Where = z.infer<typeof WhereSchema>;

export const NarrationSchema = z.strictObject({
  key: z.string().min(1),
  variants: z.array(z.strictObject({
    text: z.string().min(1),
    when: WhereSchema.optional(),
  })).min(1),
});
export type NarrationTemplate = z.infer<typeof NarrationSchema>;

// ---------------------------------------------------------------- the thread (Echo, shards, the Codex)

export const ShardIdSchema = z.string().regex(/^S\d{2}$/, "shard ids look like S01");
export const ModuleIdSchema = z.string().regex(/^M\d{2}$/, "module ids look like M01");
export const STRANDS = ["Echo's Past", "Previous Carriers", "The Mother Below", "The Cut"] as const;
export const StrandSchema = z.enum(STRANDS);
/** 1-3 are the acts; 4 is the Floor 13 finale. */
export const ActSchema = z.number().int().min(1).max(4);

/** S01-S52. Room shards turn up in a room's description; the boss one is the boss's opening line. */
export const ShardSchema = z.strictObject({
  id: ShardIdSchema,
  floor: z.number().int().min(1).max(13),
  clue: z.string().min(1),
  delivery: z.enum(["room", "boss"]),
  strand: StrandSchema,
  /** Echo's reaction, already written for the floor's act. */
  reaction: z.string().min(1).optional(),
  /** Floor 13: Echo's reaction depends on Temper. */
  reactionCalm: z.string().min(1).optional(),
  reactionFed: z.string().min(1).optional(),
}).refine((s) => s.reaction !== undefined || (s.reactionCalm !== undefined && s.reactionFed !== undefined), {
  message: "a shard needs a reaction, or both reactionCalm and reactionFed",
});
export type Shard = z.infer<typeof ShardSchema>;

/**
 * What a module variant does, as flags and numbers the engine reads. A variant's bag
 * is complete on its own (the Fed variant doesn't inherit from base).
 */
export const ModuleEffectSchema = z.strictObject({
  /** Glow: chance on a first visit to turn up what's hidden (items, hidden stairwells). */
  revealHidden: z.number().min(0).max(1).optional(),
  /** Glow (Calm): trap rooms are spotted automatically. */
  spotTraps: z.boolean().optional(),
  /** Glow (Fed): enemies are blinded this many rounds when a fight starts (light-sensitive ones stunned). */
  blindOnStart: z.number().int().min(1).optional(),
  /** Nervous Ping: chance an ambush is called out, so you act first. */
  ambushGuard: z.number().min(0).max(1).optional(),
  /** Nervous Ping (Calm): added to your initiative. */
  initiative: z.number().int().optional(),
  /** Nervous Ping (Fed): `shout` deals this to everything within near range (1 AP, once a fight). */
  shout: DiceSchema.optional(),
  /** Lost Property Index: value, curses and lost-property tags show in item details. */
  appraise: z.boolean().optional(),
  /** Lost Property Index (Calm), Salt Reader: what a consumable does shows in its details. */
  identify: z.boolean().optional(),
  /** Lost Property Index (Fed): sale price bonus, once shops exist. */
  sellBonus: z.number().min(0).optional(),
  /** Fault Sense: hidden stairwells within this many rooms show up. */
  senseStairs: z.number().int().min(1).optional(),
  /** Fault Sense: a boss lair within this many rooms is marked on the map. */
  senseLair: z.number().int().min(1).optional(),
  /** Fault Sense (Calm): every safe room on the floor is marked. */
  markSafe: z.boolean().optional(),
  /** Fault Sense (Fed): `break <dir>` knocks through to a neighbouring room. */
  breakWalls: z.boolean().optional(),
  /** Salt Reader (Calm): poison is neutralized the moment it lands. */
  curePoison: z.boolean().optional(),
  /** Salt Reader (Fed): `coat` poisons your weapon for this many hits (once a floor). */
  coat: z.number().int().min(1).optional(),
  /** Rope Bind: `bind <enemy>` tethers it for this many rounds (1 AP, once a fight). */
  tether: z.number().int().min(1).optional(),
  /** Rope Bind (Fed): the bind yanks the enemy into melee for this much damage instead. */
  yank: z.number().int().min(1).optional(),
});
export type ModuleEffect = z.infer<typeof ModuleEffectSchema>;

export const ModuleSchema = z.strictObject({
  id: ModuleIdSchema,
  name: z.string().min(1),
  /** The shard that unlocks it for the run. */
  unlockedBy: ShardIdSchema,
  /** Workbook wording ("Cracked screen, 1 battery"). */
  partsText: z.string().min(1),
  /** What `craft` uses up: item ids and counts. Empty until the module is built. */
  parts: z.array(z.strictObject({ item: IdSchema, qty: z.number().int().min(1).default(1) })).default([]),
  base: z.string().min(1),
  calm: z.string().min(1),
  fed: z.string().min(1),
  /** Structured effects per variant; absent until the module is built. */
  effects: z.strictObject({ base: ModuleEffectSchema, calm: ModuleEffectSchema, fed: ModuleEffectSchema }).optional(),
  /** Game minutes at the bench. */
  minutes: z.number().int().min(1).default(30),
}).refine((m) => !m.effects || m.parts.length > 0, { message: "a built module (with effects) needs parts", path: ["parts"] });
export type EchoModule = z.infer<typeof ModuleSchema>;

const TemperSourceSchema = z.strictObject({
  /** Negative is Calm, positive is Fed. */
  delta: z.number().int(),
  /** How many times this source counts per floor; omitted = every time. */
  perFloor: z.number().int().min(1).optional(),
});

export const URGE_KINDS = ["rummage", "listen", "zap"] as const;

export const TemperSchema = z.strictObject({
  min: z.number().int().default(-5),
  max: z.number().int().default(5),
  /** At or above: modules use the Fed variant. */
  fedAt: z.number().int().default(3),
  /** At or below: modules use the Calm variant. */
  calmAt: z.number().int().default(-3),
  stages: z.array(z.strictObject({
    id: IdSchema,
    name: z.string(),
    act: ActSchema,
    wholeness: z.string(),
    voice: z.string(),
    calm: z.string(),
    fed: z.string(),
    mechanics: z.string(),
  })).length(4),
  sources: z.strictObject({
    rest: TemperSourceSchema,
    refuse: TemperSourceSchema,
    allow: TemperSourceSchema,
    feed: TemperSourceSchema,
    damagingModule: TemperSourceSchema,
    soothe: TemperSourceSchema,
  }),
  /** Echo asks to do something; `let echo` or `hush`. Chance per first room visit / per fight. */
  urges: z.strictObject({
    explore: z.strictObject({ chance: z.number().min(0).max(1), kinds: z.array(z.enum(URGE_KINDS)).min(1) }),
    combat: z.strictObject({ chance: z.number().min(0).max(1), kinds: z.array(z.enum(URGE_KINDS)).min(1) }),
    /** What a zap does (lightning), plus the floor number. */
    zap: DiceSchema,
  }),
});
export type TemperRules = z.infer<typeof TemperSchema>;

export const BOSS_GATES = ["none", "obviousStairs", "finale"] as const;

export const ThreadSchema = z.strictObject({
  /** The Thread sheet: the master thread, the strands, the mechanic. */
  threads: z.array(z.strictObject({
    id: IdSchema,
    name: z.string(),
    codename: z.string(),
    premise: z.string(),
    reveal: z.string(),
    status: z.string(),
  })).min(1),
  delivery: z.strictObject({
    /** First visit to a room (not the start): chance a room shard turns up. */
    roomChance: z.number().min(0).max(1),
    /** A boss fight starting: chance its throwaway shard is the opening line. */
    bossChance: z.number().min(0).max(1),
  }),
  /** Where Echo wakes each run. Cosmetic. */
  vessels: z.array(z.strictObject({
    id: IdSchema,
    name: z.string(),
    /** Narrator line when the run starts. */
    wake: z.string(),
    /** Short form for the Echo panel ("a music box, lid cracked"). */
    short: z.string(),
  })).min(1),
  /** The 13-floor arc (the Floor Arc sheet plus the boss gate). */
  floors: z.array(z.strictObject({
    floor: z.number().int().min(1).max(13),
    theme: z.string(),
    boss: IdSchema,
    beat: z.string(),
    act: ActSchema,
    voice: z.string(),
    jointMouth: z.string(),
    /** Percent. */
    wholenessAfter: z.number().min(0).max(100),
    bossGate: z.enum(BOSS_GATES),
  })).length(13),
  endings: z.array(z.strictObject({
    id: IdSchema,
    name: z.string(),
    /** Inclusive Temper range. */
    temper: z.tuple([z.number().int(), z.number().int()]),
    host: z.string(),
  })).length(3),
  contract: z.array(z.string()).length(4),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const CODEX_TYPES = ["lore", "recipe", "weakness", "ending"] as const;

export const CodexEntrySchema = z.strictObject({
  id: IdSchema,
  type: z.enum(CODEX_TYPES),
  name: z.string(),
  text: z.string(),
  /** Workbook wording of the unlock rule and floor range. */
  unlockText: z.string(),
  floorText: z.string(),
  unlock: z.strictObject({
    shards: z.array(ShardIdSchema).optional(),
    module: ModuleIdSchema.optional(),
    boss: IdSchema.optional(),
    ending: IdSchema.optional(),
  }),
  /** Lore: the shards whose clues fill this entry in, one line each. */
  lines: z.array(ShardIdSchema).default([]),
  /** Not in the workbook yet (written in the JSON). */
  draft: z.boolean().optional(),
});
export type CodexEntry = z.infer<typeof CodexEntrySchema>;

/** What a boss's weakness does when it triggers. */
export const WeaknessSchema = z.strictObject({
  text: z.string(),
  /** decline: `decline` this many times. item: use or return an item with this tag. Absent: not built yet. */
  trigger: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("decline"), count: z.number().int().min(1) }),
    z.strictObject({ kind: z.literal("item"), tag: z.string().min(1) }),
  ]).optional(),
  /** Status put on the boss; no `rounds` = the rest of the fight. */
  effect: z.strictObject({ status: IdSchema, rounds: z.number().int().min(1).optional() }).optional(),
  /** Said (narrator) when it lands. */
  line: z.string().optional(),
});

export const BossSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  floor: z.number().int().min(1).max(13),
  kind: z.enum(["mini", "gate", "finale"]),
  weakness: WeaknessSchema,
  /** The fight. Absent until the boss's floor is built. */
  family: EnemyFamilySchema.optional(),
  hpMult: z.number().positive().default(4),
  xpMult: z.number().positive().default(6),
  /** Said when the fight starts. */
  intro: z.array(z.string()).default([]),
  /** Said now and then on its turn. */
  taunts: z.array(z.string()).default([]),
  defeat: z.string().optional(),
  /** Said the first time you walk into a room next to its lair. */
  nearby: z.string().optional(),
  /** Dropped on the lair floor when it dies. */
  drops: z.strictObject({ table: IdSchema.optional(), rolls: z.number().int().min(0).default(0), items: z.array(IdSchema).default([]) }).prefault({}),
}).refine((b) => !b.family || b.family.floor === b.floor, { message: "the boss's family.floor must match its floor", path: ["family", "floor"] });
export type Boss = z.infer<typeof BossSchema>;

/** I01-I30: hand-written items from the workbook, built as an item base or a consumable. */
export const OdditySchema = z.strictObject({
  id: IdSchema,
  ref: z.string().regex(/^I\d{2}$/),
  name: z.string(),
  description: z.string(),
  type: z.enum(["Weapon", "Armor", "Consumable", "Trinket", "Tool", "Junk"]),
  rarityText: z.string(),
  effectText: z.string(),
  threadTie: z.enum(["None", "Echo", "Previous Carriers", "The Mother Below", "Boss weakness"]),
  /** Inclusive floor range it can turn up on. */
  floors: z.tuple([z.number().int().min(1), z.number().int().max(13)]),
  /** Picking it up records this boss's weakness in the Codex. */
  hintFor: IdSchema.optional(),
  /** Temper change each time you change floors carrying it. */
  temperPerFloor: z.number().int().optional(),
  /** Temper change each hit (weapons). */
  temperOnHit: z.number().int().optional(),
  /** Exactly one of these is the item the engine spawns (same id and name). */
  gear: ItemBaseSchema.optional(),
  consumable: ConsumableSchema.optional(),
}).refine((o) => (o.gear ? 1 : 0) + (o.consumable ? 1 : 0) === 1, { message: "an oddity is exactly one of gear or consumable" })
  .refine((o) => (o.gear ?? o.consumable)!.id === o.id && (o.gear ?? o.consumable)!.name === o.name, { message: "the item's id and name must match the oddity's" });
export type Oddity = z.infer<typeof OdditySchema>;
