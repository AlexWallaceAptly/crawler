/**
 * Raw content index. Each key is the file's path under packages/content.
 * The engine validates all of it with Zod in loadContent(); this file only imports.
 * Adding a new content FILE means adding it here and in the engine's CONTENT_FILES.
 */
import skills from "./skills.json";
import statusEffects from "./statusEffects.json";
import narration from "./narration.json";
import floors from "./floors.json";
import occupations from "./backstory/occupations.json";
import backstoryEvents from "./backstory/events.json";
import quirks from "./backstory/quirks.json";
import locations from "./backstory/locations.json";
import names from "./backstory/names.json";
import bases from "./items/bases.json";
import consumables from "./items/consumables.json";

export const rawContent = {
  "skills.json": skills,
  "statusEffects.json": statusEffects,
  "narration.json": narration,
  "floors.json": floors,
  "backstory/occupations.json": occupations,
  "backstory/events.json": backstoryEvents,
  "backstory/quirks.json": quirks,
  "backstory/locations.json": locations,
  "backstory/names.json": names,
  "items/bases.json": bases,
  "items/consumables.json": consumables,
} satisfies Record<string, unknown>;
