/**
 * Import a Godot 4 TileSet (.tres) into packages/content/tilesets.json.
 *
 *   npm run import:tileset -- path/to/floor.tres [--id lobby] [--name "The Welcome Lobby"]
 *
 * The id defaults to the file name. Each atlas texture is copied to
 * packages/client/public/combat/floor/<id>.png (<id>_<source id>.png when there
 * are several). `res://` paths resolve from the folder holding project.godot,
 * found by walking up from the .tres. Re-importing replaces the tileset with
 * the same id; nothing else in tilesets.json changes.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TilesetSchema } from "../packages/engine/src/content/schemas";
import { readTres, tilesetFromTres, tresTextures, TresError, terrainId } from "../packages/engine/src/tiles/godot";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentFile = join(root, "packages/content/tilesets.json");
const floorArt = join(root, "packages/client/public/combat/floor");

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) fail(`${file} isn't a PNG (the board only draws PNGs)`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** `res://a/b.png` -> a real path: from the Godot project root if there is one, else next to the .tres. */
function resolveRes(path: string, tres: string): string {
  if (!path.startsWith("res://")) return resolve(dirname(tres), path);
  let dir = dirname(resolve(tres));
  for (;;) {
    if (existsSync(join(dir, "project.godot"))) return join(dir, path.slice("res://".length));
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return join(dirname(resolve(tres)), basename(path));
}

const file = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
if (!file) fail("usage: npm run import:tileset -- path/to/tileset.tres [--id <id>] [--name <name>]");
if (!existsSync(file)) fail(`${file} not found`);

const id = arg("id") ?? terrainId(basename(file, extname(file)), 0);
if (!/^[a-z0-9_]+$/.test(id)) fail(`--id "${id}" must be lowercase snake_case`);

try {
  const sections = readTres(readFileSync(file, "utf8"));
  const found = tresTextures(sections);
  const textures = new Map<number, { texture: string; size: [number, number] }>();
  for (const t of found) {
    const src = resolveRes(t.path, file);
    if (!existsSync(src)) {
      console.warn(`! source ${t.sourceId}: texture ${t.path} not found at ${src}`);
      continue;
    }
    const texture = found.length === 1 ? id : `${id}_${t.sourceId}`;
    copyFileSync(src, join(floorArt, `${texture}.png`));
    textures.set(t.sourceId, { texture, size: pngSize(src) });
  }
  const { tileset, warnings } = tilesetFromTres(sections, { id, name: arg("name") ?? id, textures });
  tileset.importedFrom = relative(root, resolve(file));
  const parsed = TilesetSchema.safeParse(tileset);
  if (!parsed.success) fail(`the converted tileset doesn't validate:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);

  const all = existsSync(contentFile) ? (JSON.parse(readFileSync(contentFile, "utf8")) as { id: string }[]) : [];
  const at = all.findIndex((t) => t.id === id);
  if (at >= 0) all[at] = tileset as { id: string };
  else all.push(tileset as { id: string });
  writeFileSync(contentFile, `${JSON.stringify(all, null, 2)}\n`);

  const sets = parsed.data.terrainSets.map((s, i) => `set ${i} (${s.mode}): ${s.terrains.map((t) => t.name).join(", ")}`);
  const tiles = parsed.data.sources.reduce((n, s) => n + s.tiles.length, 0);
  console.log(`${at >= 0 ? "replaced" : "added"} tileset "${id}": ${tiles} tiles from ${parsed.data.sources.length} source(s)`);
  for (const s of sets) console.log(`  ${s}`);
  for (const [n, t] of textures) console.log(`  source ${n} -> public/combat/floor/${t.texture}.png (${t.size.join("x")})`);
  for (const w of warnings) console.warn(`! ${w}`);
  console.log("Run `npm run validate` to check it against the floors that use it.");
} catch (e) {
  if (e instanceof TresError) fail(`${file}: ${e.message}`);
  throw e;
}
