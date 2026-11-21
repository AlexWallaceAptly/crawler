/**
 * Validates every JSON file in packages/content against the engine's Zod schemas.
 * Runs before `npm run dev` and `npm run build`; a bad file stops startup with a readable error.
 */
import { ContentError, loadDefaultContent } from "@crawler/engine";

try {
  const c = loadDefaultContent();
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
