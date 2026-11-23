import { z } from "zod";
import {
  ArenaFeatureSchema,
  LootTableSchema,
  RecipeSchema,
  CraftPartSchema,
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
  ThreadSchema,
  ShardSchema,
  ModuleSchema,
  TemperSchema,
  CodexEntrySchema,
  BossSchema,
  OdditySchema,
  TilesetSchema,
  type ArenaFeature,
  type LootTable,
  type Recipe,
  type CraftPart,
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
  type Thread,
  type Shard,
  type EchoModule,
  type TemperRules,
  type CodexEntry,
  type Boss,
  type Oddity,
  type Tileset,
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
  "craftParts.json": z.array(CraftPartSchema),
  "thread.json": ThreadSchema,
  "shards.json": z.array(ShardSchema),
  "modules.json": z.array(ModuleSchema),
  "temper.json": TemperSchema,
  "codex.json": z.array(CodexEntrySchema),
  "bosses.json": z.array(BossSchema),
  "items/oddities.json": z.array(OdditySchema),
  "tilesets.json": z.array(TilesetSchema),
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
  /** Crafting properties: workbench groups and the names of recipe parts. */
  craftParts: Table<CraftPart>;
  /** The story layer (see "The thread" in docs/DESIGN.md). */
  thread: Thread;
  shards: Table<Shard>;
  modules: Table<EchoModule>;
  temper: TemperRules;
  codex: Table<CodexEntry>;
  bosses: Table<Boss>;
  /** I01-I30; each is also registered as an item base or consumable under the same id. */
  oddities: Table<Oddity>;
  /** Floor tilesets for the battle board (Godot-style terrains; see "Floor tiling" in docs/DESIGN.md). */
  tilesets: Table<Tileset>;
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

  // Oddities spawn through the ordinary item tables, so register each under its own id.
  const oddities = p["items/oddities.json"];
  const bases = [...p["items/bases.json"], ...oddities.flatMap((o) => (o.gear ? [o.gear] : []))];
  const consumables = [...p["items/consumables.json"], ...oddities.flatMap((o) => (o.consumable ? [o.consumable] : []))];

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
      bases: table("items/bases.json", bases, problems),
      consumables: table("items/consumables.json", consumables, problems),
    },
    arenaFeatures: table("arenaFeatures.json", p["arenaFeatures.json"], problems),
    lootTables: table("lootTables.json", p["lootTables.json"], problems),
    recipes: table("recipes.json", p["recipes.json"], problems),
    craftParts: table("craftParts.json", p["craftParts.json"], problems),
    thread: p["thread.json"],
    shards: table("shards.json", p["shards.json"], problems),
    modules: table("modules.json", p["modules.json"], problems),
    temper: p["temper.json"],
    codex: table("codex.json", p["codex.json"], problems),
    bosses: table("bosses.json", p["bosses.json"], problems),
    oddities: table("items/oddities.json", oddities, problems),
    tilesets: table("tilesets.json", p["tilesets.json"], problems),
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
    for (const pool of ["easyPool", "hardPool"] as const) {
      for (const id of t.encounters[pool]) {
        ref(`floors.json "${t.id}".encounters.${pool}`, "enemy family", c.enemies.all.some((e) => e.id === id && e.floor === t.floor), id);
      }
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
  // Every tag a recipe asks for needs a name at the workbench.
  const named = new Set(c.craftParts.all.flatMap((cp) => cp.tags));
  for (const r of c.recipes.all) {
    for (const i of r.inputs) {
      for (const t of i.tags ?? []) if (!named.has(t)) problems.push(`recipes.json "${r.id}".inputs: tag "${t}" has no entry in craftParts.json`);
    }
  }
  for (const b of c.items.bases.all) {
    if (b.onHit) ref(`items/bases.json "${b.id}".onHit`, "status", c.statusEffects.has(b.onHit.id), b.onHit.id);
  }
  for (const e of c.enemies.all) {
    for (const a of e.attacks) {
      if (a.status) ref(`enemies.json "${e.id}".attacks "${a.name}"`, "status", c.statusEffects.has(a.status.id), a.status.id);
    }
  }
  checkThread(c, problems, ref);
  checkTilesets(c, problems);
}

type RefCheck = (where: string, kind: string, ok: boolean, id: string) => void;

/** The story layer's cross-references: shards, modules, the Codex, bosses, oddities, the floor arc. */
function checkThread(c: Content, problems: string[], ref: RefCheck): void {
  for (const m of c.modules.all) {
    const where = `modules.json "${m.id}"`;
    ref(`${where}.unlockedBy`, "shard", c.shards.has(m.unlockedBy), m.unlockedBy);
    for (const part of m.parts) ref(`${where}.parts`, "item", itemRefExists(c, part.item), part.item);
  }
  for (const e of c.codex.all) {
    const where = `codex.json "${e.id}"`;
    for (const s of [...(e.unlock.shards ?? []), ...e.lines]) ref(where, "shard", c.shards.has(s), s);
    if (e.unlock.module) ref(`${where}.unlock.module`, "module", c.modules.has(e.unlock.module), e.unlock.module);
    if (e.unlock.boss) ref(`${where}.unlock.boss`, "boss", c.bosses.has(e.unlock.boss), e.unlock.boss);
    if (e.unlock.ending) ref(`${where}.unlock.ending`, "ending", c.thread.endings.some((x) => x.id === e.unlock.ending), e.unlock.ending);
    const ways = Object.values(e.unlock).filter((v) => v !== undefined).length;
    if (ways !== 1) problems.push(`${where}.unlock: needs exactly one of shards, module, boss or ending`);
  }
  const floors = new Set(c.thread.floors.map((f) => f.floor));
  if (floors.size !== 13) problems.push("thread.json.floors: needs each floor 1-13 exactly once");
  for (const f of c.thread.floors) ref(`thread.json.floors[${f.floor}].boss`, "boss", c.bosses.has(f.boss), f.boss);
  for (const b of c.bosses.all) {
    const where = `bosses.json "${b.id}"`;
    if (b.weakness.effect) ref(`${where}.weakness.effect`, "status", c.statusEffects.has(b.weakness.effect.status), b.weakness.effect.status);
    for (const a of b.family?.attacks ?? []) {
      if (a.status) ref(`${where}.family.attacks "${a.name}"`, "status", c.statusEffects.has(a.status.id), a.status.id);
    }
    if (b.drops.table) ref(`${where}.drops.table`, "loot table", c.lootTables.has(b.drops.table), b.drops.table);
    for (const it of b.drops.items) ref(`${where}.drops.items`, "item", itemRefExists(c, it), it);
    if (b.family && !b.weakness.trigger) problems.push(`${where}: a built boss (with a family) needs a weakness trigger`);
  }
  for (const o of c.oddities.all) {
    if (o.hintFor) ref(`items/oddities.json "${o.id}".hintFor`, "boss", c.bosses.has(o.hintFor), o.hintFor);
    const def = o.consumable;
    for (const e of def?.effects ?? []) {
      if (e.statusId) ref(`items/oddities.json "${o.id}".effects`, "status", c.statusEffects.has(e.statusId), e.statusId);
    }
    if (o.gear?.onHit) ref(`items/oddities.json "${o.id}".onHit`, "status", c.statusEffects.has(o.gear.onHit.id), o.gear.onHit.id);
  }
  for (const t of c.floors.all) {
    if (!c.thread.floors.some((f) => f.floor === t.floor)) problems.push(`floors.json "${t.id}": floor ${t.floor} has no row in thread.json floors`);
    t.loot.scatter.forEach((s, i) => {
      const where = `floors.json "${t.id}".loot.scatter[${i}]`;
      if (s.table) ref(where, "loot table", c.lootTables.has(s.table), s.table);
      if (s.item) ref(where, "item", itemRefExists(c, s.item), s.item);
    });
  }
}

/** Tilesets: every terrain a tile or a floor names exists, and atlas tiles sit inside their sheet. */
function checkTilesets(c: Content, problems: string[]): void {
  for (const ts of c.tilesets.all) {
    const where = `tilesets.json "${ts.id}"`;
    for (const src of ts.sources) {
      if (ts.sources.filter((s) => s.id === src.id).length > 1) problems.push(`${where}: duplicate source id ${src.id}`);
      src.tiles.forEach((t, i) => {
        const at = `${where}.sources[${src.id}].tiles[${i}]`;
        const set = ts.terrainSets[t.terrainSet];
        if (!set) {
          problems.push(`${at}: unknown terrain set ${t.terrainSet}`);
          return;
        }
        const names = new Set(set.terrains.map((x) => x.name));
        const named = [t.terrain, ...Object.values(t.peering), ...t.alternatives.flatMap((a) => [a.terrain, ...Object.values(a.peering ?? {})])];
        for (const n of named) if (n && !names.has(n)) problems.push(`${at}: unknown terrain "${n}" in terrain set ${t.terrainSet}`);
        if (src.kind === "atlas" && t.atlas && src.textureSize && src.regionSize) {
          const right = src.margins[0] + t.atlas[0] * (src.regionSize[0] + src.separation[0]) + src.regionSize[0];
          const bottom = src.margins[1] + t.atlas[1] * (src.regionSize[1] + src.separation[1]) + src.regionSize[1];
          if (right > src.textureSize[0] || bottom > src.textureSize[1]) problems.push(`${at}: atlas ${t.atlas.join(",")} is outside the ${src.textureSize.join("x")} sheet`);
        }
      });
    }
    ts.terrainSets.forEach((set, si) => {
      const seen = new Set<string>();
      for (const t of set.terrains) {
        if (seen.has(t.name)) problems.push(`${where}.terrainSets[${si}]: duplicate terrain "${t.name}"`);
        seen.add(t.name);
      }
    });
  }
  for (const f of c.floors.all) {
    const where = `floors.json "${f.id}".arena`;
    const ts = f.arena.tileset ? c.tilesets.byId[f.arena.tileset] : undefined;
    if (f.arena.tileset && !ts) problems.push(`${where}.tileset: unknown tileset "${f.arena.tileset}"`);
    const g = f.arena.ground;
    if (!g) continue;
    if (!ts) {
      if (!f.arena.tileset) problems.push(`${where}.ground: a ground layout needs a tileset`);
      continue;
    }
    const set = ts.terrainSets[g.terrainSet];
    if (!set) {
      problems.push(`${where}.ground.terrainSet: tileset "${ts.id}" has no terrain set ${g.terrainSet}`);
      continue;
    }
    const names = new Set(set.terrains.map((x) => x.name));
    for (const n of [g.base, ...g.areas.map((a) => a.terrain)]) {
      if (!names.has(n)) problems.push(`${where}.ground: unknown terrain "${n}" in tileset "${ts.id}"`);
    }
  }
}
