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
 * `cure` (removes `statusId`) is an addition to the spec's kinds; see DECISIONS.md.
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
  damage: DiceSchema.optional(),
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
  if (b.slot === "mainHand" && b.weaponType && (!b.damage || !b.stat)) {
    ctx.addIssue({ code: "custom", message: "weapons need damage and stat" });
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
  }).prefault({}),
  /** Grid-combat dressing: what arenas on this floor are furnished with (ids in arenaFeatures.json). */
  arena: z.strictObject({
    /** Floor sprite variants: `<theme id>_1.png` .. `<theme id>_N.png`. */
    floorVariants: z.number().int().min(1).default(1),
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
  dice: DiceSchema,
  damageType: DamageTypeSchema.default("physical"),
  /** Stat added to the hit roll and half-added to damage. */
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
  /** Added to defense (spec formula). */
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
  /** Bump the weapon's die size this many steps (d4 → d6 → d8 ...). */
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
