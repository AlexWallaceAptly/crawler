/**
 * Validates every JSON file in packages/content against the engine's Zod schemas.
 * Runs before `npm run dev` and `npm run build`; a bad file stops startup with a readable error.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentError, loadDefaultContent } from "@crawler/engine";
import type { Content } from "../packages/engine/src/content/load";
import { TilesetSchema } from "../packages/engine/src/content/schemas";
import { readTres, tilesetFromTres } from "../packages/engine/src/tiles/godot";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Tilesets imported from Godot must still match their .tres, or an edit in Godot silently never reaches the game. */
function staleTilesets(c: Content): string[] {
  const problems: string[] = [];
  for (const ts of c.tilesets.all) {
    if (!ts.importedFrom) continue;
    const file = join(root, ts.importedFrom);
    const fix = `run \`npm run import:tileset -- ${ts.importedFrom} --id ${ts.id}\``;
    if (!existsSync(file)) {
      problems.push(`tilesets.json "${ts.id}": its Godot source ${ts.importedFrom} is missing`);
      continue;
    }
    const textures = new Map(ts.sources.filter((s) => s.kind === "atlas").map((s) => [s.id, { texture: s.texture!, size: s.textureSize! }]));
    const { tileset } = tilesetFromTres(readTres(readFileSync(file, "utf8")), { id: ts.id, name: ts.name, textures });
    const again = TilesetSchema.parse({ ...tileset, importedFrom: ts.importedFrom });
    if (JSON.stringify(again) !== JSON.stringify(ts)) problems.push(`tilesets.json "${ts.id}" is out of date with ${ts.importedFrom}: ${fix}`);
  }
  return problems;
}

try {
  const c = loadDefaultContent();
  const stale = staleTilesets(c);
  if (stale.length) throw new ContentError(stale);
  const counts = [
    `${c.backstory.occupations.all.length} occupations`,
    `${c.backstory.events.all.length} events`,
    `${c.backstory.quirks.all.length} quirks`,
    `${c.backstory.locations.all.length} locations`,
    `${c.skills.all.length} skills`,
    `${c.items.bases.all.length} item bases`,
    `${c.items.consumables.all.length} consumables`,
    `${c.statusEffects.all.length} statuses`,
    `${Object.keys(c.narration).length} narration keys`,
    `${c.floors.all.length} floors`,
    `${c.tilesets.all.length} tilesets`,
    `thread: ${c.shards.all.length} shards, ${c.modules.all.length} modules, ${c.codex.all.length} codex entries, ${c.bosses.all.length} bosses, ${c.oddities.all.length} oddities`,
  ];
  console.log(`✓ content OK — ${counts.join(", ")}`);
} catch (err) {
  if (err instanceof ContentError) {
    console.error(`\n\x1b[31m${err.message}\x1b[0m\n`);
  } else {
    console.error("\n\x1b[31mContent failed to load:\x1b[0m", err instanceof Error ? err.message : err, "\n");
  }
  process.exit(1);
}
