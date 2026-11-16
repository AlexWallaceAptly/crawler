# Decisions

Assumptions made where [the spec](docs/SPEC.md) is silent or ambiguous. Newest milestone at the bottom.

## Milestone 0: Scaffold

- **Folder.** The project root is `crawler/`, matching the spec's folder layout. The spec itself lives at `docs/SPEC.md`.
- **Monorepo.** npm workspaces. Packages export their TypeScript source directly, with no build step between packages: Vite, Vitest and tsx all read `.ts`.
- **Versions.** TypeScript 7, Vite 8, Vitest 5, React 19, Zod 4, Hono 4.
- **Content wiring.** `@crawler/content/index.ts` imports every JSON file into one raw object, and the engine validates it in `loadContent()`. A new content *file* has to be added in two places: that index and `CONTENT_FILES` in `engine/src/content/load.ts`. New *entries* are JSON only.
- **Schemas are the source of truth.** TypeScript types are inferred from the Zod schemas (`z.infer`), so the spec's types aren't written out twice.
- **"Fails loudly"** works at three levels:
  - `npm run dev` runs `npm run validate` first and won't start if any file fails.
  - The server re-validates on every content edit (because of `tsx watch`) and prints the errors.
  - The client shows a full-screen list of the problems.
  
  Objects are strict, so a typo'd key is an error. Cross-references (skill and item ids) and duplicate ids are checked too. All problems are reported together, not just the first. A JSON syntax error fails with the file and line.
- **Server.** `/api/boss` returns 501 until Milestone 10. `.env` is loaded from the repo root with `process.loadEnvFile`.

## Milestone 1: Engine core

- **Check outcomes:**
  - Success means `total >= DC`.
  - Critical success means a success that also beats the DC by 10 or more. Critical failure means a failure that also misses by 10 or more.
  - A natural 20 always succeeds, but it's only a crit if the margin is also +10. A natural 1 always fails, but it's only a crit failure if the margin is also -10 or worse.
- **Opposed checks** ignore natural 1s and 20s and compare totals. Ties go to the defender, per the spec.
- **RNG.** `rng.ts` holds a swappable `[0,1)` source plus a `forceDice()` queue so tests can script exact die results. Every die roll goes through `die()`.
- **Reducer signature.** It's `step(world, action) -> { world, events }`, where `World = { game, account }`. Some actions change the account (rerolls, deaths), so the reducer sees both. They're still saved under separate `localStorage` keys.
- **State is plain JSON.** It's cloned with `JSON.parse(JSON.stringify())` at the start of each step, and the input world is never mutated (a test checks this).
- **The event log lives in `GameState`** (last 300 events), so a reload restores the panels exactly.
- **Free actions.** `help` and unknown commands don't advance the turn. Unknown commands get a System AI reply.

## Milestone 2: Character creation and UI shell

- **Backstory extras.** The crawler has a name, an age (from the occupation's `ageRange`) and a hometown, from `backstory/names.json`. Formative events, quirks and locations each have a `phrase` that slots into the roast sentence.
- **Quirk stat mods** are applied during stat generation, before the 3..12 clamp, as the spec's pseudocode says. They're baked into base stats.
- **Passive modifiers.** A generic `Modifier { to, value }` model covers quirks, item bases, statuses and skill perks. A roll sums every modifier whose `to` matches one of its tags. Examples: `skill:stealth`, `stat:DEX`, `attack:thrown`, `damage:blunt`, `flee`, `defense`, `dr`, `resist:poison`. The `perk:*` tags are flags for the rules to check later.
- **Starting kit equip order.** Clothing goes on first, then the occupation item. If the main hand already holds a weapon, the location weapon goes in the pack. Bases marked `generate: false` are starting-kit only and never drop as loot.
- **Rings.** The item slot `ring` maps to equipment slots `ring1` and `ring2`.
- **Rerolls.** A new account starts with 0. Rerolls are an account unlock, per the spec.
- **Ending a run.** `abandon` asks for confirmation, and `abandon confirm` ends the run as a death with cause `quit`. `new` starts the next crawler. Legacy points arrive in Milestone 8.
- **Old saves.** If the save version doesn't match, the run save is discarded but the account is kept.
- **Restoring MP** is written as `{ kind: "heal", flag: "mp" }`, because the spec's effect kinds have no `mana`.
- **Narrator memory** stores template variant ids (`key#index`) rather than rendered text, so a variant with different `{pick:}` results still counts as a repeat. If a template has only conditional variants and none match, any variant can be used. A missing template prints a visible placeholder instead of crashing.
- **Panels never read raw state.** The engine exposes `view(world)`, a UI projection. Log panels get events through `client/src/router.ts`.
- **Client-only commands:**
  - `i` or `inventory` toggles the inventory overlay, and `Esc` closes it.
  - `wipe save` deletes the run *and* the account, after a confirm dialog. It's a development convenience.
- **Status bar.** It shows `PRE-SHOW` until a floor exists.

## Content: spreadsheet import (backstory and item tables)

- **Source.** The backstory, item base and consumable tables came from a spreadsheet (`content-csv/dcc_game_data.xlsx`). Values that didn't fit the engine's vocabulary were mapped on import rather than rejected:
  - Damage types `electric` became `lightning`, `cold` became `frost` and `holy` became `light`. The modifier `resist:cold` became `resist:frost` so it still matches frost damage.
  - Mana restores written as `stat: "mp"` became `flag: "mp"`, per the Milestone 2 convention.
  - Weapon attack stat `CHA` became `DEX`, because the spec's attack roll only uses STR or DEX. This affects the inflatable tube man and the tour group flag.
  - Clothing worn on the hands (gloves, mittens, corsage, arm floaties, foam finger, arm sling) moved from `offHand` to `hands`, so it doesn't block shields or two-handed weapons.
- **`cure` effect kind.** The spec lists cure potions but its effect kinds have no way to remove a status. `{ kind: "cure", statusId }` removes that status, and a cure without a `statusId` fails validation.
- **New statuses.** `confused` (flag `randomTarget`) and `invisible` (flags `untargetable` and `breaksOnAttack`) extend the spec's starter set of 11, because the consumables use them. Combat (Milestone 4) must implement these flags.
- **Names.** Duplicate names are removed, so each name has the same chance of being picked. First names that belong to characters in the books (Carl, Odette, Yolanda, Imani) are removed, per the originality rule.
- **Stat-range test.** At starter-table sizes the full occupation × event × quirk set is millions of combinations. The test now pairs every occupation with every event and cycles through the quirks.
- **Eyes slot.** Added an `eyes` equipment slot, separate from `head`, so goggles, glasses, masks and eye patches can be worn with a hat or helmet. Full-face gear (welding helmet, racing helmet, mascot head, sheet face mask) stays in `head`. SPEC.md's slot list is updated to match. Old saves still load, because equipment is a partial record.

## Milestone 3: Undercroft writing ingested

- The Floor 1 text was authored by Alex and delivered as JSON (`floors.undercroft.json`, `narration.m3.json`); ingested verbatim, 305 lines total vs the 245 estimated.
- `floors.json` is a table of floor themes (`id`, `name`, `floor`, `roomNames`, `fragments`, `typeLines`) so Floor 2/3 themes are new array entries, not new files.
- Room shapes are a fixed trio (`corridor`/`chamber`/`small`): both name nouns and opening lines are keyed by shape, enforced by a strict object rather than a free record so a typo'd shape fails validation.
- `typeLines` covers exactly the six special room types (`stairwell`, `safe`, `treasure`, `puzzle`, `npc`, `empty`), each defaulting to an empty array — a theme may omit lines for a type and the describer just skips the closing line.
- New narration keys: `explore.interjection`, `timer.warn24h/6h/1h/10m`, `explore.searchNothing`, `explore.rest`, `explore.sleep`, `explore.blocked`, `explore.sleepRefused`, `explore.descendRefused`, `explore.revisit`, `died.collapse`, `floor.cleared`. Collapse death gets its own `died.collapse` key rather than a `when` clause on `died`, since it fires from the timer, not combat.

## Milestone 3: floor generation and exploration

- Grid is 12×9 (108 cells) for 60 rooms — ~55% density reads as tunnels with real dead ends; the spec's 14×10/120 example is denser than plays well. Grid size, room count and timer days live on the theme in `floors.json`.
- Carving is a branching random walk: 22% of steps (or any dead end) jump the cursor to a random carved room, which is what creates branches. Loops connect an extra 10–15% of adjacent unlinked pairs. Connectivity holds by construction; the 100-floor test re-proves it with BFS anyway.
- Stairwells (3–5) are placed greedily at the point maximizing min(distance from start, distance from other stairwells). Safe rooms are 1 per 15 rooms; the first is the tutorial one, forced 4–8 steps from the start; none may sit adjacent to a stairwell (spec).
- The start room is forced corridor/empty so turn one is never an ambush.
- Room types stay hidden from the player except safe rooms and stairwells, which get badges in the room header and status bar; lair/trap/event rooms generate now but behave as flavor until M4/M7.
- Descriptions are opening (by shape) + one sight + one sound *or* smell (50/50) + a type line if the theme has one; cached on the room at first entry so revisits read the same (spec).
- Revisits print the room name and exits only, plus a `explore.revisit` jab 30% of the time; first visits get an `explore.interjection` 10% of the time.
- `look` and `map` are free; move 10m, search 15m, rest 1h, sleep 8h per spec. Rest heals 25% of max HP/MP (spec leaves it open); sleep fully heals but only in safe rooms. Search finds nothing until the M5 loot tables — it still spends the 15 minutes, which is the joke.
- All time flows through `advanceTime()`: warnings fire once per threshold (tracked in `floor.warned`), and at zero anyone off a stairwell dies (`died.collapse`, counts as a death) while anyone on one is auto-descended (floor cleared, not a death).
- `descend` ends the run as a win until Floor 2 exists: `floorCleared` event, bestFloor=2, phase → dead so `new` works; `deaths` is not incremented.
- SAVE_VERSION bumped to 2 (GameState grew `floor`); v1 saves are discarded per the existing policy.

## Milestone 4: Combat

- Floor 1 encounter odds are first-entry 35% in chambers, 8% in corridors, guaranteed elite encounters in lairs, and 15% in event/NPC/puzzle rooms; revisit odds are lower. Safe rooms and stairwells do not spawn encounters. This makes lairs legible high-risk content while keeping ordinary exploration uncertain.
- Combat groups use one randomly selected floor family. Mobs use that family's group-size range; an elite lair encounter has one elite and a 40% chance of one or two supporting mobs. Enemy levels are `floor * 4 + random(-1, 2)`, with family stats shifted from the floor baseline.
- Initiative ties go to the crawler. Enemies above the crawler act before the crawler at the start of each round; the rest act after. The initiative order stays fixed. Combat rounds cost one game minute.
- Enemy damage adds `floor(stat / 4)` rather than the crawler's `floor(stat / 2)` so early crawlers retain a damage edge against groups. Enemy damage still respects crawler damage-reduction and damage-type resistance modifiers.
- A close-range attack can spend a minor action to close one band. If the enemy remains out of reach, the attempt still ends the turn so the fight cannot deadlock at near range. `Hasted` permits two movement minor actions per round; `Slowed` permits none.
- Status duration is counted after the affected combatant gets its first turn. Newly applied statuses keep their full duration through the round in which they land. Travel still ticks and expires statuses once per room moved.
- Talkable enemies use a medium CHA + Persuasion check; success pacifies them and awards half XP. A successful flee leaves combat without XP; failure gives each living enemy a free attack. Fled enemies do not award XP.
- Enemy mods are selected without replacement and baked into their spawned state. The first combat content set has seven Floor 1 families and a small mod table; broader family coverage and balance tuning are deferred to Milestone 13.
- `scripts/sim.ts` runs a headless Floor 1 policy. Its outcomes vary with `Math.random`; it is a reachability/playability check, not a seeded balance benchmark.
- Local M4 acceptance passed: scripted suite and typecheck are clean; a 500-run Floor 1 simulation produced both stair clears and deaths with zero stuck runs. The observed clear rate is a balance snapshot, not a target for this milestone.

## Minimap tiles

- The minimap now renders from `view.mapGrid` (structured cells from `mapGrid()` in `explore.ts`) as PNG tiles in `packages/client/public/tiles/<kind>.png`. `view.minimap` (ASCII) is kept for the `map` command and as the fallback when no grid exists. A tile whose PNG is missing falls back to an ASCII glyph, so art can land incrementally.
- Spoiler rule: a room's true type is shown only once visited. Seen-but-unvisited rooms use the `unknown` tile (the ASCII map already hid everything but `?`). The player marker is a `player.png` overlay on the current room. Room connectors are CSS bars, not images.
- Tile URLs use `import.meta.env.BASE_URL` so the GitHub Pages `/crawler/` base works. `trap-sprung.png` is optional and falls back to `trap.png`.

## Milestone 4b: grid combat, mob packs, junk and crafting

Inserted before Milestone 5 at the player's request (see the build-order row in SPEC.md). Built on the `grid-combat-crafting` branch.

### Combat refactor and fixes

- **Two combat modes, one rulebook.** `combat.ts` keeps every roll shared: `resolvePlayerHit`, `enemyDefense`, `enemyStrike`, `fleeContest`, `freeSwings`, `applyItemEffects` and `damageCrawler`. "bands" is the original model, and "grid" is the tactical arena. The mode is stored on `CombatState` when the fight starts, so changing the setting mid-fight only affects the next one.
- **The toggle** lives on the account (`account.settings.combatMode`), so it outlives a crawler. The field is optional, so older accounts still load without an `ACCOUNT_VERSION` bump. `set combat grid|bands` is a free action allowed in any phase, and like `help` it doesn't advance the turn counter.
- **Fleeing goes back where you came from.** `startCombat` used to record `fromRoom` after `enterRoom` had already moved the crawler, so a "clean getaway" left you standing in the ambush room. The `go` handler now passes the previous room through `travel()` → `maybeEncounter()` → `startCombat()`.
- **Items hit what they're aimed at.** Effects with `target: "target"` hit the first targetable enemy (bands) and `all_enemies` hit every enemy. Untargeted, `self` and `all_allies` effects hit the crawler. Pepper spray no longer blinds the user.
  - Out of combat, an item whose every effect needs an enemy is refused and not consumed.
  - Items with no effects ("junk" parts) are refused with a hint to combine them.
  - `heal` with `flag: "mp"` restores MP, `loot` with `flag: "gold"` adds gold, and `xp` adds XP.
  - `stat` buffs still wait for Milestone 5.
- **The turn start is idempotent.** `beginTurn()` (formerly `playerTurnStart`) sets `combat.turnBegun`, which resets at the end of the round. A command rejected after the start (e.g. an untargetable target) no longer ticks poison a second time when the player tries again.
- **A failed flee keeps the turn order.** Free swings replace the slower enemies' turns as before, but the round now closes through `closeRound()`, so faster enemies still open the next round.
- **Minor-action buttons read status flags** (`noMinor`, `extraMinor`) instead of the ids `slowed`/`hasted`.
- **Duct tape** is tagged `bind` (a crafting part), not `healing`. The heal button and the sim no longer burn it as a potion; it still heals 1d4 if used directly.
- **Crafted weapons** can carry `onHit` (a status with a chance), which `resolvePlayerHit` applies on any hit that doesn't kill.
- `SAVE_VERSION` is 4: `CombatState` gained `mode` and `turnBegun`. Version-3 run saves are discarded and accounts are kept.
