/**
 * Import the workbook ("DCC Text Adventure: Stray and the Mother Below") into the thread JSON.
 *
 *   npm run import:workbook [-- <dir>]      (default dir: content-csv/workbook)
 *
 * Export each sheet from the workbook page as CSV into that folder, named after the sheet
 * (Thread.csv, Floor Arc.csv, Shards.csv, Modules.csv, Temper.csv, Codex.csv, Items.csv).
 *
 * The workbook owns the words. The JSON owns the engine fields (module parts and effects,
 * boss gates, Codex line lists, item stats, delivery chances...), so those are kept from
 * the existing files. Entries that exist only in the JSON (draft Codex recipes) are kept too.
 * Run `npm run validate` afterwards.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, process.argv[2] ?? "content-csv/workbook");
const contentDir = join(root, "packages/content");

// ---------------------------------------------------------------- csv

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

type Row = Record<string, string>;

function sheet(name: string): Row[] {
  const file = join(dir, `${name}.csv`);
  if (!existsSync(file)) throw new Error(`missing ${file} (export the "${name}" sheet as CSV)`);
  const [header, ...rows] = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
  if (!header) throw new Error(`${name}.csv is empty`);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** A column by header name; the sheets' first header is sometimes a scratch note, so allow a position. */
function col(row: Row, name: string, position?: number): string {
  if (name in row) return row[name]!;
  if (position !== undefined) return Object.values(row)[position] ?? "";
  throw new Error(`no column "${name}" in ${JSON.stringify(Object.keys(row))}`);
}

// ---------------------------------------------------------------- helpers

export function slug(name: string): string {
  return name.toLowerCase().replace(/^the /, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function readJson<T>(file: string, fallback: T): T {
  const path = join(contentDir, file);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

function writeJson(file: string, data: unknown): void {
  writeFileSync(join(contentDir, file), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`  wrote packages/content/${file}`);
}

/** Keep JSON-only entries, in their old order, after the workbook's. */
function mergeById<T extends { id: string }>(fromSheet: T[], existing: T[]): T[] {
  const seen = new Set(fromSheet.map((e) => e.id));
  return [...fromSheet, ...existing.filter((e) => !seen.has(e.id))];
}

type Json = Record<string, unknown>;

// ---------------------------------------------------------------- shards

function importShards(): Json[] {
  const old = new Map(readJson<Json[]>("shards.json", []).map((x) => [x.id as string, x]));
  return sheet("Shards").map((r) => {
    const id = col(r, "ID");
    const reaction = col(r, "Echo's reaction");
    const split = /^CALM:\s*(.+?)\s*FED:\s*(.+)$/s.exec(reaction);
    const delivery = col(r, "Delivery") === "Boss throwaway" ? "boss" : "room";
    // Source (the thing that speaks) is a newer column: keep the JSON's until the sheet has one.
    const source = r["Source"] || (old.get(id)?.source as string | undefined);
    return {
      id,
      floor: Number(col(r, "Floor")),
      clue: col(r, "Clue text"),
      delivery,
      strand: col(r, "Strand"),
      ...(delivery === "room" && source ? { source } : {}),
      ...(split ? { reactionCalm: split[1], reactionFed: split[2] } : { reaction }),
    };
  });
}

// ---------------------------------------------------------------- modules

function importModules(): Json[] {
  const old = new Map(readJson<Json[]>("modules.json", []).map((m) => [m.id as string, m]));
  return sheet("Modules").map((r) => {
    const id = col(r, "ID");
    const prev = old.get(id) ?? {};
    return {
      id,
      name: col(r, "Module"),
      unlockedBy: col(r, "Unlocked by"),
      partsText: col(r, "Parts"),
      parts: prev.parts ?? [],
      base: col(r, "Base effect"),
      calm: col(r, "Calm variant"),
      fed: col(r, "Fed variant"),
      ...(prev.effects ? { effects: prev.effects } : {}),
      ...(prev.minutes ? { minutes: prev.minutes } : {}),
    };
  });
}

// ---------------------------------------------------------------- thread (Thread + Floor Arc)

function importThread(): Json {
  const old = readJson<Json>("thread.json", {});
  const oldFloors = new Map(((old.floors as Json[] | undefined) ?? []).map((f) => [f.floor as number, f]));
  const threads = sheet("Thread").map((r) => {
    const name = col(r, "Strand", 0);
    return { id: slug(name), name, codename: col(r, "Codename"), premise: col(r, "Premise"), reveal: col(r, "Final reveal"), status: col(r, "Status") };
  });
  const floors = sheet("Floor Arc").map((r) => {
    const floor = Number(col(r, "Floor"));
    const act = col(r, "Act");
    return {
      floor,
      theme: col(r, "Theme (placeholder)", 1),
      boss: slug(col(r, "Boss (placeholder)", 2)),
      beat: col(r, "Thread beat"),
      act: act === "Finale" ? 4 : Number(act.replace(/\D/g, "")),
      voice: col(r, "Echo voice"),
      jointMouth: col(r, "Joint-mouth"),
      wholenessAfter: parsePercent(col(r, "Wholeness")),
      bossGate: oldFloors.get(floor)?.bossGate ?? (floor === 13 ? "finale" : floor <= 4 ? "none" : "obviousStairs"),
    };
  });
  return { ...old, threads, floors };
}

function parsePercent(v: string): number {
  const n = Number(v.replace("%", ""));
  // Sheets exports "8%"; a raw number export gives 0.08.
  return v.includes("%") || n > 1 ? n : Math.round(n * 100);
}

// ---------------------------------------------------------------- temper

function importTemper(): Json {
  const old = readJson<Json>("temper.json", {});
  const stages = sheet("Temper").map((r, i) => ({
    id: slug(col(r, "Stage")),
    name: col(r, "Stage"),
    act: i + 1,
    wholeness: col(r, "Wholeness"),
    voice: col(r, "Echo's voice"),
    calm: col(r, "Calm side"),
    fed: col(r, "Fed side"),
    mechanics: col(r, "Mechanics"),
  }));
  return { ...old, stages };
}

// ---------------------------------------------------------------- codex

/** Default line lists for lore entries: their strand's shards, with the Host and the Harvest split out. */
const LORE_LINES: Record<string, (s: Json) => boolean> = {
  "The Cut": (s) => s.strand === "The Cut" && s.id !== "S45",
  "The Mother Below": (s) => s.strand === "The Mother Below",
  "Echo (Asset 7)": (s) => s.strand === "Echo's Past" && s.id !== "S41" && s.id !== "S44",
  Rue: (s) => s.strand === "Previous Carriers",
  "The Host": (s) => s.id === "S41" || s.id === "S44",
  "The Harvest": (s) => s.id === "S45",
};

function importCodex(shards: Json[], bossIds: Map<string, string>): Json[] {
  const existing = readJson<Json[]>("codex.json", []);
  const old = new Map(existing.map((e) => [e.id as string, e]));
  const fromSheet = sheet("Codex").map((r) => {
    const typeText = col(r, "Type");
    const name = col(r, "Entry");
    const type = typeText === "Boss weakness" ? "weakness" : typeText.toLowerCase();
    const id = `${type}_${slug(name)}`;
    const unlockText = col(r, "Unlock");
    let unlock: Json;
    if (type === "lore") unlock = { shards: unlockText.match(/S\d{2}/g) ?? [] };
    else if (type === "recipe") unlock = { module: /M\d{2}/.exec(unlockText)?.[0] ?? "" };
    else if (type === "weakness") unlock = { boss: bossIds.get(name) ?? slug(name) };
    else unlock = { ending: slug(name) };
    const prev = old.get(id);
    const lines = (prev?.lines as string[] | undefined)
      ?? (type === "lore" ? shards.filter(LORE_LINES[name] ?? (() => false)).map((s) => s.id as string) : []);
    return { id, type, name, text: col(r, "Text"), unlockText, floorText: col(r, "Floor"), unlock, lines };
  });
  return mergeById(fromSheet as Json[] & { id: string }[], existing as Json[] & { id: string }[]);
}

// ---------------------------------------------------------------- items (oddities)

const RARITY: Record<string, string> = { Common: "common", Uncommon: "uncommon", Rare: "rare", Unique: "legendary" };

function defaultItem(type: string, id: string, name: string, description: string, rarity: string): Json {
  const value = { common: 4, uncommon: 12, rare: 30, legendary: 60 }[rarity] ?? 5;
  if (type === "Weapon") {
    return { gear: { id, name, slot: "mainHand", weaponType: "improvised", power: [2, 4, 6], stat: "STR", weight: 2, value, generate: false, tags: ["oddity"], flavor: description } };
  }
  if (type === "Armor" || type === "Trinket") {
    return { gear: { id, name, slot: type === "Armor" ? "chest" : "neck", ...(type === "Armor" ? { armor: 1 } : {}), weight: 1, value, generate: false, tags: ["oddity"], flavor: description } };
  }
  return { consumable: { id, name, type: type === "Consumable" ? "food" : "junk", text: description, effects: [], weight: 0.5, value, generate: false, tags: ["oddity"] } };
}

function importItems(): Json[] {
  const existing = readJson<Json[]>("items/oddities.json", []);
  const old = new Map(existing.map((e) => [e.ref as string, e]));
  return sheet("Items").map((r) => {
    const ref = col(r, "ID");
    const name = col(r, "Item");
    const description = col(r, "Unhinged description");
    const type = col(r, "Type");
    const rarity = RARITY[col(r, "Rarity")] ?? "common";
    const prev = old.get(ref);
    const id = (prev?.id as string | undefined) ?? slug(name);
    const [lo, hi] = col(r, "Floors").replace(/F/g, "").split("-").map(Number);
    const item = prev?.gear || prev?.consumable ? { ...(prev.gear ? { gear: prev.gear } : { consumable: prev.consumable }) } : defaultItem(type, id, name, description, rarity);
    // The workbook owns the words on the item too.
    if (item.gear) Object.assign(item.gear as Json, { id, name, flavor: description });
    if (item.consumable) Object.assign(item.consumable as Json, { id, name, text: description });
    const keep = (k: string) => (prev && prev[k] !== undefined ? { [k]: prev[k] } : {});
    return {
      id, ref, name, description, type,
      rarityText: col(r, "Rarity"),
      effectText: col(r, "Effect"),
      threadTie: col(r, "Thread tie-in"),
      floors: [lo, hi ?? lo],
      ...keep("hintFor"), ...keep("temperPerFloor"), ...keep("temperOnHit"),
      ...item,
    };
  });
}

// ---------------------------------------------------------------- run

console.log(`Importing the workbook from ${dir}`);
const shards = importShards();
const thread = importThread();
const bossIds = new Map((thread.floors as Json[]).map((f, i) => [sheet("Floor Arc")[i]!["Boss (placeholder)"]!, f.boss as string]));
writeJson("shards.json", shards);
writeJson("modules.json", importModules());
writeJson("thread.json", thread);
writeJson("temper.json", importTemper());
writeJson("codex.json", importCodex(shards, bossIds));
writeJson("items/oddities.json", importItems());
console.log("Done. Run `npm run validate` to check the result.");
