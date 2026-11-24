# Crawler

A browser text adventure (TypeScript monorepo). The source of truth is `docs/DESIGN.md`. Build in that file's milestone order, and log every assumption in its Decision log (the last section) instead of asking. Story content (shards, Echo's reactions, modules, the Codex, hand-written items) and the spells (their words and simple numbers, and the school perks' names) come from the workbook linked at the top of `docs/DESIGN.md`.

## Commands

- `npm run dev`: validates content, then starts Vite on :5173 and the Hono server on :8787 (Vite proxies `/api`).
- `npm run check`: validates content, typechecks and runs the tests. Run it before calling a milestone done.
- `npm test`: runs Vitest (tests are in `packages/*/test`).
- `npm run validate`: checks only the JSON content.
- `npm run import:workbook`: re-imports the workbook's text columns from the CSV exports in `content-csv/workbook/` into the thread JSON files, and the Spells and Spell Schools sheets into `spells.json` and the magic skills in `skills.json`. Engine-only fields in the JSON are kept.
- `npm run import:tileset -- <file.tres> [--id <id>]`: imports a Godot 4 TileSet into `packages/content/tilesets.json` and copies its textures to `packages/client/public/combat/floor/`. The Godot project for tilesets is `sprites/tilesets/`; `npm run validate` fails if an imported tileset no longer matches its `.tres`.
- `npm run sim`: headless auto-play balance tool. `--floors 3 --craft` is the usual run; `--offsets 0,-2,-3` tries other enemy levels per floor. `--bot all` runs the four explorers (balanced, sweeper, greedy, scout) and adds a pacing report (rooms searched, day of descent, where the minutes went, sleep states, sweep cost). `--chain 10` plays careers of 10 crawlers on one account (bequests and unlocks carry over) and reports legacy points and unlocks by run; use it with `--floors 3`.

## Layout

- `packages/engine`: pure game logic with no DOM, React or `fetch`. All randomness goes through `src/rng.ts`. The reducer is `step()` in `src/step.ts`, and the UI projection is `src/view.ts`. The story layer is `src/echo.ts` (Echo, Temper, shards, Codex), `src/modules.ts` (Echo's modules) and `src/boss.ts` (floor bosses and their weaknesses). Items: `src/gen/item.ts` (the generator: base + material + rarity + affixes), `src/gear.ts` (the swing math and what equipping changes, shared by combat and the panels, including weapon-skill perks) and `src/itemInfo.ts` (item details). Progression is `src/progression.ts`: the XP and skill curves, level-ups and stat points (`raise`), and skill XP from use (`trainSkill`). Magic is `src/spells.ts`: casting (a cast is a swing with INT and the school's skill), spell levels, tomes and scrolls, and what the panels show. The board's floor art is `src/tiles/`: a Godot-style terrain autotiler (`tileset.ts`), the looks-only ground layout (`ground.ts`) and the `.tres` reader (`godot.ts`).
- Floor pacing (Milestone 6c): `packages/content/pacing.json` holds every number (time costs, sleep stages, safe-room rules, scouting, hazards, wandering, show events). `src/roomwork.ts` is scouting, search passes and wandering, `src/showEvents.ts` the scheduled events, `src/guide.ts` and `src/guideActions.ts` the Game Guide and meals, `src/gen/roomstate.ts` the per-room memory seeded at generation, and `src/rules/sleep.ts` sleep deprivation.
- Rewards (Milestone 7): `src/achievements.ts` (the trigger engine, run once at the end of `step()`), `src/counters.ts` (events become counters), `src/boxes.ts` (loot boxes, safe rooms only), `src/shop.ts` and `src/economy.ts` (gold and shops), `src/mood.ts` (the System AI's mood). `achievements.json`, `boxes.json` and `shops.json` hold the data; the workbook's optional `Achievements.csv` owns the achievements.
- Death and the account (Milestone 8): `src/legacy.ts` (how a run ends, legacy points, the bequest, unlocks and starting kits) and `src/accountCodex.ts` (the old codex: the bestiary, items and achievements ever found). `unlocks.json` holds the unlocks; a backstory entry with a `pool` only rolls once that pool's unlock is bought. `killCrawler` takes how the crawler died (`DeathHow`), and the run is paid out at the end of `step()`, after the death's own achievements.
- `packages/content`: the JSON tables. `index.ts` imports each file, and the engine's `CONTENT_FILES` maps each file to its Zod schema.
- `packages/client`: Vite + React terminal UI. Panels render from `engine.view()` and routed events, never from raw state.
- `packages/server`: Hono. It will proxy `/api/boss` to Claude in Milestone 10.
- `content-csv/workbook/`: CSV exports of the workbook (live). `Achievements.csv` is imported; `Achievements (pending).csv` is not: it holds achievements that need an event, counter or system the engine doesn't have yet, each with a **Needs** and an **Enable at** column. When you start a milestone, read the pending sheet for rows tagged with it, build what they need, then move them across (steps in `docs/DESIGN.md`, Milestone 7 → "Achievements waiting on other work"). `content-csv/archive/`: old one-time import sources, kept for the record.

## Rules

- Content is data. A new entry is a JSON edit. A new content file needs both `content/index.ts` and `CONTENT_FILES` updated.
- All game text is original. Never use names, characters or lines from the books. Tone: crude, bored, cruel, funny, with real dread underneath. Echo is the exception: anxious and sincere, and its speech follows the act (see "Echo's voice" in the design doc).
- The engine state must stay JSON-serializable, because it's cloned and saved to `localStorage` every step.
