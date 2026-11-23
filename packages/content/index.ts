/**
 * Raw content index. Each key is the file's path under packages/content.
 * The engine validates all of it with Zod in loadContent(); this file only imports.
 * Adding a new content FILE means adding it here and in the engine's CONTENT_FILES.
 */
import skills from "./skills.json";
import statusEffects from "./statusEffects.json";
import narration from "./narration.json";
import floors from "./floors.json";
import enemies from "./enemies.json";
import enemyMods from "./enemyMods.json";
import occupations from "./backstory/occupations.json";
import backstoryEvents from "./backstory/events.json";
import quirks from "./backstory/quirks.json";
import locations from "./backstory/locations.json";
import names from "./backstory/names.json";
import bases from "./items/bases.json";
import consumables from "./items/consumables.json";
import arenaFeatures from "./arenaFeatures.json";
import lootTables from "./lootTables.json";
import recipes from "./recipes.json";
import craftParts from "./craftParts.json";
import thread from "./thread.json";
import shards from "./shards.json";
import modules from "./modules.json";
import temper from "./temper.json";
import codex from "./codex.json";
import bosses from "./bosses.json";
import oddities from "./items/oddities.json";
import materials from "./items/materials.json";
import rarities from "./items/rarities.json";
import rarityWeights from "./items/rarityWeights.json";
import affixes from "./items/affixes.json";
import legendaryPowers from "./items/legendaryPowers.json";
import tilesets from "./tilesets.json";

export const rawContent = {
  "skills.json": skills,
  "statusEffects.json": statusEffects,
  "narration.json": narration,
  "floors.json": floors,
  "enemies.json": enemies,
  "enemyMods.json": enemyMods,
  "backstory/occupations.json": occupations,
  "backstory/events.json": backstoryEvents,
  "backstory/quirks.json": quirks,
  "backstory/locations.json": locations,
  "backstory/names.json": names,
  "items/bases.json": bases,
  "items/consumables.json": consumables,
  "arenaFeatures.json": arenaFeatures,
  "lootTables.json": lootTables,
  "recipes.json": recipes,
  "craftParts.json": craftParts,
  "thread.json": thread,
  "shards.json": shards,
  "modules.json": modules,
  "temper.json": temper,
  "codex.json": codex,
  "bosses.json": bosses,
  "items/oddities.json": oddities,
  "items/materials.json": materials,
  "items/rarities.json": rarities,
  "items/rarityWeights.json": rarityWeights,
  "items/affixes.json": affixes,
  "items/legendaryPowers.json": legendaryPowers,
  "tilesets.json": tilesets,
} satisfies Record<string, unknown>;
