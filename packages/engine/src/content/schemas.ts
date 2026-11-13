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
});
export type Consumable = z.infer<typeof ConsumableSchema>;

// ---------------------------------------------------------------- floors

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
  /** Extra closing lines by special room type; empty array = no extra line. */
  typeLines: z.strictObject({
    stairwell: LinePool.default([]),
    safe: LinePool.default([]),
    treasure: LinePool.default([]),
    puzzle: LinePool.default([]),
    npc: LinePool.default([]),
    empty: LinePool.default([]),
  }),
});
export type FloorTheme = z.infer<typeof FloorThemeSchema>;

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
