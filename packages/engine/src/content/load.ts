import { z } from "zod";
import {
  ArenaFeatureSchema,
  LootTableSchema,
  RecipeSchema,
  ConsumableSchema,
  EnemyFamilySchema,
  EnemyModSchema,
  FloorThemeSchema,
  FormativeEventSchema,
  ItemBaseSchema,
  LocationSchema,
  NamesSchema,
  NarrationSchema,
  OccupationSchema,
  QuirkSchema,
  SkillSchema,
  StatusEffectSchema,
  type ArenaFeature,
  type LootTable,
  type Recipe,
  type Consumable,
  type EnemyFamily,
  type EnemyMod,
  type FloorTheme,
  type FormativeEvent,
  type ItemBase,
  type Location,
  type Names,
  type NarrationTemplate,
  type Occupation,
  type Quirk,
  type Skill,
  type StatusEffect,
} from "./schemas";

/** Every content file, keyed by its path under packages/content. */
export const CONTENT_FILES = {
  "skills.json": z.array(SkillSchema),
  "statusEffects.json": z.array(StatusEffectSchema),
  "narration.json": z.array(NarrationSchema),
  "floors.json": z.array(FloorThemeSchema),
  "enemies.json": z.array(EnemyFamilySchema),
  "enemyMods.json": z.array(EnemyModSchema),
  "backstory/occupations.json": z.array(OccupationSchema),
  "backstory/events.json": z.array(FormativeEventSchema),
  "backstory/quirks.json": z.array(QuirkSchema),
  "backstory/locations.json": z.array(LocationSchema),
  "backstory/names.json": NamesSchema,
  "items/bases.json": z.array(ItemBaseSchema),
  "items/consumables.json": z.array(ConsumableSchema),
  "arenaFeatures.json": z.array(ArenaFeatureSchema),
  "lootTables.json": z.array(LootTableSchema),
  "recipes.json": z.array(RecipeSchema),
} as const;

export type ContentFileName = keyof typeof CONTENT_FILES;
export type RawContent = Record<ContentFileName, unknown>;

export interface Table<T extends { id: string }> {
  all: T[];
  byId: Record<string, T>;
  has(id: string): boolean;
  /** Throws if missing — content cross-refs are validated at load, so a miss is a bug. */
  get(id: string): T;
}

export interface Content {
  skills: Table<Skill>;
  statusEffects: Table<StatusEffect>;
  narration: Record<string, NarrationTemplate>;
  floors: Table<FloorTheme>;
  enemies: Table<EnemyFamily>;
  enemyMods: Table<EnemyMod>;
  backstory: {
    occupations: Table<Occupation>;
    events: Table<FormativeEvent>;
    quirks: Table<Quirk>;
    locations: Table<Location>;
    names: Names;
  };
  items: {
    bases: Table<ItemBase>;
    consumables: Table<Consumable>;
  };
  arenaFeatures: Table<ArenaFeature>;
  lootTables: Table<LootTable>;
  recipes: Table<Recipe>;
}

export class ContentError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Content validation failed (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n` +
      problems.map((p) => `  ✗ ${p}`).join("\n"));
    this.name = "ContentError";
  }
}

function table<T extends { id: string }>(name: string, items: T[], problems: string[]): Table<T> {
  const byId: Record<string, T> = {};
  for (const it of items) {
    if (byId[it.id]) problems.push(`${name}: duplicate id "${it.id}"`);
    byId[it.id] = it;
  }
  return {
    all: items,
    byId,
    has: (id) => id in byId,
    get(id) {
      const v = byId[id];
      if (!v) throw new Error(`${name}: unknown id "${id}"`);
      return v;
    },
  };
}

function formatPath(file: string, raw: unknown, path: PropertyKey[]): string {
  let label = file;
  if (typeof path[0] === "number" && Array.isArray(raw)) {
    const el = raw[path[0]] as { id?: unknown; key?: unknown } | undefined;
    const name = el?.id ?? el?.key;
    label += `[${path[0]}${typeof name === "string" ? ` "${name}"` : ""}]`;
    path = path.slice(1);
  }
  return path.length ? `${label}.${path.map(String).join(".")}` : label;
}

/** Validate raw JSON content against the schemas and cross-references. Throws ContentError. */
export function loadContent(raw: RawContent): Content {
  const problems: string[] = [];
  const parsed: Partial<Record<ContentFileName, unknown>> = {};

  for (const [file, schema] of Object.entries(CONTENT_FILES) as [ContentFileName, z.ZodType][]) {
    if (!(file in raw)) {
      problems.push(`${file}: file is missing from the content index`);
      continue;
    }
    const res = schema.safeParse(raw[file]);
    if (res.success) parsed[file] = res.data;
    else for (const issue of res.error.issues) problems.push(`${formatPath(file, raw[file], issue.path)}: ${issue.message}`);
  }
  if (problems.length) throw new ContentError(problems);

  const p = parsed as { [K in ContentFileName]: z.infer<(typeof CONTENT_FILES)[K]> };
  const narration: Record<string, NarrationTemplate> = {};
  for (const t of p["narration.json"]) {
    if (narration[t.key]) problems.push(`narration.json: duplicate key "${t.key}"`);
    narration[t.key] = t;
  }

  const content: Content = {
    skills: table("skills.json", p["skills.json"], problems),
    statusEffects: table("statusEffects.json", p["statusEffects.json"], problems),
    narration,
    floors: table("floors.json", p["floors.json"], problems),
    enemies: table("enemies.json", p["enemies.json"], problems),
    enemyMods: table("enemyMods.json", p["enemyMods.json"], problems),
    backstory: {
      occupations: table("backstory/occupations.json", p["backstory/occupations.json"], problems),
      events: table("backstory/events.json", p["backstory/events.json"], problems),
      quirks: table("backstory/quirks.json", p["backstory/quirks.json"], problems),
      locations: table("backstory/locations.json", p["backstory/locations.json"], problems),
      names: p["backstory/names.json"],
    },
    items: {
      bases: table("items/bases.json", p["items/bases.json"], problems),
      consumables: table("items/consumables.json", p["items/consumables.json"], problems),
    },
    arenaFeatures: table("arenaFeatures.json", p["arenaFeatures.json"], problems),
    lootTables: table("lootTables.json", p["lootTables.json"], problems),
    recipes: table("recipes.json", p["recipes.json"], problems),
  };

  checkReferences(content, problems);
  if (problems.length) throw new ContentError(problems);
  return content;
}

/** Item reference: an item base or a consumable. */
export function itemRefExists(c: Content, id: string): boolean {
  return c.items.bases.has(id) || c.items.consumables.has(id);
}

function checkReferences(c: Content, problems: string[]): void {
  const ref = (where: string, kind: string, ok: boolean, id: string) => {
    if (!ok) problems.push(`${where}: unknown ${kind} "${id}"`);
  };
  for (const o of c.backstory.occupations.all) {
    ref(`backstory/occupations.json "${o.id}".skill`, "skill", c.skills.has(o.skill), o.skill);
    ref(`backstory/occupations.json "${o.id}".item`, "item", itemRefExists(c, o.item), o.item);
  }
  for (const l of c.backstory.locations.all) {
    for (const cl of l.clothing) {
      ref(`backstory/locations.json "${l.id}".clothing`, "item base", c.items.bases.has(cl), cl);
    }
    ref(`backstory/locations.json "${l.id}".item`, "item", itemRefExists(c, l.item), l.item);
  }
  for (const s of c.statusEffects.all) {
    for (const t of s.tick) {
      if (t.statusId) ref(`statusEffects.json "${s.id}".tick`, "status", c.statusEffects.has(t.statusId), t.statusId);
    }
  }
  for (const cons of c.items.consumables.all) {
    for (const e of cons.effects) {
      if (e.statusId) ref(`items/consumables.json "${cons.id}".effects`, "status", c.statusEffects.has(e.statusId), e.statusId);
    }
    if (cons.hazard) {
      const f = c.arenaFeatures.byId[cons.hazard.id];
      if (!f) problems.push(`items/consumables.json "${cons.id}".hazard: unknown arena feature "${cons.hazard.id}"`);
      else if (f.kind !== "hazard") problems.push(`items/consumables.json "${cons.id}".hazard: "${f.id}" is a ${f.kind}, not a hazard`);
    }
  }
  for (const f of c.arenaFeatures.all) {
    for (const eff of [f.enter, f.stay]) {
      if (eff?.status) ref(`arenaFeatures.json "${f.id}"`, "status", c.statusEffects.has(eff.status.id), eff.status.id);
    }
  }
  for (const t of c.floors.all) {
    const kinds: [keyof typeof t.arena, string[]][] = [["obstacles", ["obstacle"]], ["terrain", ["terrain"]], ["hazards", ["hazard", "terrain"]]];
    for (const [list, allowed] of kinds) {
      for (const { id } of t.arena[list] as { id: string }[]) {
        const f = c.arenaFeatures.byId[id];
        if (!f) problems.push(`floors.json "${t.id}".arena.${list}: unknown arena feature "${id}"`);
        else if (!allowed.includes(f.kind)) problems.push(`floors.json "${t.id}".arena.${list}: "${id}" is a ${f.kind}`);
      }
    }
    for (const trap of t.trapTypes) {
      if (trap.arenaHazard) ref(`floors.json "${t.id}".trapTypes "${trap.id}".arenaHazard`, "arena feature", c.arenaFeatures.has(trap.arenaHazard), trap.arenaHazard);
      if (trap.status) ref(`floors.json "${t.id}".trapTypes "${trap.id}".status`, "status", c.statusEffects.has(trap.status.id), trap.status.id);
    }
  }
  for (const t of c.lootTables.all) {
    for (const e of t.entries) ref(`lootTables.json "${t.id}"`, "item", itemRefExists(c, e.item), e.item);
  }
  for (const t of c.floors.all) {
    const where = `floors.json "${t.id}".loot`;
    for (const [type, rl] of Object.entries(t.loot.rooms)) {
      if (rl) ref(`${where}.rooms.${type}.table`, "loot table", c.lootTables.has(rl.table), rl.table);
    }
    if (t.arena.scrap) ref(`floors.json "${t.id}".arena.scrap`, "loot table", c.lootTables.has(t.arena.scrap), t.arena.scrap);
    if (t.loot.workshopTable) ref(`${where}.workshopTable`, "loot table", c.lootTables.has(t.loot.workshopTable), t.loot.workshopTable);
    for (const f of t.loot.firstSafe) ref(`${where}.firstSafe`, "item", itemRefExists(c, f.item), f.item);
  }
  for (const r of c.recipes.all) {
    const where = `recipes.json "${r.id}"`;
    for (const i of r.inputs) if (i.id) ref(`${where}.inputs`, "item", itemRefExists(c, i.id), i.id);
    if (r.output.kind === "item") ref(`${where}.output`, "item", itemRefExists(c, r.output.ref), r.output.ref);
    if (r.output.kind === "upgrade" && r.output.onHit) ref(`${where}.output.onHit`, "status", c.statusEffects.has(r.output.onHit.id), r.output.onHit.id);
    if (r.check?.skill) ref(`${where}.check.skill`, "skill", c.skills.has(r.check.skill), r.check.skill);
    if (r.check?.mishap?.statusId) ref(`${where}.check.mishap`, "status", c.statusEffects.has(r.check.mishap.statusId), r.check.mishap.statusId);
  }
  for (const b of c.items.bases.all) {
    if (b.onHit) ref(`items/bases.json "${b.id}".onHit`, "status", c.statusEffects.has(b.onHit.id), b.onHit.id);
  }
  for (const e of c.enemies.all) {
    for (const a of e.attacks) {
      if (a.status) ref(`enemies.json "${e.id}".attacks "${a.name}"`, "status", c.statusEffects.has(a.status.id), a.status.id);
    }
  }
}
