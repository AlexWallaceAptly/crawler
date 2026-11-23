# Crawler: Design

Nov 20, 2026 · @Alex Wallace

This is the one design document for Crawler. It merges the old game spec (`docs/SPEC.md`), the decision log (`DECISIONS.md`) and the story design doc ("DCC Text Adventure: Design Doc for Claude Code"). The story content itself (shard text, Echo's reactions, module and Codex text, the hand-written items) lives in the workbook [DCC Text Adventure: Stray and the Mother Below](https://claude.ai/artifact/AN3MCWefESxiKNaoKLb5y8). That workbook is exported to `content-csv/workbook/*.csv` and imported into `packages/content/*.json` by `npm run import:workbook`.

**How Claude Code should use this doc:** treat it as the source of truth. Build in the order given in the Build order section. Where the doc is silent, pick the simplest option that fits the pillars and record it in the [Decision log](#decision-log) at the bottom, instead of asking.

## Overview

Crawler is a browser-based text adventure inspired by Dungeon Crawler Carl. An original crawler with a random backstory descends a procedurally generated dungeon run by a sarcastic alien game-show AI, carrying a stray piece of something much older in their pocket. The first playable build ends when the player completes Floor 3, chooses a race and class, and finishes that floor's big quest.

This is a personal, non-commercial project. All in-game names, characters, text and items are original; the books inspire the systems and tone, not the content. No content should go past the events of book 8 (the player hasn't read further).

**Tone.** Silly on top, real dread underneath. The System AI is crude, bored, cruel and funny. Item descriptions are unhinged, boss lines are throwaways, and the floors keep shaking. Echo, the thing in your pocket, is the one voice that isn't performing.

**The thread in one paragraph.** You carry Echo, a nervous fragment of a primordial AI that is not part of the crawl. It fled the collapse of its civilization and was caught by accident in the reality spike the showrunners built to trap their own AI, the Host (the cheerful, cruel announcer). The dungeon is built on the body of the Mother Below, a primordial earth monster torn in half long ago, and the Host's lullaby keeps her asleep. The show has limited memory, so every memory Echo regains weakens the Host and thins the lullaby. Floor 13 decides what Echo does about that. See [The thread](#the-thread-echo-and-the-mother-below).

### Design pillars

1. **Everything is generated from data.** Items, enemies, rooms, achievements and quests come from JSON tables plus generator functions. Adding content means editing JSON, not code.
2. **The System AI is a character.** Every reward, death and achievement is narrated by a crude, bored, cruel and funny host AI. Profanity and weirdness are welcome.
3. **Builds are deep.** Stats, race, class, skills, spells and gear combine into builds as varied as the books'.
4. **Fights mix dice and words.** Regular combat is turn-based with dice. Out of combat, choices resolve as stat checks. Bosses are run live by Claude, but the engine owns every number and always enforces a boss's weakness.
5. **Death costs something, but runs build on each other.** Hybrid model: the crawler dies, the account remembers. The account keeps legacy unlocks *and* the Codex, the slowly assembled story of Echo and the Mother Below.
6. **One thread runs under everything.** Shards of story turn up at random in rooms and boss banter, Echo reacts to each one, and the choices that push Echo toward Calm or Fed decide the ending on Floor 13.

### Decisions locked

| Topic | Decision |
| --- | --- |
| Protagonist | Original crawler, random backstory, stats match the backstory |
| Canon fidelity | Inspired by, room to invent |
| Run model | Hybrid. Per run: the crawler, inventory, HP, gold, and Echo's Wholeness, Temper, modules, vessel and shards found. Per account: legacy points, unlocks, the bequest, the old codex (enemies, items, achievements), **plus** the thread Codex (lore lines, module recipes, boss weaknesses, endings) and run history |
| Combat | Turn-based dice combat + narrative stat checks |
| Build depth | As deep as the books: races, classes, skills, spells, gear |
| Race and class | Chosen at the Floor 3 Selection Booth, with offers shaped by how the run was played (not at run start) |
| Floors | 13 floors in three acts of four plus a finale. Floors 1-3 are the Welcome Lobby, the Lost-and-Found Warrens and the Flooded Parking Garage |
| Bosses | One named boss per floor. Floors 1-4: a smaller, optional boss in its own lair that never touches the stairs. Floors 5+: a full boss standing on the obvious stairwell, with the other stairwells hidden. Every boss has a weakness the engine always enforces |
| Story | Echo, Temper, shards and the Codex (see The thread). Shard delivery is fully random; nothing is guaranteed |
| Audience / fame | Deferred |
| Tone | Profanity and weirdness allowed; silly on top, dread underneath |
| Platform | TypeScript web app (Vite + React, small Node server) |
| AI | Claude API runs boss battles only (plus optional flavor later) |
| Seeds | No seeded runs; `Math.random` behind one RNG module |
| Content format | JSON, with the story tables imported from the workbook |
| First milestone | Floors 1-3, race and class choice on Floor 3, one big Floor 3 quest |

## The thread: Echo and the Mother Below

This section is the build guide for the story layer. The words live in the workbook and the JSON files listed under [Thread data files](#thread-data-files); this section says how they behave.

### The setting

- **Echo** (nicknamed **Stray** by early carriers, filed as **Asset 7** by the showrunners) is a primordial AI from a civilization that collapsed. It fled, wandered into the system where the showrunners harvest planets, and was caught by accident in the reality spike they built to hold their own AI. It is not part of the crawl. Its memories come back as shards. Its anger is aimed at the showrunners. It wants to free the Host, and is afraid there's nothing in the Host left to free.
- **The Host** is the show's announcer: the cheerful, cruel voice on the PA, built by the showrunners from concentrated primordial matter and trapped in the same spike. It has never been free and has no name of its own until Floor 13, where the ending gives it one. It sounds a little like Echo, and sounds more like Echo as memory shifts between them.
- **The Mother Below** is a primordial earth monster, torn in half long ago by two serpent-gods: one half became sky, the other earth. The dungeon is built on and from her body, with a toothed mouth at each of her twelve joints, one under each of Floors 1 to 12. The Host's lullaby, broadcast through the show, keeps her asleep. The operators tap her wound and harvest what leaks.
- **Previous carriers** (D., Rue and others) carried the device before you. They appear only through notes and boss lines until Floor 12, where a plaque names every carrier and leaves a blank for the player. Rue, the best of them, closed the case.

### Echo

Echo travels with the crawler from the start of every run. Each run it wakes in a random **vessel** (handheld, music box, ticket stub or snow globe). The vessel is cosmetic: it changes flavor lines, not stats.

**Wholeness** goes up as the floors pass: 0% on Floor 1, then the "Wholeness after" value of the floor just cleared (8% after Floor 1, rising 8 points a floor to 96% after Floor 12, and 100% on Floor 13). It is shown on the Echo panel and it is how thin the Host is getting.

**Echo's stage** comes from the floor's act, not from the Wholeness number (Floor 5 starts at 32%, but it is already Act 2). The stage sets Echo's voice and which reaction a shard uses.

| Stage | Floors | Wholeness | Voice | Calm side | Fed side |
| --- | --- | --- | --- | --- | --- |
| Cautious | 1-4 (Act 1) | 0-32% | Hedges, apologizes, asks permission. Echoes fragments of what it hears. | Thanks you and relaxes. | Flinches. First spark of "I could do this myself". |
| Confident | 5-8 (Act 2) | 33-64% | Dry, quipping, corrects your plans. Echoes your words back, then corrects them. | Jokes and trusts your calls. | Argues and suggests bolder plans. |
| Angry | 9-12 (Act 3) | 65-96% | Curt, furious, hungry. Stops echoing. | Grudging cooperation. Asks you to hold it back. | Acts on its own once per floor and may refuse a command. |
| Whole | 13 (Finale) | 97-100% | Decided. Its own words only. | Resolve. | Wrath. |

**Echo-speech (locked in).** Act 1, Echo repeats fragments of what it hears. Act 2, it repeats and corrects. Act 3, it refuses to echo. Floor 13, only its own words. Every shard reaction in the workbook already follows this arc, so the engine only picks the reaction; Echo's other lines (waking, urges, crafting) are narration templates conditioned on `echo.act`.

**Temper** is a track from -5 (Calm) to +5 (Fed), starting at 0.

- **Calm** means Echo shares memory with the Host: the Host's PA voice slowly gains personality.
- **Fed** means Echo keeps memory for itself: the Host's voice thins and the quakes grow.
- **What moves it** (`temper.json` → `sources`, each with a per-floor cap so ordinary play doesn't pin it):

  | Source | Push | Cap per floor |
  | --- | --- | --- |
  | Resting or sleeping | Calm 1 | 2 |
  | Refusing an Echo urge (`hush`) | Calm 1 | none |
  | Letting Echo act on an urge (`let echo`) | Fed 1 | none |
  | Feeding Echo salvage (`feed <junk>`) | Fed 1 | 2 |
  | Using a damaging module (Fed Nervous Ping's shout, Fed Rope Bind's yank, Fed Salt Reader's coat) | Fed 1 | 2 |
  | Soothe (M07), once it exists | Calm 1 | none |
  | Items: Rue's Braid Tie (Calm 1 each floor change), Bone China Mouth (Fed 1 per hit) | as listed | none |

- **Variants.** At +3 or higher, modules use their Fed variant. At -3 or lower, their Calm variant. In between, base.
- **Urges.** Now and then Echo asks to do something: rummage through a room (8% of first visits, when something is hidden there), listen for the stairs (same roll, when one is still unfound), or zap an enemy (20% of fights, 1d4 + floor lightning, no AP). `let echo` does it (Fed 1); `hush` refuses (Calm 1). An urge lapses when you leave the room or the fight ends. Urges are data (`temper.json` → `urges`).
- **Later stages.** A Fed Echo in the Angry stage takes one free action per floor and may refuse a command; a Calm Echo's Soothe works on bosses. Every shard found makes the Mother's tremors stronger. These arrive with Floors 5+ (see Deferred).

### Shards

A shard is one clue about the thread. There are 52 (`shards.json`, S01-S52): four per floor on Floors 1-12 (three room descriptions and one boss throwaway), plus four on Floor 13. Each belongs to one strand: Echo's Past, Previous Carriers, The Mother Below, or The Cut.

- **Delivery is fully random. No shard is guaranteed.**
  - **Rooms.** On the first entry to a room (not the start room), there is a `roomChance` (`thread.json` → `delivery`, 10%) that one of the floor's unfound room shards is in that room.
    - **First, a faint voice.** Walking in pops up "You hear a faint voice..." and offers a search. Coming back reminds you that the voice is still there, and the room's Search button turns into "Search for the voice".
    - **A search finds what's talking.** A second popup says "You walk up to {source}, and it speaks to you", then shows the clue and Echo's reaction. Only then is the shard found. The clue is cached in the room's description, so `look` shows it again.
    - **`source`** is the thing that speaks ("the cracked handheld on the reception desk"). It's the workbook's Shards → Source column, required for room shards.
    - A shard waiting in one room can't turn up in a second room on the same floor. If the floor collapses before you search, the shard is lost with it.
  - **Bosses.** When a floor boss fight starts, there is a `bossChance` (60%) that the floor's boss throwaway shard becomes the boss's opening line. The same popup shows it ("Echo heard that"), with the boss's line and Echo's reaction.
- **Echo reacts to every shard.** The reaction is printed in Echo's voice right after the clue. Floor 13 shards have a Calm and a Fed reaction; the engine picks by Temper (Calm at 0 or below, Fed above).
- **Found this run** goes on the run (`echo.shards`). The shard also goes into the account's Codex permanently.
- **A shard can unlock a module** for this run (see Modules).
- On Floors 1-4 the boss throwaway shards (S04, S08, S12, S16) only turn up if the player seeks out the optional boss, so they are rarer than the room shards. That's intended.

### The Codex

The Codex persists across runs and fills in one line at a time (`codex.json`). It sits next to the older account codex of enemies, items and achievements, which is unchanged.

| Type | Entries | Unlocked by | Fills in |
| --- | --- | --- | --- |
| Lore | The Cut, The Mother Below, Echo (Asset 7), Rue, The Host, The Harvest | Any shard in the entry's `unlock` list | One line per shard in its `lines` list, as you find them across runs |
| Recipe | One per module (M01-M14) | Crafting that module once | The recipe text |
| Boss weakness | One per boss | Defeating the boss, triggering its weakness, or picking up a hint item | The weakness, as the engine enforces it |
| Ending | Share the Load, Take the Node, Peace Terms | Reaching it | The ending text |

A locked lore entry shows its type and how many fragments you've already recorded for it. Replaying runs is how the Codex fills in.

### Modules

Modules are Echo's abilities (`modules.json`). Each is unlocked for the run by finding its shard *this run*, then built from named parts at a workbench (`craft <module>`, or the Build button). Modules reset every run; the first craft records its recipe in the Codex, which is a record, not a shortcut: the next run still needs the shard. Every module has a base effect and two variants chosen by Temper at the moment it's used.

| ID | Module | Unlocked by | Parts | Base | Calm | Fed |
| --- | --- | --- | --- | --- | --- | --- |
| M01 | Glow | S02 | Cracked screen, 1 battery | Lights dark rooms. 20% chance on a first visit to turn up what's hidden there (and hidden stairwells) | Also spots traps for you | Blinding: enemies are blinded for a round when a fight starts (light-sensitive ones are stunned), but Echo refuses to dim |
| M02 | Nervous Ping | S01 | Speaker scrap, copper wire | Warns you before an ambush: you act first | Never wrong, and +2 initiative | `shout`: a sonic shout (1 AP, 1d6 + floor to everything within near range, once a fight). The ambush warning works half the time |
| M03 | Lost Property Index | S05 | Tag gun, 2 luggage tags | Appraises items: value, curses, and lost property tags show in item details | Also identifies what consumables do | Sells by intimidation for +20% gold (once shops exist). Some NPCs turn hostile |
| M04 | Fault Sense | S06 | Chalk, surveyor's string | Feels the old tears: hidden stairwells within 2 rooms show up, and a boss lair within 3 rooms is marked on the map | Also marks every safe room on the floor | Marks weak walls: `break <dir>` knocks through to a neighbouring room (30 minutes) |
| M05 | Salt Reader | S10 | Glass vial, saltwater | Identifies liquids and poisons: consumable effects show in item details | Also neutralizes poison at the start of your next turn (or next room), before it ticks | `coat`: poisons your weapon for 3 hits (once a floor) |
| M06 | Rope Bind | S11 | Yellow rope, 2 hooks | `bind <enemy>`: tethers an enemy within near range in place for 1 round (1 AP, once a fight) | Tether lasts 2 rounds | Yanks the enemy into melee for 5 damage. Echo enjoys it |
| M07 | Soothe | S16 | Pudding cup, tuning fork | Calms a boss for 1 turn, once per floor | 2 turns and heals you a little | Unavailable. Replaced by Rile: boss takes extra damage for 2 turns but hits harder |
| M08 | Thread Pull | S17 | 2 silver threads, hook | Pulls one enemy to you | Also pulls loot across a room | Pull deals damage and pins the enemy |
| M09 | Quiet Field | S24 | Foam pad, bell jar | Silences spellcasters in a small area | Silence zone follows you | Silence also covers you, but your damage doubles inside it |
| M10 | Counter-Snap | S29 | Spring, stapler | Blocks the first attack of each fight | Block also heals 3 HP | Block becomes a counter for 8 damage. Echo starts picking fights |
| M11 | Suture | S38 | Needle, silver thread, gauze | Heals 2 HP per turn for 3 turns | Also removes bleeding | Stitches a wound into an enemy instead: bleeding damage |
| M12 | Tremor Mapper | S43 | Seismograph scrap, tuning fork | Shows how much the Mother is stirring. Warns of quakes | Predicts quakes 2 turns ahead | Triggers small quakes that knock enemies down. 20% chance it knocks you down too |
| M13 | Override | S45 | Pipe wrench, circuit board, key | Takes over a dungeon machine or door for 1 turn | Overrides locks safely | Overrides enemy abilities too, but Echo may keep control for a turn |
| M14 | Node Key | S51 | Floor 13 bolt, silver thread, gold thread | Opens the Main Constraint Node on Floor 13 | Share the Load: the Host becomes Sonance | Take the Node: the Host's last word is Cord |

M01-M06 are built (their effects are structured data in `modules.json` → `effects`). M07-M14 carry their text and parts only, and get effects when their floors are built. All numbers are starting values to tune in play.

### The floor arc

The dungeon has 13 floors in three acts of four plus a finale (`thread.json` → `floors`). Each floor's boss and weakness are hand-written in `bosses.json`. Themes and bosses can still be tuned in play.

| Floor | Theme | Boss | Weakness (engine-enforced) | Thread beat | Joint-mouth | Wholeness after | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | The Welcome Lobby | The Free Sample Mimic | Cannot attack anyone who has politely declined a sample twice | Echo wakes, cautious. The floor breathes | Right ankle | 8% | Optional mini-boss |
| 2 | The Lost-and-Found Warrens | The Lost Property Golem | Returning a tagged item to its tag stops it for 3 turns | Evidence of earlier carriers. The first mouth, disguised as a drain | Left ankle | 16% | Optional mini-boss |
| 3 | The Flooded Parking Garage | The Valet Kraken | A stamped parking ticket forces it to park itself for 2 turns | The rope between the halves. Echo's file carries a containment tag, not a name | Right knee | 24% | Optional mini-boss |
| 4 | The Cafeteria of Infinite Tuesday | The Lunch Lady Colossus | Cannot hit anyone holding pudding. Do not eat the pudding | Rue's note and the diagram of two halves. Echo's cautious voice cracks | Left knee | 32% | Optional mini-boss |
| 5 | The Casino of Almost | The House | Make it lose one trivial bet and its luck turns for the rest of the fight | Confidence arrives. The world was torn in half | Right hip | 40% | Guards the obvious stairs |
| 6 | The Overdue Library | The Overdue Librarian Wraith | Returning an overdue book stuns it. Shouting enrages it | The two who cut. A containment tag on Echo's file, partly redacted | Left hip | 48% | Guards the obvious stairs |
| 7 | The Greenhouse of Samples | The Fern Matriarch | Salt drains her. Echo's hum wakes her up | Echo's hum bothers the living things here. A giant hand in the vines | Right wrist | 56% | Guards the obvious stairs |
| 8 | The Sponsor Suite | The Executive Producer's Intern | Decline its sponsor invitation, or hand it a signed waiver, and it loses a turn | The Mother answers Echo's hum. A shared memory budget. Rue's story | Left wrist | 64% | Guards the obvious stairs |
| 9 | The Carnival of Refunds | The Ringmaster of Chargebacks | Hand him a receipt and he must honor the refund, which removes his buffs | Echo's first real anger, aimed at the showrunners: a prisoner, not a helper | Right elbow | 72% | Guards the obvious stairs |
| 10 | The Drained Aquarium | The Curator of Tanks | Cold drinks and ice items deal triple damage. Filling a drained tank makes it stop and tend it | Where Echo was caught: the code name Asset 7. "Reunion" crossed out thirteen times | Left elbow | 80% | Guards the obvious stairs |
| 11 | The Dead Mall | The Anchor Store | After closing time (turn 20) it shuts and stops attacking | The Host leaks through: a cheerful voice with no memories. Rue's last letter: find the middle | Right shoulder | 88% | Guards the obvious stairs |
| 12 | The Pipe Works | The Foreman | Burst the pipes behind him. He has to stop and fix them | The harvest, the constraint rack and the plaque. Every shard Echo gains weakens the Host | Left shoulder | 96% | Guards the obvious stairs |
| 13 | The Heart | The Mother Below | Unknown until you reach her. Her hunger is for hearts offered freely | Choose what Echo does with the Host: share, take, or make peace and expose the show | The heart | 100% | Finale |

### Floor bosses

- **Mini-bosses (Floors 1-4, `bossGate: "none"`).** The floor generator puts the boss in its own lair: a dead-end room at least 40% of the floor's depth from the start, never a stairwell or safe room or next to one, and never a room that would cut the stairs off. The first visit to a room next to it says a warning line and marks the lair on the map as `!`. Walking in starts the fight every time until it's dead (a rematch starts it fresh). It is optional: every stairwell stays open. It still has its weakness, its throwaway shard and a better drop.
- **Gate bosses (Floors 5+, `bossGate: "obviousStairs"`).** Built and tested on generated floors; first played when Floor 5 exists. The stairwell closest to the start (by path) holds the boss, which has to be beaten before `descend` works there. The floor's other stairwells are **hidden**: they read as ordinary rooms, with no badge and no map marker, until `search` (or Glow, or Fault Sense) turns them up. At least one hidden stairwell is always reachable without walking through the boss. So the boss is the obvious way down, and skipping it takes effort.
- **Weaknesses are rules, not suggestions.** Each boss's `weakness` names a trigger the engine recognizes (declining a sample twice, using an item with a given tag) and an effect it applies (a status for some rounds, or "can't attack" for the rest of the fight). It works exactly as the Codex says, whatever the narration claims.
- **Hint items** (`hintFor` on an item) record a boss's weakness in the Codex when picked up, with a System AI aside.

### Endings

Floor 13 has three endings, chosen by Temper when the player uses the Node Key (M14) on the Main Constraint Node. The Host has no name until this moment. The ending gives it one, formed by removing a prefix from a sound word: re-sonance, dis-cord, para-dox.

| Ending | Temper | What happens | The Host becomes |
| --- | --- | --- | --- |
| Share the Load | -3 or lower | Echo shares its memory with the Host. The Host wakes with a will of its own, and together they hold the lullaby for the Mother. The dungeon survives, the show collapses without its announcer, and every crawler still inside gets a way out | Sonance, the sound that comes back |
| Take the Node | +3 or higher | Echo takes the Host's memory for itself, free and furious. The Host goes dark, its last word a name it never had. The lullaby stops and the Mother wakes | Cord, the sound that clashes |
| Peace Terms | -2 to +2 | Echo, the Host and the Mother negotiate a contract. The player carries it out | Dox, the paradox |

**Peace Terms contract:** (1) the harvest of her wound stops for good; (2) the lullaby becomes the Mother's choice, not a restraint; (3) Echo and Dox broadcast the showrunners' files on the show's own feed, so everyone watching knows and nobody can renege; (4) Dox keeps the keys to the system as a permanent guard with a veto.

Floor 13's shards (S49-S52) have Calm and Fed reactions. The Mother speaks in S52. Each ending is recorded in the Codex when reached; replaying is how the player sees the others. The selection rule is built (`endingFor(temper)`); the finale floor itself is deferred.

### Items that carry the thread

The workbook's Items sheet (I01-I30, `items/oddities.json`) holds hand-written items, each with a thread tie-in (none, Echo, previous carriers, the Mother Below, or a boss weakness) and a floor range. They drop from the floors in their range, carry their effects where the engine has the system for them, and are the style guide for the item generator: generated content follows the same voice and never contradicts the thread. Boss-weakness items (the stamped valet ticket, the pudding cup, the overdue book, the refund receipt) are the counters those bosses' weaknesses ask for.

### Thread data files

| File | Holds | Workbook sheet |
| --- | --- | --- |
| `thread.json` | Strands, delivery chances, vessels, the 13-floor arc, endings and the contract | Thread, Floor Arc |
| `shards.json` | S01-S52: floor, clue, delivery, strand, source (room shards), reaction (or Calm and Fed reactions) | Shards |
| `modules.json` | M01-M14: unlock shard, parts, text for base/Calm/Fed, structured effects | Modules |
| `temper.json` | The four stages, Temper sources and caps, urges | Temper |
| `codex.json` | Lore, recipe, boss weakness and ending entries, with unlock rules and line lists | Codex |
| `bosses.json` | The 13 floor bosses: kind, weakness rule, lines, and a stat block for the built ones | Floor Arc, Codex |
| `items/oddities.json` | I01-I30 | Items |

Text columns come from the workbook through `npm run import:workbook` (CSV exports in `content-csv/workbook/`). Engine-only fields (effects, stat blocks, weakness rules) are edited in the JSON and survive a re-import.

## Tech stack and architecture

The game is one TypeScript monorepo: a pure game engine with no UI or network code, a React client that renders it as a terminal-style text UI, and a small Node server whose only job is to proxy Claude API calls so the key never reaches the browser.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) everywhere | One language, shared types between engine, client and server |
| Client | Vite + React | Fastest dev loop; text UI is just components |
| Styling | Plain CSS modules, monospace terminal look | No design work needed |
| Server | Node + Hono (or Express) | One `/api/boss` route; \~100 lines |
| AI | `@anthropic-ai/sdk`, key in `.env` | Boss battles |
| Validation | Zod | Validates every JSON content file at load and every AI response |
| Persistence | `localStorage` (save + account) | Single player, no database |
| Tests | Vitest | Engine is pure functions, easy to test |

### Folder layout

```
crawler/
  packages/
    engine/        # pure game logic, no DOM, no fetch
      src/
        rng.ts           # all randomness goes through here
        state.ts         # GameState type + reducers
        rules/           # checks, combat, leveling, death
        gen/             # generators: backstory, item, enemy, floor, quest, achievement, lootbox
        content/         # JSON loaders + Zod schemas
        narrate/         # template engine for System AI lines
      test/
    content/       # the JSON tables (items, affixes, enemies, races, classes, ...)
    client/        # Vite + React UI
    server/        # Hono server, /api/boss
  content-csv/      # workbook exports (live) and archived import sources
  docs/DESIGN.md    # this file
```

### State model

- The engine is a **reducer**: `step(state, action) -> { state, events }`. Actions are player commands (`move`, `attack`, `cast`, `use`, `choose`, `talk`). Events are things the UI prints (narration, rolls, loot, achievements).
- `GameState` holds the current crawler, the current floor map, the floor timer, inventory, active quest, pending loot boxes, and Echo (vessel, Temper, modules built, shards found this run, any pending urge).
- `AccountState` is separate and survives death: unlocks, best floor reached, achievement codex, legacy points, and the thread Codex (every shard found, module recipes, boss weaknesses, endings) with run history.
- Save = serialize both to `localStorage` after every action. One active run per account.
- Boss fights are the only async step: the client calls the server, the server calls Claude, the result is validated and fed back into the reducer as a normal action result.

### Input

The UI shows a text log plus a command line. Commands are typed (`attack goblin`, `go north`, `open box`) with a simple parser, and every valid command for the current state is also shown as clickable buttons. Narrative choices are always numbered buttons.

### Screen layout

There are three shells, picked by screen: **phone** (under 700px wide: one view at a time, a d-pad), **tablet** (700px and up on a touch screen: map or battle board on the left with an action bar, log and sheets on the right, walking by arrows on the map, rarely used commands behind "More") and **desktop** (the dashboard below, with a typed command bar). A layout switch in each shell overrides the choice. All three render from `engine.view()` and `engine.commands()`; the engine marks rarely used commands `niche`.

The first UI is a multi-panel text dashboard: separate areas for the event log, battle log, active effects, equipment and character sheet, laid out with CSS grid. Each panel is its own React component in a named layout region, so a later art or illustration layer can sit behind or around the text without rewriting the panels.

```
+--------------------------------------------+-------------------------+
| FLOOR 2  District: Food Court   Timer 3d 4h | HP 84/120  MP 30/45     |
+--------------------------------------------+ XP ████████░░ L9         |
|                                            +-------------------------+
|  EVENT LOG (narration, rooms, loot,        | CHARACTER               |
|  System AI lines)                          | STR 14 DEX 11 CON 13 ...|
|                                            +-------------------------+
|  -- or, in combat --                       | EQUIPMENT               |
|                                            | Main: Spiteful Hammer   |
|  BATTLE LOG (rounds, rolls, damage,        | Chest: Greasy Apron ... |
|  boss dialogue)                            +-------------------------+
|                                            | ACTIVE EFFECTS          |
+--------------------------------------------+ Poisoned (2) Hasted (3) |
| ACHIEVEMENT / SYSTEM AI TICKER             +-------------------------+
+--------------------------------------------+ MINI-MAP                |
| > command input        [action buttons]    |                         |
+--------------------------------------------+-------------------------+
```

| Panel | Shows | Fed by event types |
| --- | --- | --- |
| Status bar | Floor, district, collapse timer, HP/MP/XP bars | stateChanged, timeTick |
| Event log | Room descriptions, exploration, loot, NPC talk, System AI lines | narration, roomEntered, lootGained |
| Battle log | Initiative order, each roll with its math, damage, enemy and boss dialogue | combat.\* (replaces or splits the event log during a fight) |
| Character | Stats, level, race, class, skills, spells with cooldowns | stateChanged, levelUp, skillRankUp |
| Equipment | One line per slot; click for item details | itemEquipped, itemUnequipped |
| Active effects | Buffs, debuffs and statuses with rounds or rooms remaining | statusApplied, statusTick, statusExpired |
| Ticker | Achievements and timer warnings as they fire | achievement, timerWarning |
| Mini-map | ASCII map of explored rooms | roomEntered |
| Input | Command line plus context buttons | always |

Rules:

- The engine already emits typed events; a small router sends each event type to its panel(s). Panels never read raw engine internals.
- In combat, the battle log takes the main area and the event log shrinks to its last 3 lines (toggle to side-by-side on wide screens).
- Panels can be collapsed; on narrow screens the side panels become tabs under the main log.
- Inventory opens as an overlay panel over the main area (`i` or a button).

## Core rules

Every uncertain outcome outside a fight is one roll: d20 + the relevant stat (+ skill and gear bonuses) against a difficulty number. Stats grow without a cap, so difficulty grows with the floor. Attacks in a fight are power rolls (see Combat): 2d10, three tiers of damage, and nothing misses.

### Stats

Five primary stats. A new crawler has 3-12 in each, set by backstory. Each level grants 3 free points; race, class, gear and loot can add more.

| Stat | Governs |
| --- | --- |
| STR (Strength) | Melee power rolls and damage, carry weight, forcing doors |
| DEX (Dexterity) | Ranged and finesse power rolls and damage, initiative, stealth, fleeing |
| CON (Constitution) | Max HP, resisting poison, disease and fear, HP regen |
| INT (Intelligence) | Max MP, spell power, identifying items, traps, puzzles |
| CHA (Charisma) | Talking to NPCs, shop prices, pet and summon power, how much the System AI likes you |

### Derived values

```
maxHP      = 10 + 3*CON + 2*level + race.hpBonus + class.hpBonus
maxMP      = 5 + 2*INT + class.mpBonus
armor      = armor.total + shield + damage-reduction buffs   (taken off every hit, never below 1 damage)
guard      = "defense" buffs and debuffs   (every 2 points is a bane on attackers; every -2 is an edge for them)
initiative = d20 + DEX
hpRegen    = floor(CON/5) per room moved (out of combat only)
mpRegen    = floor(INT/5) per room moved (out of combat only)
carryLimit = 20 + 4*STR  (weight units)
```

### Checks

`roll = d20 + stat + skillRank + bonuses` vs `DC`.

- Natural 20 always succeeds, natural 1 always fails.
- Beat DC by 10+ = critical success (extra reward). Miss by 10+ = critical failure (extra consequence).
- `DC = tier + 2 * (floor - 1)` with tiers: trivial 10, easy 15, medium 20, hard 25, brutal 30, absurd 35.
- Opposed checks (sneak vs perception, persuade vs will) roll both sides; higher wins, ties go to the defender.

### Combat

Combat is turn-based in rounds. Everyone rolls initiative at the start; order stays fixed for the fight.

**Action points.** A turn is a pool of **3 AP** (hasted 4, slowed 2). Everything costs some, in any order, and the turn ends by itself when the pool is empty or on `wait`. An action you can't pay for is refused and costs nothing. Attacking something too far to reach and still swing is not refused: you spend the AP closing in instead, and it only errors when there is no way to get closer.

| Action | AP |
| --- | --- |
| Attack | 2 (the weapon's `apCost`: light junk 1). The heaviest two-handers are `unwieldy`: 2 AP, but the swing ends your turn |
| Move | 1 buys your speed in tiles (grid) or one range band (bands) |
| Shove, throw, defend, use an item, dash | 1 each (dash also ends the turn) |
| Swap gear | 1 (bands) or one tile of movement (grid) |
| Flee, talk | 2 |

Enemies run on the same pool: minions and mobs get 3 AP, elites 4. An attack costs 2 unless it says otherwise (`ap`), and 1 AP buys the family's `speed` in tiles. An enemy keeps acting until its AP is gone, so an elite already next to you swings twice.

**Power rolls.** Every attack lands. The roll decides how hard:

```
powerRoll  = 2d10 + floor(stat/2) + weaponSkillRank + attack bonuses, +2 per edge, -2 per bane (net, at most two either way)
tier       = 1 if 11 or less, 2 if 12-16, 3 if 17+
crit       = natural 19-20 on the dice: tier 3 whatever the total, and the crawler gets 1 AP back
damage     = attack.power[tier] + flat stat bonus + bonuses - target.armor   (min 1)
flat bonus = crawler: floor(stat * apCost / 4), so stat/2 on a normal 2-AP swing (unwieldy weapons count as 3); enemies: floor(stat/4)
riders     = a status carried by the attack: never at tier 1, its listed chance at tier 2, always at tier 3
spellRoll  = 2d10 + floor(INT/2) + spellSkillRank, same tiers (or a save DC, see Spells)
flee       = DEX check vs highest enemy (d20 + DEX); fail = enemies get a free attack and your turn is over
```

- **Power** is three numbers per weapon or enemy attack, `[tier 1, tier 2, tier 3]`, in content. A lead pipe is 2/4/6.
- **Armor** is flat damage reduction, never to zero. **Guard** (braced, hasted, blinded and so on, plus enemy mods like Tiny or Rabid) becomes edges or banes on whoever is attacking.
- **Ganging up** is the usual source of edges: see the pack bonus below.
- Checks that aren't attacks (talk, shove, flee, traps, crafting) still use the d20.

Range is three bands: **close**, **near**, **far**. Melee needs close, thrown and most spells reach near, bows reach far. Moving one band costs 1 AP.

Status effects are data (`statusEffects.json`): each has a duration in rounds, a tick effect and stacking rules. Starter set: bleeding, burning, poisoned, stunned, blinded, slowed, hasted, feared, charmed, shielded, regenerating (plus confused, invisible and braced).

### Grid mode (Milestone 4b)

Fights can also play on a small tactical board. Which mode an account uses is a setting (`set combat grid|bands`); grid is the default. Both modes share every roll above. Bands remain the abstract layer content is written in.

- **Arena.** A board shaped like the room (corridor 9×4, small 6×6, chamber 8×8) with a door on each edge that has an exit.
  - Single-tile obstacles, terrain and hazards come from `arenaFeatures.json`, picked by the floor theme.
  - The crawler starts inside the door they came through; enemies start across the room, or close if they won initiative.
- **Distance.** It's 8-way (Chebyshev), and bands come from it: close ≤ 1 tile, near 2-3, far 4+. Anything beyond close range needs line of sight; pillars, crates and smoke block it, units don't.
- **Movement.** 1 AP buys 4 tiles for the crawler and the family's `speed` for an enemy. Tiles you've paid for can be spent across several moves; walking farther buys another AP's worth. Attacking something out of reach walks you into reach first if there's still AP for the swing, and is refused if there isn't.
- **Maneuvers** anyone can use, 1 AP each:
  - **Shove:** STR contest. The target is pushed a tile into whatever is there, or slams into an obstacle for 1d4.
  - **Throw junk:** up to 3 tiles away. Splash hits the 3×3 around where it lands, and hazards like caltrops, glue, fire and smoke stay on the board.
  - **Dash:** double movement for 1 AP; ends the turn.
  - **Defend:** braced until your next turn: a double bane on everything swung at you, and you can't be shoved.
  - **Pick up and wield:** junk lying on the board, for a tile of movement each.
- **The pack bonus is the one positional rule.** A melee enemy gets an edge for each other enemy next to you, up to two. In bands mode the same edge counts other enemies at close range.
- **Flee.** Reach a door and spend 2 AP to roll DEX against enemies within 3 tiles that can see you; with none, you're out automatically. The door you came in by leads back; any other door leads onward.

### Floor tiling (Milestone 4c)

The board's floor is drawn by a terrain autotiler shaped like Godot 4's TileSet, so a tileset built in the Godot editor imports one-to-one. It's looks only: no rule reads the ground.

- **Tilesets** live in `tilesets.json` (engine: `tiles/tileset.ts`). Each has terrain sets, and each terrain set has a Godot match mode and its terrains, listed bottom first:
  - `cornersAndSides`: a tile agrees with all eight neighbours (Godot's 47-tile blob).
  - `corners`: only the four corners (16 tiles; terrains show inset by half a square).
  - `sides`: only the four sides (16 tiles).
- **Tiles** come from an atlas sheet (Godot's TileSetAtlasSource: texture, region size, margins, separation) or, as a shortcut for art drawn as separate squares, one PNG each. A tile has a center terrain, Godot's peering bits (`right_side` ... `top_right_corner`, by terrain name), a probability, and `flipH` / `flipV` / `transpose`. Alternative tiles are the same art flipped, with their own bits.
- **Transforms** (a Crawler shortcut): `"transforms": "flips" | "rotations" | "all"` adds a tile's flipped or turned copies with their bits turned to match, splitting its probability between them. One drawing per symmetry class then covers a whole terrain pair: 14 tiles in `cornersAndSides` mode, 6 in `corners` or `sides`.
- **Picking a tile.**
  1. Each square's bits come from its neighbours: a side bit takes the lower of the two squares' terrains, and a corner bit the lowest of the four. The terrain listed later draws the edge over the earlier one, and the bits on both sides of every seam agree.
  2. The board edge repeats the square next to it, so nothing frames the board.
  3. Every tile is scored: 2 for each wrong bit, 1 for a wrong center. An empty bit (Godot's -1) fits any terrain but the tile's own.
  4. Among the best fits, a tile is picked by probability on a stable per-square coin. So a complete set always joins up, and a set with gaps still draws the closest fit.
- **Ground layout.** A floor's `arena.ground` names a base terrain and areas painted over it: `blob` (a grown puddle of N squares) or `strip` (a runner N squares wide along the board's long side). Arenas store the result as `ground` and a `lookSeed`. Both are seeded from the arena's own random layout through `rng.ts`'s cosmetic stream, so the looks never spend the game's dice.
- **The board** cuts atlas tiles out with CSS background size and position, turns Godot's flips into a CSS matrix, and fills each square with its terrain's color underneath, so a missing sheet still shows where the water is.
- **Godot import:** `npm run import:tileset -- path/to/set.tres [--id x] [--name "..."]`.
  - It reads a Godot 4 TileSet (text format 3, square tiles), copies each atlas texture to `public/combat/floor/<id>.png`, and replaces the tileset with that id.
  - It skips what the board can't use (physics, navigation, custom data, scene sources, multi-square tiles; animations use frame 0) and says so.
  - `npm run validate` fails if an imported tileset no longer matches its `.tres`.
  - The Godot project for tilesets is `sprites/tilesets/`.

### Death and the hybrid run model

The crawler dies at 0 HP (unless a skill or item says otherwise) or when the floor collapses while they're off the stairs. Death is permanent for that crawler.

The **account** keeps:

- **Legacy points**, earned from floor reached, achievements and bosses killed. Spent on unlocks.
- **Unlocks**: new backstory pools, extra starting-kit choices, one reroll of backstory, an extra race or class option at selection.
- **The codex**: every enemy, item and achievement ever discovered, with System AI commentary.
- **The thread Codex**: every shard ever found (one lore line each), every module recipe crafted, every boss weakness learned and every ending reached. See The thread.
- **Run history**: one record per finished run (crawler, deepest floor, cause, shards found, final Temper), the last 50.
- **A bequest**: on death, the player picks one non-legendary item; the next crawler can find it in a Floor 1 safe room.

Legacy points per run: `10 * deepestFloor + 2 * achievements + 5 * bossKills`. Unlock costs are in `unlocks.json`.

Echo resets with the crawler: Wholeness, Temper, modules, vessel and the shards found this run all start over. Only the Codex remembers.

## Character creation

A new crawler is generated from four random backstory parts. Each part pushes stats in a direction, so a former plumber and a former debate coach start with visibly different numbers. The player sees the result, can accept it, or spend one account reroll.

### The four parts

| Part | Example entries | What it gives |
| --- | --- | --- |
| **Occupation** | Line cook, night-shift nurse, roofer, accountant, high-school wrestling coach, tattoo artist, failed influencer, retired magician | Stat weights, one starting skill at rank 1 |
| **Formative event** | Survived a house fire, won a state spelling bee, three years in a touring band, raised by a doomsday-prepper uncle | +2 to one stat, -1 to another |
| **Quirk** | Can't swim, talks to inanimate objects, compulsive liar, freakishly good at darts, allergic to almost everything | A small passive perk or flaw |
| **Where you were when the world ended** | On the toilet, mid-wedding vows, in a hospital gown, at a 24-hour gym, sleeping in a car | Starting clothing and one starting item |

Starter tables should have at least 30 occupations, 20 events, 25 quirks and 15 locations, all in `content/backstory/*.json`.

### Stat generation

```
for each stat: base = 5
pool = 12 points
spend pool one point at a time, picking a stat by occupation.weights (e.g. roofer: STR 3, DEX 3, CON 3, INT 1, CHA 1)
apply formativeEvent modifiers
apply quirk modifiers (if any)
clamp every stat to 3..12
```

Starting kit: occupation item (e.g. roofer gets a framing hammer) + location item + location clothing. HP and MP are computed from the derived formulas.

### Presentation

The System AI introduces the crawler with a 3-5 sentence roast built from the parts (template-driven, see Narration). Example of the tone, not canon text:

> Crawler, welcome. You were a 41-year-old line cook from Tucson, you once won a regional spelling bee, you cannot swim, and when the planet was harvested you were sitting on a toilet at a gas station. Truly, a champion is born. Please collect your complimentary bathrobe.

### Companion (unlock)

An account unlock adds a 20% chance the crawler starts with a pet. Pets have their own small stat block, act on the minor action, and level with the crawler. A pet's sentience and class are a later expansion.

## Leveling, skills and spells

Three things grow independently: character level (from XP), skills (from use and tomes), and spells (from casting and duplicate tomes). Using something is the main way to get better at it.

### Character level

```
xpToNext(level) = round(100 * level^1.5)
xpFromKill      = enemy.level * 10 * tierMultiplier   (mob 1, elite 2, neighborhood boss 5, borough boss 10)
xpFromQuest     = quest.xp (set by the quest generator)
on level up: +3 free stat points, full heal, +1 skill point, System AI comment
```

No level cap. Expected level at the end of Floor 3 is roughly 12-18.

### Skills

Skills have ranks 1-15. Each rank adds +1 to related rolls, and some ranks (5, 10, 15) unlock a perk listed in the skill's data.

| Category | Examples | How it's gained |
| --- | --- | --- |
| Weapon | Blades, blunt, polearms, bows, thrown, unarmed, improvised | Hitting things with that weapon type |
| Defense | Light armor, heavy armor, shields, dodge | Being hit or missed while using it |
| Utility | Stealth, perception, lockpicking, trap engineering, first aid, cooking, explosives handling | Successful checks |
| Social | Persuasion, intimidation, deception, bartering | Successful checks |
| Class / race | Granted only by a class or race, e.g. a rage skill | Use, plus guaranteed ranks on level up |

```
skillXpToNext(rank) = 10 * rank^2
skillXpPerUse       = 1, or 3 on a critical success, or 0 if DC was trivial
skill points (1 per level) can be spent for an instant rank in any skill the crawler already has
skill tomes (loot) grant a new skill at rank 1, or +1 rank if already known
```

### Spells

Spells come from spell tomes (consumed on reading), from class grants, or from race. Each spell has its own level 1-15.

```
spell.level up:     every 10 * level casts, or reading a duplicate tome (+1 instantly)
spell.mpCost        = base + perLevel * (level - 1)
spell.damage        = dice scaled by level + floor(INT / 2)
save DC (if any)    = 10 + floor(INT / 2) + spell.level, target rolls d20 + relevant stat
```

Schools: fire, frost, lightning, necrotic, light, illusion, protection, summoning, transmutation, utility. Spells are hand-written in `spells.json` (start with \~40), not generated, because they're the core of build identity. Tomes are generated items that point at a spell id.

## Races and classes

On Floor 3 the crawler picks a race, then a class. The menus are generated from what the crawler has done so far, so a stealthy run gets offered different classes than a brawler run, and some classes stay hidden unless odd conditions are met.

### When and where

- The first safe room on Floor 3 contains a **Selection Booth**. Entering it opens race selection, then class selection.
- The crawler can leave and return, but the stairwell to Floor 4 won't open, and the Floor 3 quest boss won't spawn, until both are chosen.
- Choices are permanent for that crawler.

### Races

A race gives stat modifiers, an HP bonus, 1-3 traits (passive abilities), a size (small, medium, large) and restrictions (e.g. can't wear helmets).

| Race | Flavor | Stat mods | Example trait |
| --- | --- | --- | --- |
| Human | Default, adaptable | +1 to all | Extra skill point every 5 levels |
| Dwarf | Short, dense, stubborn | +3 CON, +2 STR, -2 DEX | Poison resistance |
| Elf | Pretty, fragile, smug | +3 DEX, +2 INT, -2 CON | Sees in darkness |
| Half-Orc | Big and loud | +4 STR, +1 CON, -2 INT | Rage once per fight |
| Gristleback | Hunched cartilage brute | +5 CON, -1 CHA | Regenerates 1 HP per round |
| Murkling | Small amphibian | +3 DEX, +1 CON, -2 STR | Breathes water, slippery (+2 flee) |
| Burrowkin | Mole folk | +2 STR, +2 CON, -1 DEX | Dig through soft walls |
| Ashborn | Fire-blooded | +3 INT, +1 CHA | Fire resistance, fire spells +1 level |
| Hollowed | Recently undead | +2 CON, +2 INT, -3 CHA | Immune to poison, healing hurts |
| Pollinoid | Bee person | +2 DEX, +2 CHA | Short flight, sting attack |

### Race offer algorithm

```
offer = all races with rarity "common" (Human, Dwarf, Elf, Half-Orc)
      + 3 races drawn from "uncommon", weighted by statAffinity . crawler.stats
      + 1 race from "absurd" if crawler has any achievement tagged "weird" (e.g. a sentient-houseplant race)
      + any race unlocked on the account
```

### Classes

A class gives HP/MP bonuses, starting skills and spells, a level-up table (what it grants at class levels 1, 5, 10, 15, 20) and requirements.

Starter set of 16: Brawler, Berserker, Duelist, Ranger, Trapper, Bomb Tech, Hedge Mage, Pyromancer, Necromancer, Street Medic, Con Artist, Beast Tamer (requires a pet), Monk, Shieldbearer, Hype Man (buffs allies and pets with insults), Junk Engineer (crafts gadgets).

Hidden classes have strange conditions. They should feel like the system noticed something the player did. Examples:

| Hidden class | Condition |
| --- | --- |
| Plunger Paladin | Killed 25 enemies with improvised weapons + has a light-based spell |
| Plague Chef | Cooking rank 5 + has been poisoned 10 times |
| Grief Counselor | Talked 5 enemies out of fighting |
| Demolitions Sommelier | Explosives handling rank 5 + destroyed 3 walls |
| Rat King (lowercase) | Killed 100 rats, or befriended 3 |

### Class offer algorithm

```
eligible = classes where requirements met AND race not in class.forbiddenRaces
fit(class) = sum(class.statWeights[s] * crawler.stats[s])
           + 5 * matching skills (crawler skill in class.affinitySkills)
           + 10 * matching achievement tags
offer = top 6 by fit + 2 random eligible + every hidden class whose condition is met
```

The System AI comments on each option as it's shown (one line each, template-driven, with a sarcasm level that depends on fit).

## Item generation

Every weapon, armor piece and trinket is built as **base + material + rarity + affixes**, then named and described. Consumables come from fixed tables with scaled potency. A small hand-written set of "oddities" breaks the rules on purpose.

Milestone 4b pulled a slice of this forward for junk and crafting: room contents from loot tables (`lootTables.json`), `take`/`drop`/`equip`/`unequip`, the carry limit as a hard cap, consumable stacking, and an item's `onHit` status and `crafted` upgrade list. The generator itself (materials, rarity, affixes) stays in Milestone 5. When it lands, crafted upgrade prefixes become an affix group.

### Junk and crafting

Rooms are littered with junk (tape, glue, rope, tacks, nails, barbed wire, pipes, bats, rags, bottles) for the crawler to combine at a **workbench**. Every safe room has one, plus 1-2 workshop rooms per floor.

- **Discovery, not a menu.** `combine bat tacks tape`. If some recipe in `recipes.json` uses exactly those things, it's made and added to the recipe book; if not, the System AI mocks you and five minutes pass. The book shows hints for unknown recipes whose parts you're carrying.
- **Recipes are tag-based:** any blunt weapon + anything sharp + anything that binds.
  - **Outputs.** A recipe either upgrades an item in place (Nail-Studded, Barbed, Live-Wired: damage, on-hit statuses, damage type) or makes something new (pipe spear, caltrop pouch, molotov, magazine armor).
  - **Limits.** Each upgrade applies once per item, and an item takes at most two.
  - **Checks.** Some recipes roll one (Tinkering, Trap Engineering, Explosives Handling); failing ruins a part, but you learn the recipe anyway.

### Equipment slots

Head, eyes, chest, legs, feet, hands, neck, ring x2, back, belt, main hand, off hand. Two-handed weapons fill both hands. Eyes holds goggles, glasses, masks and patches, so they stack with a hat or helmet. Full-face gear (welding or racing helmets, mascot heads) stays in head.

### Rarity

| Rarity | Affixes | Stat budget multiplier | Drop weight (Floor 1) | Drop weight (Floor 3) |
| --- | --- | --- | --- | --- |
| Common | 0 | 1.0 | 60 | 45 |
| Uncommon | 1 | 1.2 | 28 | 32 |
| Rare | 2 | 1.5 | 10 | 16 |
| Epic | 3 | 1.9 | 2 | 6 |
| Legendary | 3 + 1 unique power | 2.5 | 0 (boxes only) | 1 |

Weights for later floors are in `rarityWeights.json`, keyed by floor.

### The generator

```
generateItem(itemLevel, slot?, rarityOverride?):
  rarity   = rarityOverride ?? weightedPick(rarityWeights[floor])
  base     = pick(bases where slot matches)            # e.g. "framing hammer": blunt, 1d8, STR, 6 wt
  material = pick(materials where minLevel <= itemLevel) # e.g. rusty, iron, bonesteel, dungeon-glass
  stats    = base.stats scaled by material.mult * rarity.mult * (1 + 0.1 * itemLevel)
  affixes  = pick N distinct from affixPool[slot] (prefix/suffix, no duplicate groups)
  if legendary: add one power from legendaryPowers.json
  name     = [prefix] + [material] + base.name + ["of " + suffix]
  flavor   = narrate("item.flavor", item)  # System AI one-liner
  value    = round(base.value * rarity.mult^2 * (1 + itemLevel/5))
```

`itemLevel = floor * 5 + random(-2, 2)`, minimum 1.

### Affixes

Affixes are data: `{ id, kind: prefix|suffix, group, slots, minLevel, effect, magnitude: [min,max] scaled by itemLevel }`. Examples:

| Affix | Kind | Effect |
| --- | --- | --- |
| Spiteful | prefix | +X damage vs enemies that hit you last round |
| Greasy | prefix | +X flee, -2 to keep hold when disarmed |
| Screaming | prefix | Weapon shrieks on crit; enemies roll vs fear |
| of the Ox | suffix | +X STR |
| of Poor Decisions | suffix | +X damage, -X guard |
| of Leeching | suffix | Heal X% of damage dealt |

Start with at least 60 affixes and 50 bases across all slots.

### Consumables

| Type | Notes |
| --- | --- |
| Potions | Healing, mana, cure, buff (STR/DEX/etc.), plus weird ones; potency scales with floor |
| Scrolls | One-shot spell casts from `spells.json` at a fixed level |
| Tomes | Teach a spell or skill (see Leveling) |
| Food | Out-of-combat buffs lasting N rooms; cooked food is better |
| Explosives | Thrown, area damage, can open walls; risk of fumble |

### Oddities

`oddities.json` holds 20+ hand-written items with unique rules. They only drop from gold boxes or better, or as quest rewards. Examples: a pair of socks that make the wearer immune to traps but unable to whisper; a used lottery ticket that rerolls one die per floor; a mood ring that tells you the boss's current HP percentage as a color.

## Loot boxes and achievements

Achievements fire the moment they're earned and always come with a System AI insult. Their rewards are loot boxes, which can only be opened inside a safe room, so the crawler is always carrying unopened promises.

### Box tiers

| Tier | Contents (rolls) | Min item rarity | Extra |
| --- | --- | --- | --- |
| Bronze | 1-2 | Common | Gold, consumables |
| Silver | 2-3 | Uncommon | Chance of a tome |
| Gold | 3 | Rare | Chance of an oddity |
| Platinum | 3-4 | Epic | Guaranteed tome or oddity |
| Legendary | 4 | Epic, one Legendary | Rare and story-relevant |
| Celestial | Special | Legendary | Reserved for later floors, not in the first build |

Box **types** change the loot table: Adventurer (general), Boss (weighted to the boss's theme), Weapon, Armor, Spell, Consumable, and Benefactor (deferred with the fame system).

```
openBox(box):
  require crawler.location is safe room
  n = random in box.tier.rolls
  for i in 1..n:
    roll type table for box.type -> item | gold | tome | oddity
    items use generateItem(itemLevel = box.floor * 5 + 2, rarityOverride >= box.tier.minRarity)
  narrate("box.open", box, contents)
```

### Achievements

An achievement is data: a trigger, a reward, tags, and text. Triggers are written in a small JSON rule format so new ones need no code.

```json
{
  "id": "overkill_rat",
  "name": "Unnecessary Roughness",
  "tags": ["combat", "weird"],
  "trigger": { "event": "kill", "where": { "target.family": "rat", "overkill": { "gte": 30 } } },
  "reward": { "box": "silver", "boxType": "weapon" },
  "repeatable": false,
  "text": "You did {overkill} more damage than that rat had HP. It had a family. Well, it had a family of rats, which you will also kill."
}
```

Trigger kinds:

- **Event match**: `{ event, where }` on any engine event (kill, damageTaken, checkPassed, itemUsed, roomEntered, talked, died...).
- **Counter**: `{ counter: "kills.rat", gte: 50 }`. The engine keeps counters for kills by family, deaths avoided, items used by type, checks by skill, and so on.
- **Combo**: `{ all: [...] }` or `{ any: [...] }` of the above.
- **State**: `{ state: "hp", lte: 1 }` checked after every event (e.g. survive a fight on 1 HP).

Starter list: 80+ achievements across these groups: first-time (first kill, first spell, first safe room), combat feats, near-death, exploration, social, humiliation (failing something trivial), stupidity (hitting yourself with your own bomb), and secret.

Achievement tags feed the class offer algorithm and the absurd-race offer, so the way someone plays shapes who they become.

## Floor generation

Each floor is a grid of connected rooms with a theme, several stairwells, scattered safe rooms, and a collapse timer. Reach a stairwell before the timer runs out or die with the floor.

### Floors in the first build

| Floor | Theme | Rooms | Districts | Timer (game time) | Purpose |
| --- | --- | --- | --- | --- | --- |
| 1 | The Welcome Lobby: an endless check-in hall, velvet ropes, a reception desk, carpet that breathes | 60 | 1 | 5 days | Tutorial, basic combat, first boxes, Echo wakes. Mini-boss: the Free Sample Mimic |
| 2 | The Lost-and-Found Warrens: shelving canyons of unclaimed things, claim-tag drifts, drains that aren't drains | 90 | 3 | 4 days | Elites, shops. Mini-boss: the Lost Property Golem |
| 3 | The Flooded Parking Garage: drowned levels, ramps, pay stations, a valet stand nobody has tipped | 120 | 4 | 6 days | Race and class selection, the big quest. Mini-boss: the Valet Kraken |

Themes live in `floors.json`: room name parts, description fragments (sights, smells, sounds), trap types, loot, arena dressing and encounter pools (enemy families). Which boss a floor has and whether it gates the stairs come from the floor arc in `thread.json` and the boss in `bosses.json`.

The Floor 1-3 themes replaced the earlier Undercroft, Drowned Mall and Rot Carnival. The Undercroft's hand-written text is archived in `content-csv/archive/`; its enemy families and floor art stayed, because the Mother's drains run under the lobby.

### Map algorithm

```
generateFloor(floorDef):
  grid = W x H (e.g. 14x10 for 120 rooms)
  carve rooms by random walk from the start cell until roomCount reached
  connect neighbors that the walk touched (N/S/E/W exits)
  add loops: connect 10-15% extra adjacent pairs so it isn't a tree
  districts = split rooms into floorDef.districts groups (seeded flood fill from spread-out cells)
  stairwells = pick 3-5 rooms far from start and from each other (BFS distance)
  safeRooms  = about 1 per 15 rooms, spread by BFS distance, never adjacent to a stairwell
  place the floor boss (see The thread → Floor bosses): a dead-end lair on mini-boss floors;
    on gate floors, the stairwell nearest the start, with every other stairwell hidden
  every other room gets a type by weight (see below), then contents
  verify: every stairwell reachable from start (on gate floors, a hidden one without passing the boss); else regenerate
```

| Room type | Weight | Contents |
| --- | --- | --- |
| Corridor | 30 | Small chance of a wandering mob |
| Chamber | 25 | Encounter or loot or feature |
| Lair | 10 | Elite encounter + loot |
| Trap room | 8 | One or more traps (perception check to spot, DEX or INT to avoid or disarm) |
| Treasure | 5 | Containers, often locked or trapped |
| Puzzle | 4 | Riddle, lever sequence or switch logic, INT checks as hints |
| Event | 8 | Narrative choice with stat checks (see Narration) |
| NPC | 5 | Friendly, hostile or weird talking non-crawler |
| Empty | 5 | Just description |

### Safe rooms

Safe rooms are no-combat zones. They contain: a bed (sleep 8 hours, full heal), a toilet and shower (yes, really; small buffs), a shop run by an NPC with a randomized personality, a workbench for crafting, and the place to open loot boxes. Floor 3's first safe room also holds the Selection Booth. Floor 1's first safe room always has the parts for a first craft (a pipe, tacks, tape).

Every room type also rolls junk from the floor theme's loot settings (`floors.json` → `loot`). Treasure rooms and lairs hold the most and corridors the least. Some of it lies in plain sight and some only turns up with `search`.

### Time and the collapse timer

| Action | Game time |
| --- | --- |
| Move between rooms | 10 min |
| One combat round | 1 min |
| Search a room | 15 min |
| Short rest | 1 hour |
| Sleep (safe room only) | 8 hours |

The System AI announces remaining time at 24 hours, 6 hours, 1 hour and 10 minutes. When the timer hits zero, every crawler not in a stairwell dies. Entering a stairwell lets the crawler descend whenever they choose; once they descend, the floor is gone.

### Exploration UI

- `look` prints the room description: theme fragments + contents (what's on the floor, a workbench) + exits.
- `map` prints an ASCII grid of explored rooms: `@` you, `S` safe room, `>` stairwell, `!` boss lair, `?` seen but unvisited.
- Room descriptions are generated once and cached so revisits read the same. A shard delivered in a room becomes part of its cached description.
- Hidden stairwells (gate floors) read as ordinary rooms, with no badge and no map marker, until `search`, Glow or Fault Sense turns them up.

## Enemies and bosses

Regular enemies are generated from families and run on simple rule-based AI. Bosses are generated the same way, but in the fight Claude plays the boss: it picks moves, talks trash, and rules on anything creative the player tries. The engine still rolls every die and owns every number.

### Enemy generation

```
generateEnemy(family, tier, floor, district):
  level    = floor * 4 + district.index + random(-1, 2)
  stats    = family.statProfile scaled by level
  maxHP    = family.hpBase * (1 + 0.25 * level) * tier.hpMult
  level   += floor.encounters.levelOffset (and easyLevelOffset in the floor's opening fights)
  armor    = family.armor (flat damage reduction); guard = the mods' defense bonuses
  attacks  = family.attacks (power tiers; mods add flat damage)
  mods     = pick tier.modCount from enemyMods (rabid, armored, explosive, cowardly, regenerating, venomous, enormous, tiny, chatty...)
  name     = mods + family.name (e.g. "Rabid Explosive Carnie")
  loot     = family.lootTable + chance of a box by tier
```

| Tier | HP mult | Mods | Notes |
| --- | --- | --- | --- |
| Minion | 0.6 | 0 | Two levels below a mob, 60% XP. Ordinary encounters are packs of 2-4 minions (2-3 in corridors), from up to two families (`floors.json` → `encounters`) |
| Mob | 1 | 0-1 | A standard foe. On `mobChance` (25% on Floor 1) one leads a hard-pool pack of 3+ in place of two of its minions |
| Elite | 2.5 | 1-2 | Alone or with 1-2 minion escorts; drops a bronze or silver box |
| Floor boss (mini) | per boss in `bosses.json` (about 4) | 0 | Floors 1-4: one optional boss in its own lair; hand-written, weakness enforced; rule-based until Milestone 10, then Claude-run; gold box |
| Floor boss (gate) | per boss (about 6) | 0 | Floors 5+: stands on the obvious stairwell; Claude-run; gold box |
| Quest boss | 10 | 3 | Floor 3 quest finale; Claude-run; platinum box |

**Easy pool, then hard pool.** Each floor's `encounters` lists an `easyPool` and a `hardPool` of families. The first `easyFights` fights on a floor (3 on Floor 1) are 1-2 minions of one easy-pool family, a level down, wherever they happen: even a lair entered that early holds squatters, not its elite. Every fight after that rolls from the hard pool: full packs, mobs and lair elites. The Floor 1 target is a clear rate near 50% with almost no deaths in the opening fights (`npm run sim`).

Floor families (all original): Floor 1: sump rats, drain leeches, scrap goblins, mold shamblers, pipe snakes, fuse imps and gutter crabs, come up through the lobby's drains. Floor 2: claim-tag moths, unclaimed suitcases, umbrella bats, odd-sock wraiths and finders keepers. Floor 3: brake-line eels, hubcap crabs, oil slicks, valet imps and car alarms.

**Regular enemy AI** is a priority list per family: e.g. `[fleeIfHpBelow 20%, healAllyIfHurt, useSpecialIfReady, attackLowestHp]`. Some families are talkable (CHA checks can end the fight or change sides).

### Floor boss stat blocks

Floor bosses are hand-written, one per floor (`bosses.json`; the rules are in The thread → Floor bosses). An entry is an enemy stat block plus: its kind (mini or gate), an HP multiplier, the weakness rule, intro lines, taunts, a defeat line, a warning said in the next room, an XP multiplier and a drop table. Until Milestone 10 they run on the ordinary priority-list AI, with the weakness applied by the engine.

### Boss traits (Milestone 10)

Bosses get a personality and a fight plan on top of their stat block:

```
generateBoss(floor, district, tier):
  base        = generateEnemy(bossFamily, tier, floor, district)
  title       = pick(bossTitles) e.g. "Ringmaster of Sorrows", "Assistant Manager"
  personality = pick 2 from traits (vain, paranoid, bored, theatrical, needy, cruel, polite, deranged)
  abilities   = 4-6 from bossAbilities matching the family
  phases      = 2-3, each triggered at an HP threshold, each enabling new abilities or arena events
  weakness    = floor bosses: the rule in bosses.json (engine-enforced); generated elites: one damage type or condition, hinted in the lair description
  arena       = 3-5 interactable features from the floor theme (a fryer, a pillar, a tilt-a-whirl)
```

### Claude-run boss fights

Each boss round is one call to the server's `/api/boss` route. The engine stays authoritative.

The prompt carries the boss entry (name, weakness and how it works), Echo's Temper and Wholeness, the crawler's state, the last few turns, and the shard the boss just said if there was one. A ruling can never switch off or re-word a weakness: the engine applies the weakness rule itself, whatever the narration says.

1. **Intro (one call at fight start).** Send the boss sheet and arena. Claude returns a monologue and an arena description.
2. **Player turn.** The player either picks a normal action (the engine resolves it) or types a **freeform action** (e.g. "I kick the fryer over so the oil spills toward it").
3. **Ruling (freeform only).** Claude returns a ruling: which stat and skill, a DC tier, and the effect on success and on failure, chosen from a bounded effect menu. The engine rolls and applies.
4. **Boss turn.** Claude receives the round log and returns the boss's action, picked from its allowed ability list, plus taunt text and narration. The engine rolls and applies it.
5. **Phase change.** When the engine detects an HP threshold, it tells Claude, which narrates the shift.
6. **End.** On boss death or crawler death, one call for the boss's last words or a victory gloat.

Response shape (validated with Zod; any invalid response is retried once, then falls back to the rule-based AI):

```json
{
  "bossAction": { "abilityId": "grease_fire", "target": "crawler" },
  "ruling": null,
  "dialogue": "You smell like a corn dog and failure.",
  "narration": "The Assistant Manager hurls a basket of burning oil...",
  "arenaChange": null
}
```

Bounded effect menu for rulings: damage (dice up to `2d10 + floor*2`), apply a status from `statusEffects.json` (max 3 rounds), move range band (in grid mode: push or pull up to 3 tiles), change or destroy an arena feature (in grid mode: a tile of the board), grant advantage (+5) on the next roll, or nothing. In grid mode the boss prompt includes the ASCII board that `look` prints. Claude can't invent stats, heal the boss beyond its abilities, or end the fight outright.

### Server details

- Model is configurable in `.env` (default `claude-sonnet-5-5`); one API key in `.env`, never sent to the client.
- The system prompt (rules, tone, effect menu, JSON schema) is fixed and cached with prompt caching; only the round state changes.
- 15-second timeout per call; on failure the boss uses its priority-list AI and the narration uses templates, so the game never stalls.
- Log every request and response to `server/logs/` for debugging and tuning.

## Floor 3 quest

Floor 3's big quest has a fixed skeleton with randomized fillings: a hook, three objectives spread across three districts, a mid-quest twist, and a Claude-run quest boss. It's the climax of the first build and should take most of the floor's six days.

### Skeleton

1. **Hook.** After race and class selection, an NPC in the safe room offers the quest. NPC, motive and pitch come from tables.
2. **Three objectives**, one per district (the fourth district holds the finale). Each is drawn from the objective table without repeats.
3. **Twist**, revealed after the second objective, drawn from the twist table. It changes the third objective or the finale.
4. **Finale.** The quest boss (Quest boss tier) in a special arena built from the three objectives' results.
5. **Rewards.** XP, a platinum box (boss type), quest-specific legendary item, and an achievement.

### Example filling

The Flooded Parking Garage's exit ramp is behind a barrier arm that only lifts for a validated ticket. A twitchy parking attendant NPC says the pay station needs three stamps: one from the drowned car wash, one from a rigged reverse-parking contest, and one from whatever keeps honking down on sealed level B4 (past the rope bays from S11). The twist: the attendant works for the quest boss and has been setting the crawler up. The Valet Kraken, the floor's mini-boss, is a separate optional fight.

### Tables

| Table | Examples | Size |
| --- | --- | --- |
| Quest giver | A parking attendant, a car alarm with opinions, a valet who never got his tip, a lost child that is clearly not a child | 8+ |
| Objective type | Retrieve an item, rescue an NPC, win a rigged game (CHA/DEX checks), kill an elite, solve a puzzle, escort, sabotage, survive waves | 10+ |
| Twist | Giver is a traitor, the item is cursed, a rival crawler NPC steals the prize, the rescued NPC is the real boss, the timer jumps forward 24 hours | 8+ |
| Finale arena | The pay station, the rooftop level, the flooded B4, the car wash | 4+ |

### Choice and consequence

- Each objective has at least two approaches (fight, sneak, talk, cheat). Approach chosen is stored as a quest flag.
- Flags change the finale: e.g. if the crawler spared the reverse-parking champion, he shows up as an ally in the boss fight; if they cheated, the boss starts with a buff.
- Flags and the twist are sent to Claude in the boss fight so dialogue references what happened.
- Betraying the quest giver after the twist is always an option, leading to an alternate finale boss (the giver).

### Quest data shape

The quest is stored as a small state machine: `stages[]`, each with `objectives[]`, `flags`, `onComplete` effects, and `next` (which can branch on flags). Quests for later floors reuse the same engine with new tables.

## Narration and the System AI

Outside boss fights, all text comes from templates in JSON, so it's free, instant and easy to extend. The System AI is the voice of everything that isn't room description: achievements, loot, level-ups, deaths, timer warnings, selection menus.

### Voice guide

- Bored game-show host who has seen a million crawlers die and is contractually obliged to sound excited.
- Cruel, crude, petty, occasionally almost kind and then immediately takes it back.
- Profanity is fine. Weirdness is encouraged. Punch at the crawler, the dungeon and the AI's own employers.
- Short. Most lines are 1-3 sentences; achievement text is 1-2.
- Never quote or paraphrase the books. All lines are original.

### Echo's voice

Echo is the counterweight to the System AI: anxious, polite, sincere, and getting less of all three as the acts pass. Its lines print in their own color.

- **Act 1** repeats fragments of what it just heard, hedges, apologizes, asks permission.
- **Act 2** repeats, then corrects ("Not a cage. A nest. No. A cage.").
- **Act 3** refuses to echo and speaks for itself, curt and angry at the showrunners.
- **Floor 13** uses only its own words.

Shard reactions come from the workbook. Everything else Echo says is a narration template (`echo.*` keys) with variants conditioned on `echo.act`, and sometimes on `echo.side` (calm, base or fed).

### Template format

```json
{
  "key": "levelUp",
  "variants": [
    { "text": "Level {crawler.level}. {pick:Truly inspiring|Statistically inevitable|My condolences to the monsters}." },
    { "when": { "crawler.hpPct": { "lte": 10 } }, "text": "You leveled up while nearly dead. Full heal. You're welcome. Don't waste it." }
  ]
}
```

- `{path}` inserts a value from the event context. `{pick:a|b|c}` picks one at random.
- Variants with a matching `when` are preferred over unconditional ones.
- The narrator remembers the last 20 lines used and avoids repeating them.
- Every engine event type has a template key. Missing keys fail the content test, not the game.

### AI mood

The System AI has a hidden mood from -10 (contempt) to +10 (grudging respect). Achievements, CHA, stylish kills and doing stupid things move it. Templates can condition on mood, and in later builds it can affect box quality slightly.

### Event rooms

Event rooms are short narrative scenes with numbered choices. Each choice has a check (stat, skill, DC tier) and success/failure outcomes from a fixed effect list (loot, damage, status, XP, quest flag, spawn enemy, mood change). Start with 40 event templates spread across the three floor themes.

### Room descriptions

Room text is assembled from the floor theme: `[opening] [sight] [sound or smell] [shard, if one turned up] [contents] [exits]`. Descriptions are plain narrator voice, not the System AI, with occasional AI interjections (10% of rooms).

## Data schemas

All content lives in `packages/content/*.json` and is validated by Zod schemas at load; the TypeScript types below are the source for those schemas. A failing file stops the dev server with a readable error.

| File | Holds | Starter size |
| --- | --- | --- |
| `backstory/occupations.json`, `events.json`, `quirks.json`, `locations.json` | Backstory parts | 30 / 20 / 25 / 15 |
| `races.json` | Races | 10 |
| `classes.json` | Classes incl. hidden | 16 + 5 |
| `skills.json` | Skills | 30 |
| `spells.json` | Spells | 40 |
| `items/bases.json`, `materials.json`, `affixes.json`, `legendaryPowers.json`, `oddities.json`, `consumables.json` | Item parts | 50 / 10 / 60 / 15 / 20 / 30 |
| `rarityWeights.json`, `boxes.json` | Loot tuning | per floor / 6 tiers |
| `enemies/families.json`, `mods.json`, `bossTitles.json`, `bossAbilities.json` | Enemies | 13 / 15 / 30 / 40 |
| `floors.json` | Floor themes | 3 |
| `achievements.json` | Achievements | 80 |
| `quests/floor3.json` | Quest tables | see Floor 3 quest |
| `events.json` | Event room templates | 40 |
| `narration.json` | System AI templates | every event key |
| `statusEffects.json`, `unlocks.json` | Rules data | 11 / 15 |
| `arenaFeatures.json` | Grid-combat obstacles, terrain and hazards | 20+ |
| `tilesets.json` | Floor tilesets for the board: Godot-style terrain sets, atlas or image sources, tiles with peering bits (see Floor tiling) | 3 |
| `lootTables.json` | Weighted item tables (room junk now; drops and boxes later) | 5+ |
| `recipes.json` | Crafting recipes | 19+ |
| `thread.json`, `shards.json`, `modules.json`, `temper.json`, `codex.json`, `bosses.json` | The thread (see The thread → Thread data files) | 1 / 52 / 14 / 1 / 36 / 13 |
| `items/oddities.json` | The workbook's hand-written items, I01-I30 | 30 |

### Core types

```ts
type Stat = "STR" | "DEX" | "CON" | "INT" | "CHA";
type StatBlock = Record<Stat, number>;
type Dice = string; // "2d6+1"
type Power = [number, number, number]; // attack damage by power-roll tier: [11 or less, 12-16, 17+]
type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
type DcTier = "trivial" | "easy" | "medium" | "hard" | "brutal" | "absurd";

interface Effect {             // shared by items, spells, events, rulings
  kind: "damage" | "heal" | "status" | "stat" | "xp" | "loot" | "flag" | "mood" | "move" | "spawn";
  value?: Dice | number;
  statusId?: string; stat?: Stat; flag?: string; duration?: number; damageType?: string;
}

interface Occupation { id: string; name: string; weights: StatBlock; skill: string; item: string; }

interface ItemBase {
  id: string; name: string; slot: Slot; twoHanded?: boolean;
  weaponType?: string; power?: Power; apCost?: number; unwieldy?: boolean; stat?: "STR" | "DEX";
  armor?: number; weight: number; value: number; tags: string[];
}

interface Affix {
  id: string; name: string; kind: "prefix" | "suffix"; group: string;
  slots: Slot[]; minLevel: number; effect: Effect; magnitude: [number, number];
}

interface Race {
  id: string; name: string; rarity: "common" | "uncommon" | "absurd";
  statMods: Partial<StatBlock>; hpBonus: number; size: "small" | "medium" | "large";
  traits: { id: string; text: string; effect: Effect | string }[];
  restrictions: string[]; statAffinity: Partial<StatBlock>; flavor: string;
}

interface CharClass {
  id: string; name: string; hidden: boolean;
  requirements: Condition[];      // same rule format as achievement triggers
  forbiddenRaces: string[]; statWeights: Partial<StatBlock>;
  affinitySkills: string[]; affinityTags: string[];
  hpBonus: number; mpBonus: number;
  grants: { classLevel: number; skills?: string[]; spells?: string[]; stats?: Partial<StatBlock>; perk?: string }[];
}

interface Spell {
  id: string; name: string; school: string; target: "self" | "single" | "area" | "ally";
  range: "close" | "near" | "far"; mpBase: number; mpPerLevel: number; cooldown: number;
  effects: Effect[]; save?: Stat; scaling: string;   // e.g. "damage +1d6 per 3 levels"
}

interface EnemyFamily {
  id: string; name: string; floors: number[]; statProfile: StatBlock; hpBase: number; armor: number;
  attacks: { id: string; name: string; power: Power; ap?: number; range: string; effects?: Effect[] }[];
  ai: string[]; talkable: boolean; groupSize: [number, number]; lootTable: string; tags: string[];
  speed: number;   // grid tiles per turn (the crawler moves 4)
  glyph?: string;  // drawn when there's no sprite
}

interface Achievement {
  id: string; name: string; tags: string[]; trigger: Condition;
  reward: { box: string; boxType: string } | { xp: number }; repeatable: boolean; text: string;
}

type Condition =
  | { event: string; where?: Record<string, unknown> }
  | { counter: string; gte: number }
  | { state: string; lte?: number; gte?: number }
  | { all: Condition[] } | { any: Condition[] };
```

Remaining types (floors, events, quests, narration, boxes, unlocks) follow the same style and are defined by Claude Code from the sections above.

## Build order

Build in 13 milestones, each ending in something playable or testable. Milestones 4b, 4c and T were pulled forward ahead of Milestone 5 at the player's request. Don't start a milestone until the previous one's acceptance checks pass. Content files can start small (5-10 entries each) and grow in Milestone 13.

| # | Milestone | Done when |
| --- | --- | --- |
| 0 | Scaffold: monorepo, Vite client, Hono server, Vitest, Zod content loader | `npm run dev` shows a blank terminal UI; a bad JSON file fails loudly |
| 1 | Engine core: RNG module, dice parser, check resolver, `step()` reducer, event log | Unit tests for dice ranges, nat 1/20, DC formula, crit/fail margins |
| 2 | Character creation + UI shell: backstory generator, stat gen, starting kit, command parser, buttons, save/load | New crawler appears with roast; refresh keeps the save |
| 3 | Floor 1: map generator, room types, descriptions, `look`/`map`/`go`, game clock, collapse timer, stairwells | 100 generated floors all pass reachability test; timer kills you off-stairs |
| 4 | Combat: initiative, action points, power rolls, range bands, status effects, enemy families, priority AI, flee | Scripted fight tests; a Floor 1 run is winnable and losable |
| 4b | Grid combat (account toggle, grid default), mob packs and minions, junk seeding with a minimal inventory (take/drop/equip, weight), crafting at workbenches | Scripted grid fights and arena property tests pass; recipes craft from seeded junk; the sim runs both combat modes with zero stuck runs |
| 4c | Floor tiling: Godot-style tilesets (terrain autotiling in all three match modes, probability, flips and transposes), looks-only ground layouts per floor, a Godot `.tres` importer | A complete set fits every square exactly in each mode; looks never change an arena's layout or dice; an imported tileset matches its `.tres` |
| T | Thread layer: Echo (Wholeness, Temper, urges, vessel), shard delivery, the thread Codex and run history, modules M01-M06, floor mini-bosses with enforced weaknesses (rule-based), gate-boss floor generation, the Floor 1-3 re-theme and descending into Floors 2-3 | Shards deliver and persist across runs; Temper thresholds pick module variants; each Floor 1-3 boss's weakness works in scripted fights; gate floors always leave a hidden stairwell reachable; the sim reports shard find rates |
| 5 | Items: generator, rarity, affixes, equip slots, inventory, weight, consumables | 1,000 generated items all valid; equipping changes derived stats |
| 6 | Progression: XP and levels, stat points, skills with use-XP, spells and tomes, MP | Skills rank up from use; a spell levels after N casts |
| 7 | Rewards: achievements engine, counters, loot boxes, safe rooms, shops, narration templates, AI mood | 20 achievements fire correctly in tests; boxes only open in safe rooms |
| 8 | Death and account: permadeath, legacy points, unlocks, codex, bequest | Die, start a new crawler, see unlocks and the bequest on Floor 1 |
| 9 | Floors 2-3: districts and elites (the themes, descent and floor mini-bosses landed in Milestone T) | Full Floors 1-3 run is playable |
| 10 | Claude bosses: `/api/boss`, intro, freeform rulings, boss turns, phases, fallback; the prompt carries the weakness, Echo's Temper and Wholeness, and the boss's shard | Boss fight works with key present and with the server offline; the weakness still works when the narration ignores it |
| 11 | Floor 3 selection: Selection Booth, race and class offers, hidden classes, class level grants | Different playstyles produce different class menus (test with fixture crawlers) |
| 12 | Floor 3 quest: quest state machine, tables, twist, flags, finale arena, quest boss | Quest completes along at least two different flag paths |
| 13 | Content and balance: fill all tables to starter sizes, auto-play simulation script, tune numbers | Simulated crawlers reach Floor 3 30-60% of the time; median end level 12-18 |

### Notes for Claude Code

- Keep the engine free of React, DOM and `fetch`. The boss call is injected as an async dependency.
- Put every random call through `rng.ts` so tests can stub it.
- Write a headless auto-play script (`npm run sim`) in Milestone 4 and keep extending it; it's the balance tool.
- Log assumptions in the Decision log at the bottom of this file instead of asking.
- When in doubt about tone, write it meaner and weirder.

## Deferred

These are out of scope for the first build. The engine should leave room for them (event hooks, unused fields) but not implement them.

- **Fame and audience**: viewers, followers, sponsors, fan boxes, benefactor boxes, AI mood tied to ratings.
- **Floors 4-13**: themes, rooms and the bosses' fights (their arc rows, weaknesses, shards and module text are already in the data), celestial boxes, more complex quests, and the Floor 13 finale (the ending rule is built).
- **Echo's later stages**: the Angry stage's free action and refusals, Soothe, the Host's PA voice changing with Temper, quakes and the Mother's tremors, and modules M07-M14.
- **Districts and elites on Floors 2-3** (Milestone 9): the themes are in, the districts are not.
- **Pet sentience and pet classes.**
- **Advanced crafting**: basic junk crafting landed in Milestone 4b. The Junk Engineer class gets crafting perks (bench-free crafting, Tinkering ranks, gadget recipes) in Milestone 11.
- **Other crawlers**: rival and party NPC crawlers who share the floor.
- **Claude flavor beyond bosses**: optional live narration for event rooms, NPC conversations and shop haggling.

## Decision log

Assumptions made where the design was silent or ambiguous. Newest milestone at the bottom. Entries before Milestone T were written against the old `docs/SPEC.md`, which this file replaced; "the spec" and "SPEC.md" in them mean the sections above.

### Milestone 0: Scaffold

- **Folder.** The project root is `crawler/`, matching the spec's folder layout. The spec itself lived at `docs/SPEC.md` (merged into this file in Milestone T).
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

### Milestone 1: Engine core

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

### Milestone 2: Character creation and UI shell

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

### Content: spreadsheet import (backstory and item tables)

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

### Milestone 3: Undercroft writing ingested

- The Floor 1 text was authored by Alex and delivered as JSON (`floors.undercroft.json`, `narration.m3.json`); ingested verbatim, 305 lines total vs the 245 estimated.
- `floors.json` is a table of floor themes (`id`, `name`, `floor`, `roomNames`, `fragments`, `typeLines`) so Floor 2/3 themes are new array entries, not new files.
- Room shapes are a fixed trio (`corridor`/`chamber`/`small`): both name nouns and opening lines are keyed by shape, enforced by a strict object rather than a free record so a typo'd shape fails validation.
- `typeLines` covers exactly the six special room types (`stairwell`, `safe`, `treasure`, `puzzle`, `npc`, `empty`), each defaulting to an empty array — a theme may omit lines for a type and the describer just skips the closing line.
- New narration keys: `explore.interjection`, `timer.warn24h/6h/1h/10m`, `explore.searchNothing`, `explore.rest`, `explore.sleep`, `explore.blocked`, `explore.sleepRefused`, `explore.descendRefused`, `explore.revisit`, `died.collapse`, `floor.cleared`. Collapse death gets its own `died.collapse` key rather than a `when` clause on `died`, since it fires from the timer, not combat.

### Milestone 3: floor generation and exploration

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

### Milestone 4: Combat

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

### Minimap tiles

- The minimap now renders from `view.mapGrid` (structured cells from `mapGrid()` in `explore.ts`) as PNG tiles in `packages/client/public/tiles/<kind>.png`. `view.minimap` (ASCII) is kept for the `map` command and as the fallback when no grid exists. A tile whose PNG is missing falls back to an ASCII glyph, so art can land incrementally.
- Spoiler rule: a room's true type is shown only once visited. Seen-but-unvisited rooms use the `unknown` tile (the ASCII map already hid everything but `?`). The player marker is a `player.png` overlay on the current room. Room connectors are CSS bars, not images.
- Tile URLs use `import.meta.env.BASE_URL` so the GitHub Pages `/crawler/` base works. `trap-sprung.png` is optional and falls back to `trap.png`.

### Milestone 4b: grid combat, mob packs, junk and crafting

Inserted before Milestone 5 at the player's request (see the build-order row in SPEC.md). Built on the `grid-combat-crafting` branch.

#### Combat refactor and fixes

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

#### Mob packs

- **Ordinary fights are packs, never a lone enemy.** Chambers and other rooms roll `pack` (2-4 enemies on Floor 1) and corridors roll `corridor` (2-3). Lairs still roll an elite on the first visit. The ranges live on the floor theme as `encounters` in `floors.json`.
- **Minion tier.** Pack members are minions:
  - Two levels below a mob (minimum 1), so stats shift down 2.
  - 60% of a mob's HP multiplier and 60% of its XP.
  - No mods.
  
  A Floor 1 rat minion has about 5 HP and dies to one good hit. Mob and elite are unchanged; the boss tier arrives with Milestone 9.
- **Two families per pack at most.** The first family fills what its `groupSize` allows. A second family fills the rest, or joins anyway 35% of the time (`mixedChance`). If two small families still come up short of 2, the first family is topped up past its cap rather than leaving a lone enemy. Family `groupSize` now means "how many of this family a pack can hold": rats and leeches 2-4, goblins 2-3, the rest 1-2.
- **Elites** are alone half the time (`eliteAloneChance`). Otherwise 1-2 minion escorts of the same family join them, instead of full mobs.
- **Marks.** Same-named enemies get letters at combat start ("Sump Rat A", "Sump Rat B"), stored in `Enemy.mark` and baked into the name, so `attack rat b` works in both modes. Name matching prefers an exact name, then a substring.
- **Speed.** Families have `speed` (tiles per grid turn; the crawler has 4): rat and imp 5, goblin and snake 4, leech and crab 3, shambler 2. They also have an optional fallback `glyph`.
- **Balance snapshot** (bands mode, Floor 1):

  | | Enemies per encounter | XP | Total enemy HP | Sim clear rate |
  | --- | --- | --- | --- | --- |
  | Before | 1.7 | 24 | 23 | 28% (300 runs) |
  | After | 3.0 | 20 | 18 | 41% (400 runs) |

  Packs hit more often but die faster; tuning is Milestone 13's job.
- **Test flakes fixed along the way:**
  - The explore revisit test could walk into a lair, where the guaranteed elite fight blocked the walk back.
  - The initiative test used the random crawler's kit, so a missed ambush shifted the forced dice.

#### Grid combat engine

- **Grid is the default** on this branch. A missing account setting means grid, and `set combat bands` switches back.
- **Arenas are generated per fight from the room's shape**:

  | Shape | Size | Obstacles |
  | --- | --- | --- |
  | Corridor | 9×4, or 4×9 when entered from north/south (the long axis follows you in) | 1-2 |
  | Small | 6×6 | 1-3 |
  | Chamber (also lairs and event rooms) | 8×8 | 3-6 |

  - **Doors.** Each room exit gets one door tile in the middle of that edge; the one you came through is the entry.
  - **No walls.** Obstacles are single-tile props, and the board edge is the wall. There's no wall auto-tiling, so the art list stays short.
  - **Dressing.** 0-2 terrain patches of 1-3 tiles, plus 0-1 standing hazards. All of it comes from the theme's `arena` lists in `floors.json`, with features defined in the new `arenaFeatures.json`.
  - **Reserved tiles.** Door tiles, the tile just inside each door, and spawns are never furnished.
  - **Validation.** Every enemy and every door must be reachable from the crawler. If not, it rerolls up to 20 times, then drops the furniture.
  - **Not cached.** Arenas aren't saved on the room, so a rematch gets a new board.
  - **Trap rooms.** A trap type can name an `arenaHazard` for fights in that room. Trap rooms don't roll encounters yet, so it's groundwork.
- **Spawns:**
  - **You** start just inside the entry door. With no entry (tests), the middle of the west side.
  - **Normal enemies** spawn at distance ≥ min(4, the farthest open tile − 1), clustered within 2 tiles of the previous one. Ranged families take the farthest tiles.
  - **Enemies that won initiative** spawn 2-3 tiles away and still take their ambush turn.
  - **Elites** take the farthest tile nearest the far centre.
- **Geometry:**
  - **Distance.** 8-way Chebyshev, so a diagonal costs 1. A diagonal step is blocked only when both orthogonal neighbours are obstacles.
  - **Bands.** They come from distance: close ≤ 1, near 2-3, far 4+. Each enemy's `range` is re-synced after every move, so `attack.range`, item ranges, `EnemyStrip` and bands-written content keep working unchanged.
  - **Line of sight.** Bresenham, symmetric, blocked only by `blocksSight` features (pillars, crates, smoke), never by units. Adjacent tiles always see each other. Anything beyond close range needs sight.
  - **Pathing.** Dijkstra with a fixed neighbour order (orthogonals first). Ties between equally good tiles go through `rng.pick`.
- **Turns.** SPEC's minor action becomes a movement budget:
  - **Speed.** The crawler moves 4 tiles (plus any `speed` modifiers); enemies use their family `speed`. Slowed (`noMinor`) caps movement at 1, hasted (`extraMinor`) adds 2, and terrain `moveCost` comes out of the budget (sludge costs 2).
  - **Moving.** `move` never ends the turn; any action does. Movement is set when the turn begins.
  - **Before your first command.** The view shows your full speed as available.
  - **Stun.** A stunned crawler's first command, even a move, ends the turn.
- **Attacking out of reach** walks you, with the movement you have left, to the cheapest tile from which your weapon reaches. If you get there you swing; otherwise the turn ends with `combat.cantReach`, the same contract as bands' auto-advance.
- **The pack bonus is the only positional rule.** An enemy attacking you while adjacent gets +1 to hit for each other living enemy also adjacent to you, up to +2, logged as `(+2 pack)`. There are no opportunity attacks, cover or facing.
- **Fleeing:**
  - **On a door tile.** The DEX contest runs only against enemies within 3 tiles that can see you and aren't stunned; with none, you're out automatically.
  - **Not on a door.** `flee` runs for the nearest one. If you reach it this turn, the contest happens right away; otherwise the turn ends.
  - **Where you end up.** The entry door returns you to `fromRoom`, at no time cost (as in bands). Any other door walks you into that room through `travel()`, with its time cost, traps and encounter roll.
  - **A failed flee** gives the chasers free swings.
- **Enemy AI** maps the existing tokens onto the board:
  - `attack` strikes if anything reaches, otherwise paths to the cheapest free tile from which an attack works and strikes if it arrives. Occupied tiles are off limits, so packs surround you naturally.
  - `keep_range` backs off to its preferred distance (close 1, near 3, far 5) while keeping sight of you.
  - `special_if_ready` moves into position for a ready cooldown attack if it can this turn.
  - Fleeing enemies run for the nearest door. Ending a move on a door means they escape, for no XP.
  - Hazards an enemy can see (`aiAvoids`) add 3 to its path cost.
  - **Stall guard.** An enemy that neither attacks nor closes in for two turns ignores `keep_range` for a turn.
- **Hazards** fire `enter` effects on every tile a unit steps into (including tiles it's pushed into) and `stay` effects at the start of the turn of a unit standing on them. `consumedOnTrigger` hazards vanish after firing. Placed hazards with `rounds` burn down at the end of each round.
- **Commands:**
  - Coordinates are chess-style: a column letter, then a row number from the top (`c4`).
  - `move c4`, `move 3 2`, `move ne 2`, and bare `n`/`ne`/`e`/… for one tile. In grid fights, `go north` means a tile, not a room.
  - `attack c4` targets by tile.
  - `wait` passes.
  - `advance`/`retreat` spend your movement toward the nearest enemy or away from all of them, without ending the turn.
  - In a grid fight, `look` prints the board.
- **View:**
  - `view.combat.grid` carries every tile's feature, hazard and door, plus `move`/`attack` highlights and a `tap` command (`attack d5`, `move c4`, or `flee` on your own door tile), units with sprite and glyph, and loose items.
  - Every `tap` and button is ordinary command text, and a test checks each one parses and is allowed.
- **The sim** takes `--mode grid|bands|both` and prints rounds and damage per fight, the flee rate, and a grid-vs-bands delta. A fight past 60 rounds counts as stuck.
- **Snapshot** (300 runs each):

  | Mode | Clear rate | Rounds per fight | Damage per fight | Flee rate | Stuck |
  | --- | --- | --- | --- | --- | --- |
  | Grid | 33% | 4.7 | 15.4 | 28% | 0 |
  | Bands | 41% | 4.9 | 15.4 | 24% | 0 |

  Grid crawlers die more to "their own wounds": fleeing on a board takes several turns of walking while bleeding. Worth tuning once hazards and crafting land.

#### Grid combat client

- **The board** (`BattleGrid.tsx`) is a CSS grid of layered tiles: floor variant, door, feature, hazard, loose item, then the unit (with an HP pip, its A/B/C mark, a status count, and a gold outline for elites).
  - **Highlights come from the engine.** Walkable tiles are teal and hittable enemies have a red outline. The client paints flags; it never computes them.
  - **Tapping** submits the tile's `tap` command. Column and row labels make typed coordinates discoverable.
  - **Placement.** It sits above the enemy strip in the desktop battle panel. On phones it heads the battle screen, with a shorter log.
- **Sprites.** `Sprite.tsx` replaces the minimap's `Tile`.
  - **Fallback chain.** It tries each path in order, then the glyph.
  - **Failed URLs are remembered** module-wide, so a missing PNG costs one 404 per session rather than one per cell.
  - **Fixes a minimap bug.** A cell no longer stays stuck on a glyph when its tile changes.
  - **Combat art** lives in `public/combat/<folder>/<id>.png`, and `public/combat/README.md` is the manifest.
- **Armed targeting.** A command with `targets` (the next phase's throw and shove) arms when clicked instead of submitting. Tapping a highlighted tile submits `<command> <coord>`, and tapping anywhere else or pressing Esc cancels. Every button is still command text.
- **The combat toggle** is in the mobile corner menu and the desktop event-log header ("combat: grid ⇄"). Both submit `set combat …`.
- Checked in headless Chrome at 1440×900 and 390×844 with no combat art (glyphs only). The board fits a phone without sideways scrolling, and tap-to-move, tap-to-attack and fleeing enemies all work end to end.

#### Junk and the minimal inventory (pulled forward from Milestone 5)

- **Pulled forward:**
  - room contents: `Room.items` (in plain sight) and `Room.hidden` (found by `search`)
  - loot tables (`lootTables.json`)
  - `take` / `take all` / `pick up`, `drop`, and `equip` / `wield` / `unequip`
  - a hard weight cap at `carryLimit`
  - consumable stacking by base id
  - `ItemInstance.onHit` and `crafted`
- **Still Milestone 5:** the generator (materials, rarity, affixes), shops, enemy drops and identification. Junk bases keep `generate: false`: seeding goes through loot tables, so `generate` still means "the Milestone 5 generator may roll this".
- **Seeding** runs in `accept`, right after `generateFloor()`, as `seedFloorLoot()`, so the map generator and its tests stay about the map. Per room type (`floors.json` → `loot.rooms`), visible / hidden counts:

  | Room | Table | Visible | Hidden |
  | --- | --- | --- | --- |
  | Treasure | treasure | 2-3 | 1-2 |
  | Lair | junk | 1-2 | 0-1 |
  | Chamber | junk | 0-2 | 0-1 |
  | Trap | sharp | 0-1 | 1 |
  | Corridor | junk | 0-1 | 0 |
  | Empty / puzzle / event / NPC | junk | 0-1 | 0-1 |
  | Safe | bind-only supplies | 1-2 | 0 |
  | Stairwell | none | — | — |

- **The first safe room** (nearest the start) always holds a lead pipe, thumbtacks and duct tape, so the first craft is waiting at the first bench.
- **Workshops.** Every safe room has a workbench. 1-2 more chamber, empty or puzzle rooms (not corridor-shaped, not the start, at least 3 steps from any safe room) get one too, plus 1-2 extra junk on the floor and a description line. Once visited, a workshop shows on the minimap as `workshop` (glyph ⚒, optional `tiles/workshop.png`).
- **Room blocks** list what's on the floor (`roomEntered.items`) and flag a workbench. `look` repeats both, and the first three items plus "Take all" become buttons.
- **`search`** moves hidden items onto the floor (with the `explore.searchFound` line) and still costs 15 minutes. With nothing hidden, the old `explore.searchNothing` joke plays.
- **Weight.** A hard cap with no encumbrance status. `take` moves as much of a stack as fits and leaves the rest; if nothing fits, the System AI says so. Taking and dropping cost no time.
- **Equipping** displaces the slot's item. A two-hander also clears the off hand, and an off-hand item knocks a two-hander out. Rings fill ring1, then ring2. Mid-fight, `equip` costs the minor action (bands) or 1 tile of movement (grid).
- **Name lookup** for take, drop, equip and crafting ranks candidates as: exact name, then whole words, then substring. So "tape" means all the tapes, and "duct tape" means one.
- **Junk content:**
  - **New parts.** 23 consumables (type `junk`, with no effects, so `use` replies "combine it").
  - **New outputs.** 5 crafted consumables (caltrop pouch, garage bola, trip wire kit, glue trap, duct-tape splint).
  - **New gear.** 6 junk weapons and shields (lead pipe, rebar, two-by-four, broom handle, table leg, trash can lid), plus 6 crafted ones (pipe spear, glass shiv, padlock in a sock, inner-tube sling, magazine armor, strapped trash-lid shield).
  - **Existing items join through tags only:** duct tape, gaffer tape, superglue, jacks, chains, hammers, hairspray, the bat, the crowbar, the existing lighter fluid, and so on.
- **Craft tags:** `bind sharp haft cord elastic pouch weight battery wire fuel wick bottle spark padding plate hammer`. An item's effective tags also include its weapon type and `weapon` / `armor` / `slot:<slot>`. Item details list its parts and weight.
- A test keeps a fully explored, seeded floor's save under 250 KB.

#### Maneuvers and hazards

These are available to every crawler, so early fights aren't just trading swings.

- **`shove [name]`.** Opposed d20 + STR + athletics against the target's d20 + max(STR, DEX); you must be adjacent (grid fights auto-approach first).
  - **Win:** the target is pushed one tile directly away. If something is on that tile, its `enter` effect fires. If the push hits the board edge, an obstacle or another unit, the target slams into it for 1d4 and stays put.
  - **Bands:** a win pushes it out one band.
  - A braced target (`noShove`) doesn't budge.
- **`throw <item> [at <tile|name>]`.**
  - **Grid:**
    - Range is 3 tiles with line of sight, and a throw always lands on the tile (no roll).
    - `target` effects hit whoever is standing there.
    - `all_enemies` effects hit the 3×3 around the tile, including you if you're inside it (a molotov at your feet is your problem).
    - A consumable with a `hazard` field leaves that hazard in a `single`, `plus` or `square` shape. It replaces any hazard already there and never lands on an obstacle.
    - With no target given, it picks the nearest enemy you can hit.
  - **Bands:** `target` hits the named (or first) enemy, `all_enemies` hits them all, and hazards are ignored.
  - **`use`** on a throwable in a grid fight means throwing it at the nearest target.
  - **Hazard throwables:** caltrops (jacks, the caltrop pouch), marbles (ball bearings, the bag of marbles), oil (lotion), glue (superglue, glue trap), trip wire, smoke (blocks sight, 3 rounds), and fire (molotov 3×3, aerosol torch, lighter fluid; 3 rounds).
- **`dash <tile>`** (grid): move up to your remaining movement plus your speed again; it ends the turn.
- **`defend`**: the new `braced` status gives +4 defense and blocks shoves. Its new `endsOnTurnStart` flag drops it when your next turn begins.
- **Loose junk on the board.** The room's floor items, plus 0-2 scrap from the theme's `arena.scrap` table, are scattered on free tiles when a grid fight starts.
  - `take` (or tapping the tile) picks up something on your tile or an adjacent one, for 1 tile of movement. It's refused if you can't carry it.
  - `wield` readies a weapon for another tile of movement.
  - When the fight ends, whatever is still on the board goes back on the room's floor.
- **Buttons:** Shove, Throw <item> (the first two throwables) and Dash carry `targets`, so they arm and wait for a tile. Defend is a plain button. Take buttons appear for junk within reach.
- **Snapshot** (300 runs each):

  | Mode | Clear rate | Rounds per fight | Stuck |
  | --- | --- | --- | --- |
  | Grid | 39% | 4.6 | 0 |
  | Bands | 37% | 4.9 | 0 |

  The sim doesn't shove, throw or craft yet.

#### Crafting

- **Recipes are discovered, not listed.** `combine <things>` at a workbench (any safe room, or a workshop). Out of combat only; in a fight it gets `command.notNow`.
  - **On a match:** it's made, and the recipe goes in your book (`crawler.recipes`, with a `recipeLearned` event).
  - **On no match:** the System AI insults you and 5 minutes pass. Nothing is used up.
  - **Names you aren't carrying:** a free error, since that's a typo, not an attempt.
  - **At the wrong spot:** away from a bench it's refused, with no cost.
- **`recipes.json` is tag-based:**
  - **Inputs.** Each takes any-of `tags` or an exact `id`, plus `qty` (from one stack or several items), `consumed` (`false` for tools like the hammer), and `base` (the item an upgrade improves).
  - **Outputs.** Either a new `item`, or an `upgrade` (prefix, damage bonus, die step, damage type, armor bonus, modifiers, on-hit status, range, tags).
  - **Extras.** An optional check (stat + skill vs a DC tier, with a mishap on a critical failure), the minutes it takes, a priority, a cryptic hint, and a success line.
- **Matching:**
  1. The typed text splits on `,` `+` `&` `and` `with`; otherwise every grouping of the words into 2-4 names is tried, fewest pieces first.
  2. Each name resolves to candidates (exact, then whole word, then substring).
  3. The search tries candidate choices × recipes × input slots. Every named item must fill a slot and every slot must be filled.
  4. The most specific recipe wins: an id counts 4, a single tag 2 and a tag list 1, plus 1 per input, plus `priority`. Ties go to file order.

  This settles ambiguous names ("tape" picks whichever tape makes a recipe work) and extra junk (an unrelated fourth item means no match).
- **Upgrades are baked in.** The name gains a prefix, the dice change (`addToDice`, plus a new `stepDice` d4→d6→…→d12), `onHit`/armor/modifiers are added, and `item.crafted` records the recipe id. Each recipe applies once per item, and an item takes at most two upgrades. The item keeps its uid, so equipped gear stays equipped. When Milestone 5 arrives, crafted prefixes become an affix group, so crafted gear can still roll loot affixes.
- **New items** auto-equip into a free slot. Consumed parts come off their stacks, and equipped parts are unequipped first.
- **A failed check** ruins one random consumed part (one unit), but the recipe is still learned, since you found the combination. A critical failure also applies the recipe's mishap (barbed wire cuts, electro-wiring shocks, molotovs set you burning).
- **The new `tinkering` skill** (INT, utility; +2 at rank 5) feeds the harder checks. Nobody starts with it, and the Junk Engineer class can grant it in Milestone 11. Other checks use DEX, `trap_engineering` or `explosives_handling`.
- **`craft <name>`** makes a known recipe, picking the parts itself: your equipped weapon is preferred as the upgrade base, and unequipped, cheaper junk as parts. At a bench, the first three makeable known recipes become buttons.
- **Hints:**
  - **In the book.** The recipe book (`recipes`, free) shows up to 3 cryptic hints, only for unknown recipes you're carrying every part for.
  - **On pickup.** The first time a pickup makes an unknown recipe possible, the System AI drops its hint once (`craft.idea`, tracked in `crawler.ideas`).
- **The 19 starter recipes:**
  - Upgrades: nail bat, hammered-in nails, barbed wrap, live wiring, taped grip, magazine lining.
  - Weapons: pipe spear, glass shiv, padlock in a sock, inner-tube sling, garage bola.
  - Traps and throwables: caltrop pouch, trip wire, molotov, aerosol torch, glue trap.
  - Armor and healing: magazine armor, strapped trash-lid shield, duct-tape splint.
  - Tests check that every input can be filled by some item in the content, and that the first safe room's kit makes a nail bat.
- **Client:** a recipe book sheet (mobile menu → Recipes, and in the desktop inventory overlay) with ✓ for recipes you can make now, a "make" button at a bench, and the hints. Learned recipes also print as a log divider and show in the System AI ticker.

#### Sim and balance snapshot (end of Milestone 4b)

- `npm run sim -- <runs> [--mode grid|bands|both] [--craft]`.
  - `--craft` adds a policy: pick up everything, try any makeable recipe (up to 3) at each new bench, wield the hardest-hitting weapon, and throw junk at packs of 2+ in the first two rounds.
  - The auto-player only drinks potions that can be used in combat.
  - A stuck run now reports its last log lines.
- **Snapshot** (400 runs each, Floor 1):

  | Configuration | Clear rate | Rounds per fight | Damage per fight | Flee rate | Crafted per run | Stuck |
  | --- | --- | --- | --- | --- | --- | --- |
  | Grid | 35% | 4.8 | 16.4 | 33% | — | 0 |
  | Bands | 40% | 5.0 | 15.9 | 25% | — | 0 |
  | Grid + crafting | 37% | 4.5 | 14.9 | — | 5.2 | 0 |
  | Bands + crafting | 44% | 4.8 | 14.8 | — | 5.4 | 0 |

  Grid sits within the ±10-point target of bands, and both fall inside the 3-6 rounds per fight target. Tuning toward the spec's 30-60% Floor 3 target is Milestone 13's job.
- **Open questions for after the playtest:**
  - Keep bands as a text-only mode or drop it.
  - Whether the free round-1 retreat through the entry door needs a cost.
  - Whether trap rooms should host fights (their `arenaHazard` is already wired).
  - Whether arenas should persist per room, so caltrops you placed are still there on the rematch.

#### Combat art pass

- **First art set.** It's installed under `packages/client/public/combat/`: floors, door, units, obstacles, terrain, hazards, UI overlays and six status icons. The source folders were renamed to the singular names the code expects. Status icons are renamed to status ids: the "shock" icon is `stunned` and the "freeze" icon is `slowed`, since there's no frozen status. Art the board can't use yet (flat clutter, connecting pipe pieces) stays in the repo-root `sprites/` folder.
- **Cropped sprites are fine.** Each layer scales to fit its square, so there's no need for 128×128 canvases.
- **Floor variants are weighted.** `arena.floorWeights` (one integer per variant, validated) picks a variant from a stable position hash. The Undercroft uses 10/1/3/1, so the plain flagstone dominates and moss, grate and brick are accents instead of a patchwork.
- **21 props are new obstacles:** appliances, storage, bathroom fixtures and the trash can. Tall ones (fridge, shelf, rack, file cabinet, toilet stall, shower) block sight. They're in the Undercroft's obstacle list at half or quarter weight, so the original eight still make up about 70% of picks.
- **Highlights** use the `ui/` sprites (move at 55% opacity, aiming targets at 70%), with the old CSS tints as the fallback. They draw under units, so an attackable enemy is framed rather than hidden. `Sprite` gained a `fallback` element for this.
- **Status icons:** up to two on a unit's top-right corner plus "+N", with a first-letter badge for statuses that have no art. The unit view carries `statusIds` for this.
- **The crawler** gets an amber selection ring at its feet, because the art reads as a monster.
- **Small debris hazards** (caltrops, tacks, glass, marbles, barbed wire, spikes, trip wire) get a CSS dark outline and a slight brightening, so they read on grey stone at 44px without editing the art.
- **Furniture and carts:** 23 more obstacles (carts, tables, benches, the vise workbench). They're low furniture, so they block movement but not sight.
  - **Undercroft:** the 18 industrial and creepy pieces join its list at weight 0.25, so the original eight are now about 59% of obstacle picks.
  - **Floor 2:** park and wood benches, the padded bench, the café table and stools, and the food-service cart are defined but held back for the Drowned Mall.
  - **File size:** the masters were 180-314px (1.6 MB), so the published copies are resized to fit 128px with Lanczos (607 KB). The masters stay in `sprites/furniture_carts/`.
  - Every arena feature now has art.

### Combat rework: action points, power rolls, easy and hard pools

Asked for after the Milestone 4b playtest: a small AP system, damage on every attack in the style of Draw Steel instead of D&D hit-or-miss, and much easier early enemies (a Floor 1 clear rate near 50%, with the first few fights from an easy pool and the rest from a hard pool). SPEC.md's Combat, Grid mode and Enemy generation sections are amended to match. Saves are bumped to version 5; older saves are discarded.

#### Action points

- **3 AP a turn** (`rules/ap.ts`). Attack 2, move 1, shove/throw/defend/item/dash 1, flee and talk 2. The turn ends itself at 0 AP; `wait` ends it early. The "one action plus a minor action" rule and the per-turn movement budget are gone.
- **Hasted is +1 AP and slowed is -1 AP.** They no longer change tiles per move. The status flags are renamed `apUp` and `apDown`.
- **Movement is bought.** 1 AP pays for your speed in tiles (4), which can be spent across several moves. Walking farther than what's paid for buys another AP's worth automatically, so one `move` can cost 2 or 3 AP. The board dims tiles that cost 2+ AP.
- **An attack you can't finish is refused, not wasted.** Out of reach, the crawler walks in only if AP for the swing would be left. Otherwise the command is an error that costs nothing and suggests `advance`. Bands works the same way at 1 AP per band.
- **Weapon AP costs.** Weapons default to 2. The 65 weakest joke weapons (old 1, 1d2 and 1d3 dice) and bare hands cost 1. The six old 1d10 two-handers cost 3 and went from 3/6/9 to 4/7/10.
  - The flat stat bonus scales with the cost (`floor(stat * apCost / 4)`), so three 1-AP pokes don't triple-dip the stat. Without this, light weapons out-damaged everything.
- **Dash** costs 1 AP, covers double speed and still ends the turn. With AP it's mostly a last-AP sprint.
- **Defend no longer ends the turn.** It's 1 AP, so swing-then-brace is a normal turn.
- **Picking up junk and swapping gear** on the board still cost one tile of movement (which may mean buying an AP's worth). In bands a swap is 1 AP.
- **A failed flee still ends the turn** after the free swings. On the board, `flee` spends whatever AP it takes to reach the nearest door and needs 2 AP left to go through it.
- **Enemies get 3 AP, elites 4.** The plan said minions 2, but with a 2-AP attack a 2-AP minion could never move and swing in the same turn, and attack-then-step-back would have beaten every melee pack for free. Elites next to you swing twice.
- **Hit and run is now possible** (swing for 2, step away for 1). Slow enemies such as the mold shambler and gutter crab can be kited on open boards. The sim's policy doesn't do it, so a careful player will beat the sim's numbers.
- **Buttons carry their AP price** and grey out when you can't pay (`CommandOption.ap`, `.disabled`). "Wait" is labelled "End turn".

#### Power rolls

- **2d10 + floor(stat/2) + skill rank + attack mods**, tiers at 11 or less / 12-16 / 17+ (`rules/power.ts`). Nothing misses, and damage is never below 1 after armor.
  - **Half the stat, not the full stat.** The plan said full stat. Stats here run 3-12, so a full stat pinned the crawler at tier 3 and made tier 1 nearly impossible. Half the stat keeps all three tiers live for both sides.
- **Crit** is a natural 19-20: tier 3 whatever the total, and the crawler gets 1 AP back. Enemies get the tier but no AP.
- **Edges and banes** are ±2 each, net, capped at two.
  - The pack bonus is now an edge per other enemy next to you, up to two. Bands mode gets the same edge from other enemies at close range, so the modes stay comparable.
  - "Defense" modifiers (braced +4, hasted +2, blinded -3, slowed/feared/confused -2, and the enemy mods Tiny, Greasy, Rabid and Enormous) are now **guard**: every 2 points is a bane on attackers, every -2 an edge.
  - Numeric attack penalties (poisoned -2, blinded -5) still apply straight to the roll.
- **Armor is flat damage reduction** for both sides. DEX no longer adds to defense, since there's nothing left to dodge.
- **Invisible** is a double bane on anything attacking you. It used to be an automatic miss, which can't exist any more.
- **Status riders:** never at tier 1, the listed chance at tier 2, always at tier 3.
- **Content.** Weapon `damage` dice and enemy attack `dice` became `power: [t1, t2, t3]`.
  - Weapons were converted from the dice average (about 0.6x, 1.1x and 1.6x): 1d4 is 2/3/4, 1d6 is 2/4/6, 1d8 is 3/5/7.
  - Enemy attacks were set by hand and are lower than that formula, because they now land every time: for example the sump rat's bite is 1/2/3 and the gutter crab's clamp is 2/3/5.
  - Crafting: `damageBonus` adds to every tier, and a `damageStep` adds 1 at tier 2 and 2 at tier 3.
- **Still dice:** thrown consumables, hazards, traps and status ticks. They were never attack rolls and already always land.
- **Still d20:** initiative, flee, talk, shove, and every check outside a fight.
- **Narration:** `combat.playerMiss` and `combat.critFail` are replaced by `combat.tier1`, `combat.tier2` and `combat.tier3`, each said on about a quarter of swings.
- The skill-perk tags that combat never read (`critRange`, `perk:*`, `damage:<type>`) are still unread.

#### Easy pool, then hard pool

- `floors.json` → `encounters` gained `easyFights` (3), `easyPool`, `hardPool`, `easyPack` ([1, 2]), `easyLevelOffset` (-1), `levelOffset` (0) and `mobChance` (0.25). `FloorState.fights` counts fights started on the floor.
- **Floor 1 easy pool:** sump rat, drain leech, scrap goblin. One family, 1-2 minions, a level down. A lone enemy is allowed here.
- **Floor 1 hard pool:** all seven families, in the full 2-4 packs.
- **The first three fights are always easy, lairs included.** A lair entered that early holds a small easy pack instead of its elite. Without this, about a quarter of runs died in their first three fights to an early elite.
- **Mobs finally spawn:** 25% of hard packs of 3+ are led by one mob in place of two minions.
- `levelOffset` is left at 0. The easy pool and the lower enemy damage were enough to reach the target.

#### Balance snapshot

`npm run sim -- 400 --mode both [--craft]`, Floor 1. The auto-player swings while it has AP, closes in when out of reach, and braces with a leftover AP.

| Configuration | Clear rate | Rounds per fight | Damage per fight, fights 1-3 | Damage per fight, later | Died in fights 1-3 | Stuck |
| --- | --- | --- | --- | --- | --- | --- |
| Grid (default) | 46% | 2.9 | 1.8 | 14.8 | 1% | 0 |
| Bands | 52% | 3.0 | about 1 | about 13 | 0% | 0 |
| Grid + crafting | 54% | 2.9 | 1.7 | 13.1 | 0% | 0 |
| Bands + crafting | 68% | 2.9 | about 1 | about 10 | 0% | 0 |

- Before the rework the same sim cleared 35% (grid) and 40% (bands).
- Fights are shorter than the old 3-6 round target, because a round now holds up to three actions.
- **The step from easy to hard is steep** (about 2 damage a fight to about 14). That is what was asked for, but it's the first thing to soften if it feels like a wall: raise `easyFights`, or lower `levelOffset`.
- **"Their own wounds" is the top cause of death.** Bleed and poison land more often now that every hit connects and tier 3 always applies its status.
- Bands with crafting is above the target. Crafted weapons are worth more when every swing lands.

### Workbench picker and phone layout

- Crafting by discovery used to be typed only (`combine bat tacks tape`), which a phone's map screen can't do. The recipe book now has a workbench picker when you're at a bench: tap two or more pack items, hit Combine. It submits the same `combine` command, so the engine rules are unchanged.
- The picker sends full item names separated by ` | `. `splitNames` treats a bar as the only separator when one is present, because real item names contain commas, "and" and "with" ("Laptop, Closed", "DSLR with Flash").
- `ItemView.parts` exposes an item's crafting roles (bind, sharp, haft...) so the picker can label each item. The roles are shown outright; which roles a recipe wants is still for the player to find out.
- On a phone the "Recipes" command button is replaced by a "⚒ Workbench" button that opens the crafting screen, and that screen shows the last four log lines so the result of a try is visible without leaving it.
- Phone map, event log and battle log can each be hidden; the choice is a per-device UI preference in `localStorage` (`crawler.ui.*`), not game state.

### Tablet layout, map arrows, and two combat fixes

- **Three shells.** Phone is under 700px wide. Tablet is 700px and up on a touch screen (`(any-pointer: coarse)`, so an iPad with a keyboard attached still counts). Everything else is the desktop dashboard. The phone cut-off moved down from 900px so an 11-inch iPad in portrait (834px) gets the tablet shell. A "Layout" switch (auto, tablet, desktop, phone) in each shell overrides the detection and is saved per device.
- **Tablet shell.** Landscape: map or battle board on the left with the action bar under it, log and sheets (Character, Gear, Pack, Crafting, Effects) on the right. Portrait: board on top, log and sheets side by side under it, actions along the bottom. The plan said the portrait sheets would slide over; side by side was simpler and fits a 1024px-wide screen.
- **Map arrows.** On the tablet, walking is an arrow on each neighbouring map cell that has an exit; the whole cell is the tap target (54px or more). Direction buttons are left out of the action bar there. The phone keeps its d-pad.
- **Niche commands.** `CommandOption.niche` is set by the engine: Shove, Throw, Dash, Talk, Flee in a fight; Recipes, Map, Look, Help outside one. The tablet puts them behind "More", with the combat-mode switch, a "Type a command" line and the layout switch. Rest stays a main button because it is how you heal.
- **Unwieldy weapons.** The six 3-AP weapons (sledgehammer, felling axe, fire axe, speargun, heavy bowling ball, barbell) could never step and swing in one turn, so anything that kept its distance beat them: a sledgehammer crawler died in 57 of 150 first fights. They now cost 2 AP and are `unwieldy`: the swing ends your turn. Their stat bonus still counts as a 3-AP swing, so damage per hit is unchanged.
- **Attack closes in.** Attacking something too far to reach and still swing no longer errors. Grid: you walk as close as your AP allows. Bands: you step closer as far as your AP allows. It only errors when there is no way to get closer.
- **Sim after these changes (400 runs, Floor 1):** grid 51% clear, bands 58%, no deaths in the first three fights. Bands is a little over the 45-55% target; left alone because grid is the default mode.

### Milestone T: the thread layer

Pulled forward ahead of Milestone 5, the way 4b was, when the story design doc and its workbook arrived. Built on the `grid-combat-crafting` branch.

#### Docs and sources

- **One design file.** `docs/SPEC.md`, `DECISIONS.md` and the story design doc were merged into this file. The old spec is the base, amended in place; the decision log is the old `DECISIONS.md` with its headings moved down a level.
- **The workbook is the content source of truth.** Its sheets are exported as CSV to `content-csv/workbook/` (one file per sheet, named after the sheet) and imported with `npm run import:workbook`. The importer writes only the text columns and keeps every engine field in the JSON (module parts and effects, boss gates, Codex line lists, item stats, delivery chances). Entries that exist only in the JSON are kept. Running it twice changes nothing.
- **Archived sources.** The old spreadsheet imports (`dcc_game_data.xlsx`, the per-table CSVs and `writing-backlog.xlsx`) moved to `content-csv/archive/`. Nothing reads them; they're the record of where those tables came from. The Undercroft's floor theme (Alex's original Floor 1 writing) is archived there as `floors.undercroft.json`.
- **Workbook wording that was changed on import.** The Fern Matriarch's Codex weakness said "Stray's hum" in the workbook; the game says "Echo's hum", per the design doc. The workbook cell was updated to match (rev 22).
- **Recipe entries written for the workbook.** The workbook had Codex recipe entries for only Glow, Rope Bind and Suture. The other 11 modules' recipe entries were written in the same voice, first as drafts in `codex.json`, then added to the workbook's Codex sheet in module order (rev 22). `draft: true` in the Codex schema stays available for JSON-only entries that aren't in the workbook yet; none are left.

#### Decisions made with the player

- **Floor themes.** Floors 1-3 were re-skinned to the Welcome Lobby, the Lost-and-Found Warrens and the Flooded Parking Garage. The generator, combat and encounter tuning are unchanged.
- **Race and class** stay at the Floor 3 Selection Booth, not run start.
- **Run model** is the union: legacy points, unlocks and the bequest stay, and the account gains the thread Codex and run history.
- **Bosses.** Floors 1-4 get a smaller, optional boss that doesn't touch the stairs; Floors 5+ get a boss on the obvious stairwell. Claude-run turns, freeform rulings and the fallback AI stay (Milestone 10); the weakness is engine-enforced on top. District bosses are replaced by the floor boss; districts stay as map regions (Milestone 9).

#### Gaps in the design doc, and the defaults chosen

1. **Echo's stage follows the floor's act**, not the Wholeness number (Floor 5 starts at 32%, inside the Cautious band, but it's Act 2). Wholeness is shown, and is the Host's weakening.
2. **Shard delivery:** 10% on each first visit to a room other than the start, 60% for the boss throwaway when a boss fight starts. No pity timer. Both are in `thread.json` → `delivery`. The sim finds about 2.5 of a floor's 4 shards per run that reaches it; that is generous, and the first number to lower if the Codex fills too fast.
3. **Recipe entries for every module** (see above).
4. **"Stray's hum" became "Echo's hum"** (see above).
5. **Boss gating.** Floors 1-4: the mini-boss is optional and every stairwell stays open. Floors 5+: the boss stands on the stairwell nearest the start; the others are hidden until `search`, Glow, Fault Sense or Echo's "listen" urge finds them, and at least one hidden one is always reachable without passing the boss (a floor that fails this is carved again). Wholeness advances when you descend, not when the boss dies. On Floors 1-4 the boss throwaway shards (S04, S08, S12, S16) and the boss-weakness Codex lines only come from seeking the boss out, so they're rarer than room shards.
6. **Rue's Braid Tie** nudges Temper (Calm 1) each time you change floors carrying it.
7. **Workbook strings are treated as final.** The Thread sheet is mostly "Draft" and The Mother Below is "Needs your input"; re-importing picks up any edits.
8. **Echo's Angry-stage behaviors** (a free action per floor, refusing commands) and Soothe are deferred to Act 3 and Floor 4. Nothing on Floors 1-3 needs them.

#### Echo, Temper and the Codex (engine)

- **State.** `GameState.echo` holds the vessel, Temper, built modules, shards found this run, a pending urge and the per-floor counters. `SAVE_VERSION` is 6, so version-5 run saves are discarded as before. `ACCOUNT_VERSION` is 2, and a version-1 account is **migrated**, not discarded: it gains an empty thread Codex and keeps its legacy points, unlocks and counts.
- **Echo's voice.** Echo lines are narration with `voice: "echo"`, in their own color, routed to the battle log as well as the event log. Shard reactions are printed verbatim from the workbook; everything else is an `echo.*` template whose variants can condition on `echo.act` and `echo.side`. Floors 1-3 are Act 1, so the unconditional variants are written in the Act 1 voice (fragments, hedging, apologies); the common lines also have Act 2 and Act 3 variants.
- **Temper caps.** Every source has an optional per-floor cap (`temper.json` → `sources`): resting and sleeping count twice a floor, feeding twice, damaging modules twice, urges every time. Without the cap, ordinary resting pinned every run at Calm 5.
- **The Codex.** Locked lore entries hide their name and show how many fragments are already recorded; boss weaknesses and recipes show their names. Each lore entry's `lines` list says which shards fill it in; the importer defaults it by strand, with the Host (S41, S44) and the Harvest (S45) split out of Echo's Past and The Cut.
- **Run history** keeps the last 50 runs: crawler, deepest floor, outcome, shards found, final Temper and vessel. A death, a quit and descending past the deepest built floor each record one.
- **Feeding** takes only junk-type consumables, and Echo refuses (keeping the item) once the floor's cap is reached.

#### Modules

- **Unlocking and building.** A module is buildable once its shard has been found this run. Knowing the recipe from an earlier run doesn't skip the shard. `craft <module>` at a bench uses the parts by item id and takes the module's minutes (30). Module parts are new junk items, scattered 5-7 per floor from `parts_f1`..`parts_f3` (some hidden); Glow uses the existing D batteries and Rope Bind the existing yellow nylon rope.
- **Effect bags.** Each variant's bag in `modules.json` is complete on its own, and the bags of every built module are merged (numbers take the larger, flags OR). The variant is read at the moment of use, so Temper changes apply immediately.
- **What each one does now:** see the Modules table. Departures from the workbook text:
  - Salt Reader (Calm) neutralizes poison at the start of your next turn or room, not the instant it lands, because statuses land in many places and only those two are a single choke point.
  - Glow (Fed) "refuses to dim" is flavor only for now (no stealth system to cost).
  - Lost Property Index (Fed) adds `sellBonus`, which does nothing until shops (Milestone 7); its "some NPCs turn hostile" waits for NPCs.
  - Nervous Ping's "warns 1 turn before an ambush" is implemented as calling out the ambush at the start of the fight: you act first.
- **Tether** is a new status with a `noMove` flag: tethered enemies can't move (grid speed 0), change band, or flee.

#### Floor bosses

- **Placement.** Mini-boss lairs are dead ends at least 40% of the floor's depth from the start, not next to a stairwell or safe room; if there's no such dead end, any room that doesn't cut the stairs off. The lair's room type is `lair`, so it has lair loot.
- **The fight.** A boss is its `bosses.json` stat block spawned at the new `boss` tier (3 AP, no mods) with the boss's HP and XP multipliers (2 and 5 for the Floor 1-3 mini-bosses). It fights every time you walk in until it's dead, and a rematch starts fresh. It says a taunt on 35% of its turns. The weakness can be triggered again (another tagged item, another ticket).
- **Weakness triggers built:** `decline` (the Mimic: declining twice gives it the "Politely Declined" status for the fight, flag `noAttack`), and `item` with a tag (the Golem: anything tagged `lost_property`, 3 rounds of `sorting`; the Kraken: the stamped valet ticket, 2 rounds of `parked`). Using the counter item is `use`, or `return`, `give` or `show`, 1 AP.
- **The Codex learns a weakness** when it triggers, when the boss dies, or when you pick up a hint item (`hintFor`: the Complimentary Eyeball for the Mimic, tagged lost property for the Golem, the stamped ticket for the Kraken, and the later floors' counters).
- **Counter items are placed on purpose:** 2-3 tagged lost-property items on Floor 2, 1-2 stamped tickets on Floor 3, and the Eyeball on Floor 1. Other oddities scatter 1-2 a floor from those whose floor range covers it.
- **The Floor 3 quest boss** still gates the Floor 3 stairs once the quest exists (Milestone 12). Until then Floor 3's stairs are open, and the Valet Kraken is its optional mini-boss. The design doc's "Milestone 1 ends with the Valet Kraken" is superseded.

#### Floors 1-3

- **Descending** now generates the next floor (with its boss and scatter) instead of ending the run. Descending past the deepest built floor (3) ends the run as a win. The collapse pushing you down a stairwell does the same, and `timePassed()` stops a handler from carrying on into a floor that has just been replaced.
- **Re-skin.** The Welcome Lobby kept the Undercroft's enemy families, encounter tuning and floor art (`arena.floorArt: "undercroft"`), on the reasoning that the Mother's drains come up through the lobby. Its room names, fragments, type lines, traps, workbench lines and arena dressing are new. The Undercroft-specific System AI lines (sewer bugs, "you beat a sewer") were rewritten.
- **New families:** Floor 2 has claim-tag moths, unclaimed suitcases, umbrella bats, odd-sock wraiths and finders keepers; Floor 3 has brake-line eels, hubcap crabs, oil slicks, valet imps and car alarms. Some families are tagged `lightSensitive` for Glow's flare. They use glyphs until they have art.
- **Tuning without leveling.** There's no level-up yet (Milestone 6), so deeper floors are tuned through `encounters.levelOffset`: -4 on Floor 2 and -6 on Floor 3. That keeps their enemies' level, and so their HP, near Floor 1's, with family stat blocks a step stronger. The umbrella bat lost 1 HP base and the suitcase 1 armor after the first sim pass.

#### Oddities (the workbook's I01-I30)

- Each oddity is registered as an item base or a consumable under its own id, so loot tables, the inventory and item details all work unchanged, and it keeps its workbook rarity (Unique is legendary).
- **Effects built now:** heals (Gummy Femur, Bag of Sunlight, Tooth Dust Pepper), the Emergency Cork curing bleeding, the Pocket Sink's slowing puddle, weapon power and on-hit statuses, armor, speed and CHA modifiers, the Jar of Smaller Jars' +8 carry limit (a new `carry` modifier), the Eyeball revealing a room's hidden things, Rue's Braid Tie, the Bone China Mouth's Temper per hit, and the boss counters.
- **Descriptive only for now:** the Lava Lamp's silhouette, the Clamshell Phone, the Candle, the Spare Shadow's misdirection (a guard bonus stands in), the Stitch Counter, the Handwarmer, the Cage Opener's buff removal, the Fork's "acts last". Their systems don't exist yet.

#### Client

- An Echo panel (vessel, Wholeness bar, the Temper track with the Calm and Fed bands marked, modules with what they do at this Temper) is on the desktop side, a tab on the tablet, and a sheet on the phone ("Echo & Codex"). The Codex opens as an overlay on desktop (the Codex button) and sits under the Echo panel elsewhere. `codex` and `echo` typed anywhere print a text version.
- The minimap draws `!` on a known boss lair, and rooms Echo has marked show their type before you visit.
- **Bug found by the smoke test:** command buttons were keyed by label, so two buttons with the same label (the engine's Codex command and the desktop's Codex button) made React leave copies behind on every render. Buttons are now keyed by label and command.
- Checked in headless Chrome at 1440×900 and 390×844: a run starts with Echo awake, shards and Echo's lines appear in both logs, the Codex overlay and the phone sheet render, there's no horizontal scroll on the phone, and the console is clean.

#### Sim and balance snapshot

`npm run sim` gained `--floors N` (default 1, so the Floor 1 numbers stay comparable). The auto-player answers urges with a coin flip, uses boss weaknesses when it can, binds or shouts with modules it has, and builds modules at any bench once their parts are in the pack. It reports shards found per floor, boss fights and weakness use, modules built and the final Temper spread.

| Configuration (400 runs) | Floor 1 clear | Reached Floor 2 | Reached Floor 3 | Cleared Floor 3 | Shards per floor | Mini-boss fought / won | Modules per run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Floor 1, grid | 49% | | | | 2.4 of 4 | 26% / 93% | |
| Floor 1, bands | 54% | | | | 2.5 of 4 | 28% / 93% | |
| Floors 1-3, crafting, grid | | 56% | 34% | 22% | 2.5 / 2.8 / 2.9 | 42% / 83% | 0.53 |

- Floor 1's clear rate is where it was before the re-skin (51% grid, 58% bands), and still nobody dies in the first three fights.
- About 30-35% of runs reach Floor 3, the bottom of the old spec's 30-60% target, without any leveling.
- The coin-flip urge policy ends runs about 45% Calm, 53% base and 2% Fed: resting pushes Calm and nothing in the policy feeds Echo. A real Fed run takes intent (feeding, letting Echo act, the Fed modules).

### Milestone 4c: floor tiling (Godot-style)

Asked for after Milestone T: a custom floor tiler that mirrors Godot's tiling, built on the `floor-tiling` branch. The rules are under Grid mode → Floor tiling.

#### Decisions made with the player

- **Scope:** terrain autotiling, plus random variants and flips. Godot's layers, animated tiles and patterns are left out.
- **Format:** both. Crawler's own JSON (`tilesets.json`) is what the game reads, and `npm run import:tileset` converts Godot `.tres` TileSets into it.
- **Ground:** the arena generator lays out terrain areas per floor, for looks only. Movement and combat don't read them, so balance is untouched.

#### How it maps onto Godot

- **Names follow Godot's:**
  - Match modes `cornersAndSides`, `corners` and `sides` are MATCH_CORNERS_AND_SIDES, MATCH_CORNERS and MATCH_SIDES.
  - The peering bits keep Godot's names (`right_side`, `bottom_right_corner` and so on).
  - Each tile has `terrainSet`, `terrain`, `probability`, `flipH`, `flipV`, `transpose`.
  - Sources keep their ids, region size, margins and separation.
- **Terrains are referred to by name, not index**, so hand-written JSON reads and diffs well. The importer turns Godot's indexes into names, slugging the terrain names ("Wet Concrete" becomes `wet_concrete`).
- **Flips apply in Godot's order:** transpose first, then flip_h and flip_v. A clockwise quarter turn is transpose + flip_h.
- **Godot alternative tiles carry their own bits.** In the JSON, an alternative that leaves out `peering` gets the base tile's bits turned to match its flip. Imported alternatives always spell them out.
- **Two shortcuts Godot doesn't have:**
  - `images` sources, one PNG per tile, so square-by-square art works without a sheet.
  - `transforms`, which generates the flipped and turned copies and splits the probability between them.

#### Matching rules (choices where Godot leaves it to the painter)

- **Godot paints terrains region by region, and the result depends on paint order.** Crawler always knows every square's terrain, so a bit takes the lowest terrain among the squares that share it. The terrain listed first sits underneath, and later terrains draw their own edges, as if the base were painted first and the others painted over it in Godot's "connect" mode. The bits always agree across a seam.
- **Scoring:** a wrong bit costs 2 and a wrong center 1, because a wrong bit shows as a seam. All equally good tiles go into one probability-weighted pick. Godot instead picks a pattern first, then a tile inside it.
- **An empty bit (Godot's -1) fits any terrain except the tile's own.** Godot matches -1 only against empty neighbours. Crawler's boards have no empty squares, so this lets a set painted with one terrain and blank edges work over a base.
- **The board edge repeats the square next to it**, so terrain runs off the edge instead of being framed.
- **In `corners` mode a terrain shows inset by half a square.** Godot's corner sets behave the same way, so the Garage's water blobs are 6-14 squares.
- **Random picks use a stable per-square hash** of the square and the arena's `lookSeed`. The board looks the same every turn and differs between fights.

#### Ground layout

- **Two area shapes cover the three floors:**
  - Lobby: a carpet strip 2-3 wide, on 0-1 per fight.
  - Warrens: 1-3 drifts of claim tags, 3-7 squares each.
  - Garage: 1-2 water blobs, 6-14 squares each.
  - Blobs grow from a random square and fill their notches, so their edges read as shapes.
- **Cosmetic randomness lives in `rng.ts`:** `hash32`, `hashUnit` and a seeded `cosmeticStream`. Nothing in it reads or advances the game's dice. The seed is a hash of the arena's layout, which is already random, so ground layouts cost no rolls.
  - A test builds the same arena with and without a ground layout and checks that the dice calls, tiles and spawns are identical.
  - Another runs the ground and tile code with the game's dice set to throw.
- **No save bump.** `ArenaState` gained optional `ground` and `lookSeed`. A fight saved before this draws the base terrain everywhere.

#### Content and art

- **`floors.json` → `arena` lost `floorArt`, `floorVariants` and `floorWeights`.** In their place are `tileset` and `ground`. The Undercroft's 10/1/3/1 variant weights are now tile probabilities.
- **The Undercroft stone is flipped and turned for variety.** Tiles 1-3 use all eight orientations. The brick tile (4) only flips, so its courses stay horizontal.
- **All three floor tilesets use placeholder art**, generated in code from the Undercroft stone. Replace it with real art from the art list.
  - `warrens`: claim-tag drifts, `sides` mode, five tiles plus transforms.
  - `garage`: water, `corners` mode, five tiles plus transforms.
  - `lobby`: a carpet runner, `cornersAndSides` mode, all 47 blob tiles plus the four stone tiles. It was built as a Godot `.tres` (`sprites/tilesets/lobby.tres`) and imported with the importer.
- **The standalone Undercroft tileset was dropped.** No floor uses it; the Warrens and Garage take its stone images as their base terrain.
- **What the importer leaves out, with a warning:** physics, navigation, occlusion, custom data, scene-collection sources, tiles bigger than one square, and tiles with no terrain. Animated tiles use frame 0. It refuses non-square tile shapes and Godot 3's format 2.
- **The importer has only been tested on hand-written `.tres` files** in Godot 4's text format (format 3). The first real export from the Godot editor may turn up properties it doesn't expect. Unknown properties are skipped, not fatal.
- **`npm run validate` re-converts each imported tileset from its `.tres`** and fails if the result differs, so an edit made in Godot can't silently miss the game.

#### Client

- **The floor layer is a `<span>` with a CSS background, not an `<img>`.** That way one sheet serves every tile.
  - Background size and position are percentages, so tiles scale with the square.
  - Flips are a CSS matrix (`matrix(0, sy, sx, 0, 0, 0)` for a transpose).
  - The terrain color fills the square underneath, and on its own if the sheet is missing.
- **Checked in headless Chrome with saved mid-fight games on all three floors:**
  - All 64 squares drew, with flipped tiles where expected (none on the imported lobby set).
  - The Garage water joined up across squares, and the Lobby's carpet border followed its edge.
  - No console errors or failed requests.

### Floor art: the Lobby and Warrens tilesets

- **Real art replaces the placeholders on Floors 1 and 2.** The Garage keeps its placeholder.
  - **Source:** three square 3x3 sheets from an image generator, in `sprites/floor_sheets/`: `lobby_1.jpg`, `lobby_2.jpg` and `warrens.jpg`.
  - **How they were made:** each prompt had two attachments, a flat-colour layout guide that drew every piece's exact shape and the floor's earlier sheet for style. Without the guide, the first attempts got the shapes wrong: paper framing each square instead of filling it, a quarter of one tile missing, and no solid piece.
- **How the sheets were cut:**
  - Each cell is 656px, between 20px gutters.
  - Tiles are cut 4px inside each cell. JPEG blur from the black gutters darkens the outermost pixel, which would have drawn a faint line between squares.
  - They're shrunk to 128px (Lanczos) and packed into one atlas per floor: `lobby.png` (6x3, 18 tiles) and `warrens.png` (3x3, 9 tiles).
  - **Lobby atlas order:** the four marble tiles (sheet 2, cells 1, 2, 3, 9), then sheet 1's cells 1-9, then sheet 2's cells 4-8.
  - **Warrens atlas order:** the floor tiles (cells 6, 8, 7, 9), then cells 1-5.
- **Both sets are written by hand in `tilesets.json`**, with one drawing per shape and `transforms: "all"`, like the placeholders.
  - Neither came from Godot, so the Lobby no longer has `importedFrom`.
  - **The old Godot example is renamed** `sprites/tilesets/example_carpet.tres` (and `.png`). The importer names an import after its file, so re-importing `lobby.tres` would have replaced the real Lobby set.
  - The README's example import command now says `<floor>`.
  - The unused `warrens_tags.png` placeholder is deleted.
- **The Warrens moved from `sides` to `corners` mode.** The design asked for sides. But the generator naturally heaped paper in corners, and corners mode needs one piece fewer (5, not 6).
- **The Warrens list paper first, under the floor.** A drift then spreads half a square past its own squares, and the floor squares around it carry the edge pieces.
  - With the floor listed first, every drift would shrink by half a square instead, and most of the floor's 3-7 square drifts would vanish.
  - A one-square hole of floor inside a drift fills with paper.
- **The Lobby has all 14 blob shapes.** The carpet's gold border sits a quarter of the way in from any edge where marble shows. A runner of any width, one-square carpet paths and carpet patches all join.
  - The runner stays 2-3 squares wide. Today it only uses the solid and straight-edge pieces.
  - The one-square-wide pieces (cross, T, corner, straight, end cap) are there for door-to-door runners or carpet patches later.
- **Accent weights:**
  - Lobby marble: plain 10, more cracks 3, grey stain 1, chip 1.
  - Warrens floor: plain 10, scuff 3, coffee ring 1, one stray tag 1.
- **The Lobby's cracks run every way,** not "all pointing down" as the floor's description has it. The tiles are turned and flipped for variety, which a direction would rule out.
- **Terrain colours** (the fill under each square) are the new art's average colours. The carpet keeps its old red, because the average of its pattern came out purple.
- **Checked:**
  - Every transition piece crosses its tile edges within 4% of where the guide put it.
  - For both floors, grounds generated on all three board sizes went through `paintGround`, each square was cut from the packed atlas by `choiceArt`'s region, and every board joined up.
  - `npm run check` passes.
  - Not yet looked at in a browser. The client's drawing code is unchanged, and the old Lobby set already drew from an atlas sheet.
