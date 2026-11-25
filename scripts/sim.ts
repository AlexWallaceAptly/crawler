/**
 * Headless auto-play (spec: "npm run sim"). Rolls crawlers, runs Floor 1 with a
 * simple policy, and reports outcomes. This is the balance tool: extend the
 * policy as milestones add systems.
 *
 *   npm run sim                      200 runs, the default combat mode
 *   npm run sim -- 1000              more runs
 *   npm run sim -- 500 --mode both   grid and bands side by side
 *   npm run sim -- 500 --craft       the crawler also picks up junk, crafts at
 *                                    benches (Echo's modules too), wields its best weapon and throws junk at packs
 *   npm run sim -- 500 --floors 3    keep going down to Floor 3 (default: stop after Floor 1)
 *   npm run sim -- 300 --spell grease_fire
 *                                    every crawler starts knowing this spell (on top of any starter): how strong is it?
 *   npm run sim -- 300 --offsets 0,-2,-3
 *                                    try other enemy levelOffsets per floor (floors.json → encounters)
 *
 * Echo's urges are answered at random (half let, half hush), so the Temper spread is a
 * coin-flip baseline. Boss fights use the boss's weakness when the crawler can.
 *
 * Leveling (Milestone 6a): stat points go 2 into the held weapon's stat and 1 into CON
 * each level. The report shows the level and best weapon-skill rank at each floor's end,
 * the level after Floor 1's first hard fight, and the fight on which a weapon skill
 * first reaches each rank.
 *
 * Magic (Milestone 6b): tomes are read as soon as they're carried. In a fight the crawler
 * heals and cures with spells when it needs to, opens on a pack (or an elite) with a buff
 * or a crowd-control spell, and casts its best damage spell when that does about as much per
 * AP as its swing. Out of one it uses Bad Feeling, Flashlight App and Dowsing Rod while MP is
 * high. A crawler whose INT is at least its weapon stat and who knows a damage spell puts
 * the 2 weapon points into INT. The report splits clear rates by starter spell.
 *
 * Floor pacing (Milestone 6c): `--bot sweeper|greedy|scout|balanced|all` picks how the crawler
 * explores (balanced is the default). The sweeper clears and searches every room on a floor
 * with its collapse timer stretched 4x, so the report can say how much of the real budget a full
 * sweep costs. Every report adds per-floor pacing: rooms visited and searched, day of descent,
 * forced descents, where the minutes went, sleep states, wanderers, hazards and events.
 *   npm run sim -- 200 --floors 3 --craft --bot all
 *
 * Districts (Milestone 9): the report adds elites and champions killed per floor and deaths by
 * district. `--no-districts` turns districts and elite boxes off, for a before/after.
 *
 * Death and the account (Milestone 8): `--chain 10` plays the runs as careers of 10 crawlers that
 * share one account. Between runs the bot leaves its most valuable item as the bequest (and walks
 * to it on the next Floor 1), and buys the cheapest unlock it can afford until it can't. The report
 * adds legacy points per run, unlocks owned by each run of the career, and the clear rate by run.
 * Use it with `--floors 3`: a run stopped early is closed by quitting, which pays nothing for floors.
 *   npm run sim -- 200 --floors 3 --craft --chain 10
 */
import { createEngine, loadContent, bfsDistances, powerScore, type World, type Dir, type GameEvent, type CombatMode, type AccountState } from "../packages/engine/src/index";
import { autoAssign, atWorkbench } from "../packages/engine/src/craft";
import { effectsNow, moduleViews } from "../packages/engine/src/modules";
import { counterItems } from "../packages/engine/src/boss";
import { openStairwell } from "../packages/engine/src/explore";
import { pendingShard, sideOf } from "../packages/engine/src/echo";
import { rawContent } from "../packages/content/index";
import { sleepStage } from "../packages/engine/src/rules/sleep";
import { spellNumbers, spellProfile } from "../packages/engine/src/spells";
import { heldWeapon, profileOf, swingNumbers } from "../packages/engine/src/gear";
import type { Spell } from "../packages/engine/src/content/schemas";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
type Bot = "balanced" | "sweeper" | "greedy" | "scout";
const BOTS: Bot[] = ["balanced", "sweeper", "greedy", "scout"];
const botArg = flag("bot") ?? "balanced";
if (botArg !== "all" && !BOTS.includes(botArg as Bot)) throw new Error(`--bot: ${BOTS.join(" | ")} | all`);
const bots: Bot[] = botArg === "all" ? BOTS : [botArg as Bot];
/** The sweeper's collapse timer is stretched by this much, so a full sweep can be timed. */
const SWEEP_STRETCH = 4;
/** A descent with this many minutes or fewer left counts as forced by the clock. */
const FORCED_WITHIN = 24 * 60;
const runs = Number(args.find((a) => /^\d+$/.test(a)) ?? 200);
const modeArg = flag("mode") ?? "default";
const modes: (CombatMode | "default")[] = modeArg === "both" ? ["grid", "bands"] : [modeArg as CombatMode | "default"];
const content = loadContent(rawContent as never);
// Tuning: `--offsets 0,-2,-3` overrides each floor's encounters.levelOffset, in floor order.
const offsetsArg = flag("offsets");
if (offsetsArg) {
  const offs = offsetsArg.split(",").map(Number);
  for (const f of content.floors.all) {
    const o = offs[(f.floor ?? 1) - 1];
    if (o !== undefined && !Number.isNaN(o)) f.encounters.levelOffset = o;
  }
}
// Milestone 9: `--no-districts` plays the floors as one district each with no elite boxes (the
// pre-Milestone 9 game), for a before/after on the same code.
if (args.includes("--no-districts")) {
  for (const f of content.floors.all) f.districts = [];
  content.boxes.drops.elite.chance = 0;
}
const engine = createEngine(content);
const crafty = args.includes("--craft");
/** `--spell <id>`: every crawler starts knowing it. */
const forcedSpell = flag("spell");
if (forcedSpell && !content.spells.has(forcedSpell)) throw new Error(`--spell: no spell "${forcedSpell}" in spells.json`);
/** Play down to (and including) this floor. */
const floorsArg = Math.max(1, Number(flag("floors") ?? 1));
/** `--chain N`: careers of N runs on one account (Milestone 8). */
const chainLen = Math.max(0, Number(flag("chain") ?? 0));
/** A fight that drags past this many rounds counts as stuck (AI or rules deadlock). */
const MAX_ROUNDS = 60;

/** What a floor cost, as the pacing report needs it. */
interface FloorPace {
  floor: number;
  rooms: number;
  visited: number;
  /** Ordinary (non-safe) rooms searched at least once, and how many there were. */
  searched: number;
  searchable: number;
  /** Days into the floor when the crawler left it (or the run ended there). */
  day: number;
  left: boolean;
  forced: boolean;
  minutes: Record<string, number>;
  stage: Record<string, number>;
  wander: number;
  hazardTicks: number;
  eventsStarted: number;
  rewardTaken: boolean;
  /** Minutes into the floor when every room was visited and searched twice (the sweeper), and the real budget. */
  sweepDone?: number;
  budget: number;
}

interface Outcome {
  pace: FloorPace[];
  /** Day of the run on which the crawler died (if it did). */
  deathDay?: number;
  result: "cleared" | "died" | "stuck";
  cause: string;
  actions: number;
  roomsVisited: number;
  xp: number;
  fights: number;
  level: number;
  fightRounds: number[];
  fightDamage: number[];
  fled: number;
  crafted: number;
  /** Milestone 7: achievements earned, boxes opened and left unopened, gold earned and spent, ids earned. */
  achievements: string[];
  boxesOpened: number;
  boxesLeft: number;
  goldEarned: number;
  goldSpent: number;
  mood: number;
  /** Died in one of the floor's opening (easy pool) fights. */
  earlyDeath: boolean;
  /** Deepest floor stood on. */
  deepest: number;
  /** The thread: shards found per floor, modules built, the floor bosses. */
  shardsByFloor: Record<number, number>;
  modules: number;
  bossFights: number;
  bossWins: number;
  weakness: number;
  temper: number;
  /** Level after Floor 1's first hard-pool fight (if it was won). */
  levelAfterFirstHard?: number;
  /** Floor number → level and best weapon-skill rank on leaving it (down the stairs). */
  atFloorEnd: Record<number, { level: number; rank: number }>;
  /** Floor number → weapon-skill XP earned there (about one per swing). */
  weaponXp: Record<number, number>;
  /** Floor number → character XP earned there, and whether its boss died. */
  floorXp: Record<number, number>;
  bossDownOn: number[];
  /** Rank → the fight (counted from the run's start) on which a weapon skill first reached it. */
  rankAtFight: Record<number, number>;
  /** Hard fights won on Floor 1 between level 2 and level 3. */
  hardFightsTo3?: number;
  /** Magic: started with a spell, ever knew one, casts, tomes read, fights with a cast. */
  starter: boolean;
  knewSpell: boolean;
  casts: number;
  tomes: number;
  castFights: number;
  /** Best spell level and school rank at the end. */
  spellLevel: number;
  schoolRank: number;
  /** Milestone 8: legacy points the run paid, unlocks owned after it, and whether the bequest was picked up. */
  legacy: number;
  unlocksOwned: number;
  heirloom: boolean;
  /** Position in its career (chain mode), from 0. */
  chainIndex: number;
  account: AccountState;
  /** Milestone 9: per floor, elites and district champions killed, boxes they paid, districts seen; where a death happened. */
  districts: DistrictTally;
}

interface DistrictTally {
  elites: Record<number, number>;
  champions: Record<number, number>;
  eliteBoxes: number;
  championBoxes: number;
  seen: Record<number, number>;
  death?: { floor: number; district: number };
}

function hpPct(world: World): number {
  const c = world.game.crawler!;
  const max = engine.view(world).status.hp?.max ?? 1;
  return c.hp / max;
}

/** A thrown consumable worth lobbing at a pack. */
function throwable(world: World): string | undefined {
  return world.game.crawler!.inventory.find((i) => {
    const def = i.kind === "consumable" ? content.items.consumables.byId[i.baseId] : undefined;
    return def && def.tags.includes("thrown") && def.usableInCombat && def.effects.some((e) => e.target === "target" || e.target === "all_enemies");
  })?.name.toLowerCase();
}

/** The hardest-hitting weapon in the pack, if it beats what's in hand. */
function bestWeapon(world: World): string | undefined {
  const c = world.game.crawler!;
  const score = (i: (typeof c.inventory)[number]) => (i.power ? powerScore(i.power) + (i.onHit ? 1 : 0) : 0);
  const held = c.inventory.find((i) => i.uid === c.equipment.mainHand);
  const best = c.inventory.filter((i) => i.kind === "gear" && i.slot === "mainHand" && i.power).sort((a, b) => score(b) - score(a))[0];
  return best && best !== held && score(best) > (held ? score(held) : 1.5) ? best.name.toLowerCase() : undefined;
}

function healItem(world: World): string | undefined {
  const fighting = world.game.phase === "combat";
  return world.game.crawler!.inventory.find((i) => i.kind === "consumable" && i.tags.includes("healing") &&
    (!fighting || content.items.consumables.byId[i.baseId]?.usableInCombat !== false))?.name;
}

/** One `go` step along the BFS path toward the target room. */
/** Hop distances from a room, never walking through a closed (collapsed) section. */
function openDistances(world: World, from: number): number[] {
  const rooms = world.game.floor!.rooms;
  const dist = rooms.map(() => -1);
  dist[from] = 0;
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of Object.values(rooms[id]!.exits)) {
      if (dist[next] === -1 && !rooms[next]!.closed) { dist[next] = dist[id]! + 1; queue.push(next); }
    }
  }
  return dist;
}

function stepToward(world: World, target: number): Dir | undefined {
  const floor = world.game.floor!;
  const dist = openDistances(world, target);
  const here = floor.rooms[floor.currentRoom]!;
  let best: { dir: Dir; d: number } | undefined;
  for (const [dir, id] of Object.entries(here.exits) as [Dir, number][]) {
    if (dist[id]! >= 0 && (!best || dist[id]! < best.d)) best = { dir, d: dist[id]! };
  }
  return best?.dir;
}

function runOne(mode: CombatMode | "default", bot: Bot, account?: AccountState): Outcome {
  let { world } = engine.newWorld(account);
  if (mode !== "default") world.account.settings = { combatMode: mode };
  ({ world } = engine.step(world, { type: "accept" }));
  const starter = Object.keys(world.game.crawler!.spells).length > 0;
  // (the first floor starts here; later floors start in act())
  if (forcedSpell) world.game.crawler!.spells[forcedSpell] ??= { level: 1, casts: 0, cooldown: 0 };
  let casts = 0;
  let tomes = 0;
  let castFights = 0;
  let castThisFight = false;
  /** Opening spells used this fight (a buff or crowd control, once each). */
  const opened = new Set<string>();
  /** Rooms lit by Flashlight App; floors dowsed. */
  const lit = new Set<string>();
  const dowsed = new Set<number>();
  let fights = 0;
  let fled = 0;
  let bequestTried = false;
  const districts: DistrictTally = { elites: {}, champions: {}, eliteBoxes: 0, championBoxes: 0, seen: {} };
  let earlyDeath = false;
  const fightRounds: number[] = [];
  const fightDamage: number[] = [];
  let fightStartHp = 0;
  let crafted = 0;
  const benchVisits = new Set<number>();
  let lastRound = 0;
  let lastEvents: GameEvent[] = [];
  const shardsByFloor: Record<number, number> = {};
  let bossFights = 0;
  let bossWins = 0;
  let weakness = 0;
  let deepest = 1;
  let roomsF1 = 0;
  let levelAfterFirstHard: number | undefined;
  const atFloorEnd: Record<number, { level: number; rank: number }> = {};
  const weaponXp: Record<number, number> = {};
  const floorXp: Record<number, number> = {};
  const bossDownOn: number[] = [];
  const rankAtFight: Record<number, number> = {};
  let hardWinsF1 = 0;
  let hardAtLevel2: number | undefined;
  let hardFightsTo3: number | undefined;
  const weaponSkills = new Set(content.skills.all.filter((s) => s.category === "weapon").map((s) => s.id));
  const topRank = () => Math.max(0, ...Object.entries(world.game.crawler?.skills ?? {}).filter(([id]) => weaponSkills.has(id)).map(([, s]) => s.rank));
  // --- pacing telemetry (Milestone 6c) ---
  const pace: FloorPace[] = [];
  type Cur = { floor: number; startClock: number; budget: number; spent: Record<string, number>; stage: Record<string, number>; wander: number; sweepDone?: number };
  let cur = null as Cur | null;
  const beginFloor = () => {
    const f = world.game.floor;
    if (!f || (cur && cur.floor === f.floor)) return;
    const budget = f.timeLeft;
    if (bot === "sweeper") f.timeLeft = budget * SWEEP_STRETCH;
    cur = { floor: f.floor, startClock: f.startClock, budget, spent: { ...(world.game.timeSpent ?? {}) }, stage: {}, wander: 0 };
  };
  const finishFloor = (w: World, left: boolean) => {
    const f = w.game.floor;
    if (!f || !cur || cur.floor !== f.floor) return;
    const rooms = f.rooms;
    const ordinary = rooms.filter((r) => r.type !== "safe");
    const spent: Record<string, number> = {};
    for (const [k, v] of Object.entries(w.game.timeSpent ?? {})) spent[k] = v - (cur.spent[k] ?? 0);
    const elapsed = w.game.clock - cur.startClock;
    pace.push({
      floor: f.floor, rooms: rooms.length, visited: rooms.filter((r) => r.visited).length,
      searched: ordinary.filter((r) => r.rs.searchPasses > 0).length, searchable: ordinary.length,
      day: elapsed / 1440, left, forced: left && cur.budget - elapsed <= FORCED_WITHIN,
      minutes: spent, stage: cur.stage, wander: cur.wander,
      hazardTicks: rooms.reduce((n, r) => n + r.rs.hazards.reduce((m, h) => m + h.ticks, 0), 0),
      eventsStarted: f.events.filter((e) => e.started).length,
      rewardTaken: !!w.game.crawler?.inventory.some((i) => i.sponsor),
      ...(cur.sweepDone !== undefined ? { sweepDone: cur.sweepDone } : {}),
      budget: cur.budget,
    });
    cur = null;
  };
  const act = (a: Parameters<typeof engine.step>[1]) => {
    const prev = world;
    const clockBefore = world.game.clock;
    const stageBefore = world.game.crawler ? sleepStage(world.game.crawler, content).id : "rested";
    const wasBoss = !!world.game.combat?.boss;
    const floorBefore = world.game.floor?.floor ?? 1;
    const levelBefore = world.game.crawler?.level ?? 1;
    const rankBefore = topRank();
    const r = engine.step(world, a);
    world = r.world;
    lastEvents = r.events;
    if (cur) cur.stage[stageBefore] = (cur.stage[stageBefore] ?? 0) + (world.game.clock - clockBefore);
    if (r.events.some((e) => e.type === "floorEntered" && e.floor > floorBefore) || (!world.game.floor && r.events.some((e) => e.type === "floorCleared"))) finishFloor(prev, true);
    beginFloor();
    if (cur && world.game.combat?.wander && r.events.some((e) => e.type === "combatStarted")) cur.wander++;
    for (const e of r.events) {
      if (e.type === "combatEnded") {
        for (const k of e.skills ?? []) if (weaponSkills.has(k.id)) weaponXp[floorBefore] = (weaponXp[floorBefore] ?? 0) + k.gained;
        floorXp[floorBefore] = (floorXp[floorBefore] ?? 0) + (e.xp ?? 0);
        if (wasBoss && e.outcome === "victory") bossDownOn.push(floorBefore);
        const f = world.game.floor;
        const easy = f ? content.floors.get(f.theme).encounters.easyFights : 3;
        if (e.outcome === "victory" && f?.floor === 1 && f.fights > easy) {
          hardWinsF1++;
          if (f.fights === easy + 1) levelAfterFirstHard = world.game.crawler!.level;
        }
      }
      if (e.type === "floorEntered" && e.floor > floorBefore) atFloorEnd[floorBefore] = { level: levelBefore, rank: rankBefore };
    }
    const lvl = world.game.crawler?.level ?? 1;
    if (lvl >= 2 && hardAtLevel2 === undefined) hardAtLevel2 = hardWinsF1;
    if (lvl >= 3 && hardFightsTo3 === undefined && hardAtLevel2 !== undefined && floorBefore === 1) hardFightsTo3 = hardWinsF1 - hardAtLevel2;
    for (let rank = rankBefore + 1; rank <= topRank(); rank++) rankAtFight[rank] ??= fights;
    // Spend stat points as soon as there's peace: 2 into the weapon's stat, 1 into CON.
    for (let k = 0; k < 30; k++) {
      const c = world.game.crawler;
      if (!c || c.unspentStatPoints <= 0 || world.game.phase !== "exploring") break;
      const held = c.inventory.find((i) => i.uid === c.equipment.mainHand);
      const weaponStat = held?.stat ?? "STR";
      const caster = Object.keys(c.spells).some((id) => content.spells.byId[id]?.power && content.spells.byId[id]?.target !== "self") &&
        c.baseStats.INT >= c.baseStats[weaponStat];
      const stat = c.unspentStatPoints % 3 === 1 ? "CON" : caster ? "INT" : weaponStat;
      const before = c.unspentStatPoints;
      world = engine.step(world, { type: "raise", stat, times: 1 }).world;
      if ((world.game.crawler?.unspentStatPoints ?? 0) >= before) break;
    }
    for (const e of r.events) if (e.type === "shardFound") shardsByFloor[e.floor] = (shardsByFloor[e.floor] ?? 0) + 1;
    // Milestone 9: districts, elites and champions.
    for (const e of r.events) {
      if (e.type === "kill" && e.champion) districts.champions[floorBefore] = (districts.champions[floorBefore] ?? 0) + 1;
      else if (e.type === "kill" && e.tier === "elite") districts.elites[floorBefore] = (districts.elites[floorBefore] ?? 0) + 1;
      if (e.type === "boxEarned" && e.source.startsWith("elite:")) districts.eliteBoxes++;
      if (e.type === "boxEarned" && e.source.startsWith("champion:")) districts.championBoxes++;
      if (e.type === "districtEntered") districts.seen[e.floor] = (districts.seen[e.floor] ?? 0) + 1; // once per district
      if (e.type === "died" && prev.game.floor) {
        const fl = world.game.floor ?? prev.game.floor;
        districts.death = { floor: fl.floor, district: fl.rooms[fl.currentRoom]?.district ?? 0 };
      }
    }
    if (r.events.some((e) => e.type === "codexUpdated" && e.kind === "weakness") && (wasBoss || world.game.combat?.boss)) weakness++;
    if (r.events.some((e) => e.type === "combatStarted")) {
      if (castThisFight) castFights++;
      castThisFight = false;
      opened.clear();
      fights++;
      fightStartHp = world.game.crawler!.hp;
      if (world.game.combat?.boss) bossFights++;
    }
    if (wasBoss && r.events.some((e) => e.type === "combatEnded" && e.outcome === "victory")) bossWins++;
    if (world.game.floor) deepest = Math.max(deepest, world.game.floor.floor);
    if (world.game.floor?.floor === 1) roomsF1 = world.game.floor.rooms.filter((r) => r.visited).length;
    if (world.game.combat) lastRound = world.game.combat.round;
    const ended = r.events.find((e) => e.type === "combatEnded" || e.type === "died");
    if (ended?.type === "died" && fightStartHp > 0 && fights <= 3) earlyDeath = true;
    if (ended && fightStartHp > 0) {
      fightRounds.push(lastRound);
      fightDamage.push(Math.max(0, fightStartHp - Math.max(0, world.game.crawler?.hp ?? 0)));
      if (ended.type === "combatEnded" && ended.outcome === "fled") fled++;
      fightStartHp = 0;
      // a flee can walk straight into the next fight
      if (world.game.combat) { fights++; fightStartHp = world.game.crawler!.hp; }
    }
  };
  const magic = () => {
    const c = world.game.crawler;
    const levels = Object.values(c?.spells ?? {}).map((st) => st.level);
    const ranks = Object.entries(c?.skills ?? {}).filter(([id]) => content.skills.byId[id]?.category === "magic").map(([, st]) => st.rank);
    return {
      starter, knewSpell: starter || tomes > 0 || levels.length > 0, casts, tomes, castFights: castFights + (castThisFight ? 1 : 0),
      spellLevel: Math.max(0, ...levels), schoolRank: Math.max(0, ...ranks),
    };
  };
  const stuck = (cause: string, i: number): Outcome => {
    // A career has to go on: close the stuck run so the account is in a sane state.
    if (chainLen && world.game.phase !== "dead") world = engine.step(world, { type: "abandon", confirm: true }).world;
    return {
      pace,
      result: "stuck", cause, actions: i, roomsVisited: 0, xp: 0, fights, level: 1, fightRounds, fightDamage, fled, crafted, earlyDeath,
      achievements: [], boxesOpened: 0, boxesLeft: 0, goldEarned: 0, goldSpent: 0, mood: 0,
      deepest, shardsByFloor, modules: 0, bossFights, bossWins, weakness, temper: 0, atFloorEnd, weaponXp, rankAtFight, floorXp, bossDownOn,
      ...magic(),
      legacy: world.game.ended?.legacy?.total ?? 0, unlocksOwned: world.account.unlocks.length, heirloom: false, chainIndex: 0, account: world.account,
      districts,
    };
  };
  /** Run a command; false if the engine refused it (not enough AP, out of reach...). */
  const tryAct = (a: Parameters<typeof engine.step>[1]) => {
    act(a);
    return !lastEvents.some((e) => e.type === "error");
  };
  /** Nearest living enemy, weakest first among equals: the one worth swinging at. */
  const pickTarget = (): string | undefined => {
    const combat = world.game.combat!;
    const band = { close: 0, near: 1, far: 2 } as const;
    const at = combat.arena?.crawler;
    const far = (e: (typeof combat.enemies)[number]) =>
      at && e.pos ? Math.max(Math.abs(e.pos.x - at.x), Math.abs(e.pos.y - at.y)) : band[e.range];
    return combat.enemies.filter((e) => e.hp > 0).sort((a, b) => far(a) - far(b) || a.hp - b.hp)[0]?.name.toLowerCase();
  };

  /** Spells known right now, with their numbers at this crawler's level and perks. */
  const known = () => {
    const c = world.game.crawler!;
    return Object.entries(c.spells).flatMap(([id, st]) => {
      const sp = content.spells.byId[id];
      return sp ? [{ sp, st, n: spellNumbers(c, content, sp, st.level) }] : [];
    });
  };
  /** Cast it now: enough MP, off cooldown, and (in a fight) enough AP. */
  const ready = (k: ReturnType<typeof known>[number], ap: number) =>
    k.st.cooldown === 0 && world.game.crawler!.mp >= k.n.mp && (world.game.phase !== "combat" || ap >= k.n.ap) &&
    (k.sp.when === "any" || k.sp.when === (world.game.phase === "combat" ? "fight" : "explore"));
  const cast = (sp: Spell) => {
    const ok = tryAct({ type: "cast", spell: sp.name.toLowerCase() });
    if (ok) {
      casts++;
      if (world.game.phase === "combat") castThisFight = true;
    }
    return ok;
  };
  const CURABLE = ["poisoned", "bleeding", "burning"];
  const needsCure = () => world.game.crawler!.statuses.some((st) => CURABLE.includes(st.id));
  /**
   * A spell worth casting this AP, or undefined (then swing as usual). Heal when low, cure,
   * open on a pack with a buff or crowd control, else the best damage spell if it keeps up
   * with the swing per AP.
   */
  const spellToCast = (ap: number, foes: number, big: boolean): Spell | undefined => {
    const c = world.game.crawler!;
    const ks = known().filter((k) => ready(k, ap));
    if (!ks.length) return undefined;
    const heal = ks.find((k) => k.sp.target === "self" && k.sp.power);
    if (heal && hpPct(world) < 0.45) return heal.sp;
    const cure = ks.find((k) => k.sp.cures);
    if (cure && needsCure() && hpPct(world) < 0.7) return cure.sp;
    const round = world.game.combat!.round;
    if (round <= 2 && (foes >= 2 || big)) {
      const opener = ks.find((k) => !opened.has(k.sp.id) && !k.sp.power && k.sp.status &&
        (k.sp.target !== "self" || !c.statuses.some((st) => st.id === k.sp.status!.id)));
      if (opener) {
        opened.add(opener.sp.id);
        return opener.sp;
      }
    }
    const w = profileOf(content, heldWeapon(c), c);
    const swingPerAp = swingNumbers(c, content, w).average / (w.unwieldy ? 2 : w.apCost);
    const damage = ks.filter((k) => k.sp.power && k.sp.target !== "self").map((k) => {
      const per = swingNumbers(c, content, spellProfile(content, k.sp, k.n)).average * (k.n.shape ? Math.min(foes, 2) : 1);
      return { k, perAp: per / k.n.ap };
    }).sort((a, b) => b.perAp - a.perAp)[0];
    return damage && damage.perAp >= 0.8 * swingPerAp ? damage.k.sp : undefined;
  };

  /** Put on anything the view calls better than what's on now (generated gear, Milestone 5). */
  const wearBetter = () => {
    for (let k = 0; k < 4; k++) {
      const better = engine.view(world).inventory.find((it) => it.verdict === "better" && it.kind === "gear");
      if (!better || !tryAct({ type: "equip", item: better.name.toLowerCase() })) return;
    }
  };

  beginFloor();
  for (let i = 0; i < (bot === "sweeper" ? 9000 : 4000) * floorsArg; i++) {
    const phase = world.game.phase;
    if (phase === "dead") break;
    if (world.game.floor && world.game.floor.floor > floorsArg) break; // made it past the last floor we're testing

    // Echo asked for something: a coin flip.
    if (world.game.echo?.urge) { act({ type: Math.random() < 0.5 ? "allowEcho" : "refuseEcho" }); continue; }

    if (phase === "combat") {
      if (world.game.combat!.round > MAX_ROUNDS) {
        return stuck(`endless fight (${world.game.combat!.mode}): ${world.game.combat!.enemies.filter((e) => e.hp > 0).map((e) => `${e.name}:${e.hp}`).join(", ")}`, i);
      }
      // A turn is AP: keep issuing commands until the engine ends it. Swing while there's
      // AP for it, close in when out of reach, and brace with whatever is left over.
      const heal = healItem(world);
      const thrown = crafty ? throwable(world) : undefined;
      const foes = world.game.combat!.enemies.filter((e) => e.hp > 0).length;
      const cv = engine.view(world).combat!;
      const target = pickTarget();
      const combat = world.game.combat!;
      const boss = combat.boss ? content.bosses.byId[combat.boss.id] : undefined;
      const counter = counterItems({ game: world.game, content })[0];
      const fx = effectsNow(world.game, content);
      if (boss?.weakness.trigger?.kind === "decline" && combat.boss!.declines < boss.weakness.trigger.count && cv.ap.current >= 1) {
        if (!tryAct({ type: "decline" })) act({ type: "wait" });
      } else if (counter && !combat.boss!.triggered && cv.ap.current >= 1) {
        if (!tryAct({ type: "use", item: counter.name.toLowerCase() })) act({ type: "wait" });
      } else if ((fx.tether || fx.yank) && !combat.used?.includes("bind") && cv.ap.current >= 1 && tryAct({ type: "module", verb: "bind" })) { /* bound */ }
      else if (fx.shout && !combat.used?.includes("shout") && foes >= 2 && cv.ap.current >= 1 && tryAct({ type: "module", verb: "shout" })) { /* shouted */ }
      else if ((() => {
        const sp = spellToCast(cv.ap.current, foes, !!combat.boss || combat.enemies.some((e) => e.hp > 0 && e.tier === "elite"));
        return sp ? cast(sp) : false;
      })()) { /* cast */ }
      else if (hpPct(world) < 0.45 && heal) { if (!tryAct({ type: "use", item: heal })) act({ type: "wait" }); }
      else if (hpPct(world) < 0.3) { if (!tryAct({ type: "flee" })) act({ type: "wait" }); }
      else if (thrown && foes >= 2 && world.game.combat!.round <= 2 && tryAct({ type: "use", item: thrown })) { /* thrown */ }
      else if (cv.ap.current >= cv.attackCost) {
        if (!tryAct(target ? { type: "attack", target } : { type: "attack" }) && !tryAct({ type: "advance" })) act({ type: "wait" });
      } else if (!tryAct({ type: "defend" })) act({ type: "wait" });
      continue;
    }

    if (crafty) {
      const floor = world.game.floor!;
      const room = floor.rooms[floor.currentRoom]!;
      if (room.items?.length) {
        const n = world.game.crawler!.inventory.length;
        act({ type: "take", item: "all" });
        if (world.game.crawler!.inventory.length !== n) {
          wearBetter();
          continue;
        }
      }
      // A module that just became buildable is worth stopping at any bench for.
      if (atWorkbench(room) && moduleViews(world.game, content).some((v) => !v.installed && v.ready)) {
        const m = moduleViews(world.game, content).find((v) => !v.installed && v.ready)!;
        act({ type: "craft", recipe: m.name.toLowerCase() });
        continue;
      }
      if (atWorkbench(room) && !benchVisits.has(room.id)) {
        benchVisits.add(room.id);
        for (let k = 0; k < 3; k++) {
          const c = world.game.crawler!;
          const recipe = content.recipes.all.find((r) => autoAssign(c, r));
          if (!recipe) break;
          const parts = autoAssign(c, recipe)!.flatMap((slot) => slot.items.map((it) => it.name.toLowerCase()));
          const known = (c.recipes ?? []).length;
          act({ type: "combine", items: parts.join(", ") });
          if ((world.game.crawler?.recipes ?? []).length > known || world.game.log.some((e) => e.type === "narration" && e.key === "craft.success")) crafted++;
          if (world.game.phase !== "exploring") break;
        }
        for (const m of moduleViews(world.game, content).filter((v) => !v.installed && v.ready)) {
          act({ type: "craft", recipe: m.name.toLowerCase() });
          if (world.game.phase !== "exploring") break;
        }
        const best = bestWeapon(world);
        if (best) act({ type: "equip", item: best });
        wearBetter();
        continue;
      }
    }

    // exploring
    const floor = world.game.floor!;
    const here = floor.rooms[floor.currentRoom]!;
    const timeToSpare = floor.timeLeft > 24 * 60;
    const tome = world.game.crawler!.inventory.find((it) => it.spellId && it.spellLevel === undefined);
    if (tome && tryAct({ type: "use", item: tome.name.toLowerCase() })) { tomes++; continue; }
    {
      const ks = known().filter((k) => ready(k, 99));
      const maxMp = engine.view(world).status.mp?.max ?? 1;
      const mpPct = world.game.crawler!.mp / Math.max(1, maxMp);
      const heal = ks.find((k) => k.sp.target === "self" && k.sp.power);
      const cure = ks.find((k) => k.sp.cures);
      const sense = ks.find((k) => k.sp.status?.id === "trap_sense");
      const light = ks.find((k) => k.sp.utility === "reveal");
      const dowse = ks.find((k) => k.sp.utility === "senseStairs");
      const key = `${floor.floor}:${here.id}`;
      let spell: Spell | undefined;
      if (heal && hpPct(world) < 0.65) spell = heal.sp;
      else if (cure && needsCure()) spell = cure.sp;
      else if (sense && mpPct >= 0.6 && !world.game.crawler!.statuses.some((st) => st.id === "trap_sense")) spell = sense.sp;
      else if (light && mpPct >= 0.7 && !lit.has(key)) { lit.add(key); spell = light.sp; }
      else if (dowse && mpPct >= 0.7 && !dowsed.has(floor.floor)) { dowsed.add(floor.floor); spell = dowse.sp; }
      if (spell && cast(spell)) continue;
    }
    // Milestone 7: unopened boxes open in the first safe room (they are free), and spare gold buys healing.
    if (here.type === "safe" && world.game.boxes.length > 0) { act({ type: "open", which: "all" }); continue; }
    if (here.type === "safe" && here.shop && world.game.crawler!.gold >= 25) {
      const shelf = here.shop.stock.find((i) => i.kind === "consumable" && /heal|bandage|potion/i.test(i.name));
      if (shelf) { const before = world.game.crawler!.gold; act({ type: "buy", item: shelf.name.toLowerCase(), qty: "1" }); if (world.game.crawler!.gold < before) continue; }
    }
    const awakeH = (world.game.crawler!.awakeMin ?? 0) / 60;
    const careful = bot !== "greedy";
    if (here.type === "safe" && (hpPct(world) < 0.85 || (careful && awakeH >= 20 && timeToSpare))) { act({ type: "sleep" }); continue; }
    // Not a greedy descender: pick up what searching turned up, and don't let sleep slip past the Exhausted line.
    if (careful && !crafty && here.items?.length) {
      const n = world.game.crawler!.inventory.length;
      act({ type: "take", item: "all" });
      if (world.game.crawler!.inventory.length !== n) { wearBetter(); continue; }
    }
    if (hpPct(world) < 0.4 && healItem(world)) { act({ type: "use", item: healItem(world)! }); continue; }
    if (hpPct(world) < 0.65 && timeToSpare && bot !== "sweeper") { act({ type: "rest" }); continue; }
    // A faint voice: search for what's talking (that's the only way to find a room shard).
    if (pendingShard(world.game, content, here)) { act({ type: "search" }); continue; }

    const dist = openDistances(world, floor.currentRoom);
    const reach = (r: { id: number; closed?: boolean }) => dist[r.id]! >= 0 && !r.closed;
    const unvisited = floor.rooms.filter((r) => !r.visited && reach(r));
    const visited = floor.rooms.filter((r) => r.visited).length;
    const goTo = (id: number): boolean => {
      const dir = stepToward(world, id);
      if (!dir) return false;
      act({ type: "go", dir });
      return true;
    };
    // Chain mode: the last crawler's bequest is worth the walk, once (if it won't fit, or gets
    // dropped again, walking back for it would loop).
    const left = floor.bequest;
    if (chainLen && left && !bequestTried && floor.rooms[left.room]!.items?.some((i) => i.heirloom) && reach(floor.rooms[left.room]!)) {
      if (floor.currentRoom === left.room) {
        bequestTried = true;
        act({ type: "take", item: left.name.toLowerCase() });
        if (world.game.crawler!.inventory.some((i) => i.heirloom)) { wearBetter(); continue; }
      } else if (goTo(left.room)) continue;
    }
    const searchable = (r: (typeof floor.rooms)[number]) => r.type !== "safe" && r.type !== "stairwell" && r.visited && reach(r);
    // The sweeper keeps searching until nothing is left hidden (it peeks at the state: a sim shortcut for assess), up to 6 passes.
    const passesWanted = bot === "sweeper" ? 6 : 0;
    const needSearch = floor.rooms.filter((r) => searchable(r) && r.rs.searchPasses < passesWanted && (r.hidden?.length ?? 0) > 0);
    if (bot === "sweeper" && cur && cur.sweepDone === undefined && unvisited.length === 0 && needSearch.length === 0) {
      cur.sweepDone = world.game.clock - cur.startClock;
    }

    // Sleep before it bites: Exhausted is 28h awake. A safe room within reach beats a bad night's sleep.
    if (careful && awakeH >= 26 && here.type !== "safe" && floor.timeLeft > 12 * 60) {
      const bed = floor.rooms.filter((r) => r.type === "safe" && reach(r)).sort((a, b) => dist[a.id]! - dist[b.id]!)[0];
      if (bed && dist[bed.id]! <= 8 && goTo(bed.id)) continue;
    }

    // One pass (or two, for the sweeper) in each ordinary room, while there's time to spare.
    if (careful && searchable(here) && (bot === "sweeper" ? needSearch.includes(here) : here.rs.searchPasses < (bot === "balanced" || bot === "scout" ? 1 : 0) && floor.timeLeft > 48 * 60)) {
      if (bot !== "scout" || here.rs.danger !== "dangerous") { act({ type: "search" }); continue; }
    }

    // How much of the floor a sane crawler sees before it takes the stairs.
    const unvisitedLeft = unvisited.length;
    const done = bot === "sweeper" ? unvisitedLeft === 0 && needSearch.length === 0 : unvisitedLeft === 0;
    const headHome = bot === "greedy" ? true
      : bot === "sweeper" ? done || floor.timeLeft < 4 * 60
      : floor.timeLeft < 36 * 60 || done || visited / floor.rooms.length > 0.6;
    if (headHome) {
      if (openStairwell(floor, here)) { act({ type: "descend" }); continue; }
      const stairs = floor.rooms.filter((r) => openStairwell(floor, r) && reach(r))
        .sort((a, b) => dist[a.id]! - dist[b.id]!)[0];
      if (!stairs) return stuck("no stairwell", i);
      if (!goTo(stairs.id)) return stuck("no path", i);
      continue;
    }
    if (bot === "sweeper" && unvisited.length === 0) {
      const next = needSearch.sort((a, b) => dist[a.id]! - dist[b.id]!)[0]!;
      if (next.id === here.id) { act({ type: "search" }); continue; }
      if (!goTo(next.id)) return stuck("no path", i);
      continue;
    }
    // The scout skips rooms it has heard are dangerous while it's hurt.
    let pool = unvisited;
    if (bot === "scout" && hpPct(world) < 0.8) {
      const calm = unvisited.filter((r) => r.rs.danger !== "dangerous");
      if (calm.length) pool = calm;
    }
    const target = pool.sort((a, b) => dist[a.id]! - dist[b.id]!)[0]!;
    const dir = stepToward(world, target.id);
    if (!dir) return stuck("no path", i);
    // The scout listens at the door before every new room.
    if (bot === "scout") {
      const next = floor.rooms[here.exits[dir]!]!;
      if (!next.visited && next.rs.scoutTier === 0 && timeToSpare) { act({ type: "listen", dir }); continue; }
    }
    act({ type: "go", dir });
  }

  finishFloor(world, false);
  const c = world.game.crawler!;
  const heirloom = c.inventory.some((i) => i.heirloom);
  // Judged on this run (the account's bestFloor carries over in a career), before the career bookkeeping below.
  const cleared = (world.game.floor?.floor ?? 0) > floorsArg || world.game.ended?.kind === "descended";
  const died = world.game.log.filter((e) => e.type === "died").pop();
  const stuckCause = `ran out of actions (${world.game.phase}; ${world.game.floor?.timeLeft ?? 0} min left; room ${world.game.floor?.currentRoom ?? "none"}; combat ${world.game.combat?.enemies.filter((e) => e.hp > 0).map((e) => `${e.name}:${e.hp}`).join(",") ?? "none"}; round ${world.game.combat?.round ?? "-"})\n      last: ${world.game.log.slice(-4).map((e) => ("text" in e ? e.text : e.type)).join(" | ").slice(0, 400)}`;
  // The run is over (or stuck: close it so the account stays consistent). Bequeath and shop.
  if (chainLen) {
    if (world.game.phase !== "dead") world = engine.step(world, { type: "abandon", confirm: true }).world;
    const end = engine.view(world).runEnd;
    if (end?.candidates.length) world = engine.input(world, end.candidates[0]!.input).world;
    for (let guard = 0; guard < 20; guard++) {
      const buy = engine.view(world).account.unlocks.filter((u) => u.canBuy && !u.repeatable).sort((a, b) => a.cost - b.cost)[0];
      if (!buy) break;
      world = engine.input(world, `unlock ${buy.id}`).world;
    }
  }

  const roomsVisited = roomsF1;
  void lastEvents;
  return {
    pace,
    ...(died ? { deathDay: world.game.clock / 1440 } : {}),
    result: cleared ? "cleared" : died ? "died" : "stuck",
    cause: cleared ? "descended" : died ? died.cause : stuckCause,
    actions: world.game.turn,
    roomsVisited,
    xp: c.xp,
    fights,
    level: c.level,
    fightRounds,
    fightDamage,
    fled,
    crafted,
    achievements: [...c.achievements],
    boxesOpened: c.counters["boxes.opened"] ?? 0,
    boxesLeft: world.game.boxes.length,
    goldEarned: c.counters["gold.earned"] ?? 0,
    goldSpent: c.counters["gold.spent"] ?? 0,
    mood: world.game.narrator.mood,
    earlyDeath,
    deepest,
    shardsByFloor,
    modules: world.game.echo?.modules.length ?? 0,
    bossFights,
    bossWins,
    weakness,
    temper: world.game.echo?.temper ?? 0,
    ...(levelAfterFirstHard !== undefined ? { levelAfterFirstHard } : {}),
    ...(hardFightsTo3 !== undefined ? { hardFightsTo3 } : {}),
    atFloorEnd,
    weaponXp,
    rankAtFight,
    floorXp,
    bossDownOn,
    ...magic(),
    legacy: world.game.ended?.legacy?.total ?? 0,
    unlocksOwned: world.account.unlocks.length,
    heirloom,
    chainIndex: 0,
    account: world.account,
    districts,
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const spread = (xs: number[]) => {
  if (!xs.length) return "-";
  const s = xs.slice().sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return `median ${at(0.5)} (10th-90th ${at(0.1)}-${at(0.9)})`;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

/** Milestone 7: achievements, boxes, gold and the System AI's mood. */
function rewardsReport(outcomes: Outcome[]): void {
  const n = outcomes.length;
  const ids = new Map<string, number>();
  for (const o of outcomes) for (const id of o.achievements) ids.set(id, (ids.get(id) ?? 0) + 1);
  const never = content.achievements.all.filter((a) => !ids.has(a.id) && !a.secret).map((a) => a.id);
  const top = [...ids.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  rewards: ${avg(outcomes.map((o) => o.achievements.length)).toFixed(1)} achievements/run of ${content.achievements.all.length}; boxes opened ${avg(outcomes.map((o) => o.boxesOpened)).toFixed(1)}/run (${avg(outcomes.map((o) => o.boxesLeft)).toFixed(1)} left unopened); gold earned ${Math.round(avg(outcomes.map((o) => o.goldEarned)))}, spent ${Math.round(avg(outcomes.map((o) => o.goldSpent)))}; mood ${avg(outcomes.map((o) => o.mood)).toFixed(1)}`);
  console.log(`    most common: ${top.slice(0, 5).map(([id, k]) => `${id} ${Math.round((100 * k) / n)}%`).join(", ")}`);
  console.log(`    never earned (non-secret): ${never.length ? never.join(", ") : "none"}`);
}

/** Milestone 9: districts, elites and champions on the floors that have them. */
function districtReport(outcomes: Outcome[]): void {
  for (let f = 2; f <= floorsArg; f++) {
    const theme = content.floors.all.find((t) => t.floor === f);
    if (!theme || theme.districts.length < 2) continue;
    const on = outcomes.filter((o) => o.deepest >= f);
    if (!on.length) continue;
    const champs = theme.districts.filter((d) => d.champion).length;
    const deaths = on.filter((o) => o.districts.death?.floor === f);
    const byDistrict = theme.districts.map((d, i) => `${d.name} ${deaths.filter((o) => o.districts.death!.district === i).length}`);
    console.log(`  F${f} districts (${on.length} runs): seen ${avg(on.map((o) => o.districts.seen[f] ?? 0)).toFixed(1)}/${theme.districts.length}; elites killed ${avg(on.map((o) => o.districts.elites[f] ?? 0)).toFixed(2)}/run; champions killed ${avg(on.map((o) => o.districts.champions[f] ?? 0)).toFixed(2)}/${champs} (any: ${pct(on.filter((o) => (o.districts.champions[f] ?? 0) > 0).length, on.length)})`);
    console.log(`      deaths by district: ${byDistrict.join(" · ")}`);
  }
  console.log(`  boxes from kills per run: elites ${avg(outcomes.map((o) => o.districts.eliteBoxes)).toFixed(2)}, champions ${avg(outcomes.map((o) => o.districts.championBoxes)).toFixed(2)}`);
}

/** Milestone 8: what runs pay the account, and how fast a career buys its unlocks. */
function legacyReport(outcomes: Outcome[]): void {
  const pays = outcomes.map((o) => o.legacy);
  const byResult = (r: Outcome["result"]) => outcomes.filter((o) => o.result === r).map((o) => o.legacy);
  console.log(`  legacy: ${spread(pays)} points a run (died ${spread(byResult("died"))}; cleared ${spread(byResult("cleared"))}); all unlocks cost ${content.unlocks.all.filter((u) => !u.repeatable).reduce((n, u) => n + u.cost, 0)}`);
  if (!chainLen) return;
  const owned = content.unlocks.all.filter((u) => !u.repeatable).length;
  const rows: string[] = [];
  for (let k = 0; k < chainLen; k++) {
    const at = outcomes.filter((o) => o.chainIndex === k);
    if (!at.length) continue;
    const clear = Math.round((100 * at.filter((o) => o.result === "cleared").length) / at.length);
    const heir = k > 0 ? ` heirloom ${Math.round((100 * at.filter((o) => o.heirloom).length) / at.length)}%` : "";
    rows.push(`run ${k + 1}: ${avg(at.map((o) => o.unlocksOwned)).toFixed(1)}/${owned} unlocks, clear ${clear}%${heir}`);
  }
  console.log(`  career (${chainLen} runs, one account):`);
  for (let i = 0; i < rows.length; i += 3) console.log(`    ${rows.slice(i, i + 3).join("   ")}`);
}

/** The floor pacing report (Milestone 6c): where the clock went and whether the targets hold. */
function pacingReport(outcomes: Outcome[], bot: Bot): void {
  const total = outcomes.length;
  console.log(`  pacing (${bot}):`);
  for (let f = 1; f <= floorsArg; f++) {
    const ps = outcomes.flatMap((o) => o.pace.filter((p) => p.floor === f));
    if (!ps.length) continue;
    const left = ps.filter((p) => p.left);
    const mins = new Map<string, number>();
    let minsTotal = 0;
    for (const p of ps) for (const [k, v] of Object.entries(p.minutes)) { mins.set(k, (mins.get(k) ?? 0) + v); minsTotal += v; }
    const stage = new Map<string, number>();
    let stageTotal = 0;
    for (const p of ps) for (const [k, v] of Object.entries(p.stage)) { stage.set(k, (stage.get(k) ?? 0) + v); stageTotal += v; }
    const share = (m: Map<string, number>, t: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${pct(v, t)}`).join(", ");
    console.log(`    F${f} (${ps.length} runs, ${left.length} descended): rooms visited ${pct(ps.reduce((n, p) => n + p.visited, 0), ps.reduce((n, p) => n + p.rooms, 0))}, searched ${pct(ps.reduce((n, p) => n + p.searched, 0), ps.reduce((n, p) => n + p.searchable, 0))}; day of leaving ${spread(left.map((p) => Math.round(p.day * 10) / 10))}; forced by the clock ${pct(left.filter((p) => p.forced).length, left.length)}`);
    console.log(`        minutes: ${share(mins, minsTotal)}`);
    console.log(`        sleep states: ${share(stage, stageTotal)}`);
    console.log(`        per run: ${avg(ps.map((p) => p.wander)).toFixed(2)} wandering fights, ${avg(ps.map((p) => p.hazardTicks)).toFixed(2)} hazard bites, ${avg(ps.map((p) => p.eventsStarted)).toFixed(1)} events fired; sponsor reward taken in ${pct(ps.filter((p) => p.rewardTaken).length, ps.length)}`);
    if (bot === "sweeper") {
      const done = ps.filter((p) => p.sweepDone !== undefined);
      const ratios = done.map((p) => Math.round((100 * p.sweepDone!) / p.budget));
      const within = done.filter((p) => p.sweepDone! <= p.budget).length;
      console.log(`        full sweep: completed in ${pct(done.length, ps.length)} of runs (the rest died first); cost ${spread(ratios)}% of the budget (target 140-160%); within the real budget in ${pct(within, ps.length)} (target 15% or fewer)`);
    }
  }
  const days = outcomes.flatMap((o) => (o.deathDay !== undefined ? [o.deathDay] : []));
  console.log(`    deaths on day 1: ${pct(days.filter((d) => d < 1).length, total)} of runs; later: ${pct(days.filter((d) => d >= 1).length, total)}`);
  if (bot === "balanced") {
    const f1 = outcomes.flatMap((o) => o.pace.filter((p) => p.floor === 1 && p.left));
    const inWindow = f1.filter((p) => p.day >= 2 && p.day <= 5).length;
    console.log(`    target: balanced descends on days 3-5 (counting from day 0: 2-5) in ${pct(inWindow, f1.length)} of Floor 1 descents`);
  }
}

const summaries: { mode: string; clear: number; rounds: number; damage: number }[] = [];

for (const [bot, mode] of bots.flatMap((b) => modes.map((m) => [b, m] as const))) {
  const outcomes: Outcome[] = [];
  let account: AccountState | undefined;
  for (let i = 0; i < runs; i++) {
    if (!chainLen || i % chainLen === 0) account = undefined; // a new career
    const o = runOne(mode, bot, chainLen ? account : undefined);
    o.chainIndex = chainLen ? i % chainLen : 0;
    account = o.account;
    outcomes.push(o);
  }

  const cleared = outcomes.filter((o) => o.result === "cleared");
  const died = outcomes.filter((o) => o.result === "died");
  const stuck = outcomes.filter((o) => o.result === "stuck");
  const causes = new Map<string, number>();
  for (const o of died) causes.set(o.cause, (causes.get(o.cause) ?? 0) + 1);
  const rounds = outcomes.flatMap((o) => o.fightRounds);
  const damage = outcomes.flatMap((o) => o.fightDamage);
  const fights = outcomes.reduce((s, o) => s + o.fights, 0);
  const fled = outcomes.reduce((s, o) => s + o.fled, 0);

  console.log(`\n${floorsArg === 1 ? "Floor 1" : `Floors 1-${floorsArg}`} sim — ${runs} runs — bot: ${bot} — combat: ${mode}${crafty ? " — crafting on" : ""}${forcedSpell ? ` — everyone knows ${forcedSpell}` : ""}${chainLen ? ` — careers of ${chainLen}` : ""}`);
  console.log(`  cleared : ${cleared.length} (${Math.round((100 * cleared.length) / runs)}%)`);
  console.log(`  died    : ${died.length} (${Math.round((100 * died.length) / runs)}%)`);
  if (stuck.length) console.log(`  stuck   : ${stuck.length}  ← should be zero`);
  if (stuck.length) for (const o of stuck.slice(0, 10)) console.log(`    ${o.cause}`);
  console.log(`  avg fights/run: ${avg(outcomes.map((o) => o.fights)).toFixed(1)}   avg xp: ${Math.round(avg(outcomes.map((o) => o.xp)))}   avg Floor 1 rooms: ${Math.round(avg(outcomes.map((o) => o.roomsVisited)))}`);
  console.log(`  per fight: ${avg(rounds).toFixed(1)} rounds, ${avg(damage).toFixed(1)} damage taken, fled ${fights ? Math.round((100 * fled) / fights) : 0}%`);
  const early = outcomes.flatMap((o) => o.fightDamage.slice(0, 3));
  const late = outcomes.flatMap((o) => o.fightDamage.slice(3));
  console.log(`  damage taken per fight: ${avg(early).toFixed(1)} in fights 1-3 (easy pool), ${avg(late).toFixed(1)} after`);
  console.log(`  died in the first 3 fights: ${outcomes.filter((o) => o.earlyDeath).length} (${Math.round((100 * outcomes.filter((o) => o.earlyDeath).length) / runs)}%)`);
  if (crafty) console.log(`  crafted per run: ${avg(outcomes.map((o) => o.crafted)).toFixed(1)}`);
  rewardsReport(outcomes);
  districtReport(outcomes);
  legacyReport(outcomes);
  if (floorsArg > 1) {
    const reached = (f: number) => outcomes.filter((o) => o.deepest >= f).length;
    console.log(`  reached: ${Array.from({ length: floorsArg }, (_, i) => `F${i + 1} ${Math.round((100 * reached(i + 1)) / runs)}%`).join("   ")}`);
  }
  const perFloor = Array.from({ length: floorsArg }, (_, i) => {
    const on = outcomes.filter((o) => o.deepest >= i + 1);
    return `F${i + 1} ${avg(on.map((o) => o.shardsByFloor[i + 1] ?? 0)).toFixed(2)}/4`;
  });
  console.log(`  thread: shards found per run ${perFloor.join("   ")}; runs with a shard ${Math.round((100 * outcomes.filter((o) => Object.keys(o.shardsByFloor).length).length) / runs)}%`);
  const bossRuns = outcomes.filter((o) => o.bossFights > 0);
  console.log(`  bosses: fought in ${Math.round((100 * bossRuns.length) / runs)}% of runs, won ${bossRuns.length ? Math.round((100 * bossRuns.filter((o) => o.bossWins > 0).length) / bossRuns.length) : 0}% of those, weakness used ${bossRuns.length ? Math.round((100 * bossRuns.filter((o) => o.weakness > 0).length) / bossRuns.length) : 0}%`);
  const sides = { calm: 0, base: 0, fed: 0 };
  for (const o of outcomes) sides[sideOf(content, o.temper)]++;
  console.log(`  Echo: modules built per run ${avg(outcomes.map((o) => o.modules)).toFixed(2)}; final Temper calm ${Math.round((100 * sides.calm) / runs)}% / base ${Math.round((100 * sides.base) / runs)}% / fed ${Math.round((100 * sides.fed) / runs)}%`);
  const firstHard = outcomes.flatMap((o) => (o.levelAfterFirstHard !== undefined ? [o.levelAfterFirstHard] : []));
  console.log(`  leveling: level 2+ after F1's first hard fight in ${firstHard.length ? Math.round((100 * firstHard.filter((l) => l >= 2).length) / firstHard.length) : 0}% of ${firstHard.length} runs; hard wins from level 2 to 3: ${spread(outcomes.flatMap((o) => (o.hardFightsTo3 !== undefined ? [o.hardFightsTo3] : [])))}`);
  for (let f = 1; f <= floorsArg; f++) {
    const done = outcomes.flatMap((o) => (o.atFloorEnd[f] ? [o.atFloorEnd[f]!] : []));
    if (!done.length) continue;
    const left = outcomes.filter((o) => o.atFloorEnd[f]);
    const xp = left.map((o) => o.weaponXp[f] ?? 0);
    const killed = left.filter((o) => o.bossDownOn.includes(f));
    console.log(`  leaving F${f} (${done.length} runs): level ${spread(done.map((d) => d.level))}; best weapon rank ${spread(done.map((d) => d.rank))}`);
    console.log(`      on the floor: XP ${spread(left.map((o) => o.floorXp[f] ?? 0))}; weapon-skill XP ${spread(xp)}; boss killed in ${Math.round((100 * killed.length) / left.length)}%` +
      (killed.length ? ` (those: level ${spread(killed.map((o) => o.atFloorEnd[f]!.level))}, weapon XP ${spread(killed.map((o) => o.weaponXp[f] ?? 0))})` : ""));
  }
  if (cleared.length) console.log(`  level when the last floor was cleared: ${spread(cleared.map((o) => o.level))}`);
  const rankFights = [1, 2, 3, 5, 10].map((r) => {
    const xs = outcomes.flatMap((o) => (o.rankAtFight[r] !== undefined ? [o.rankAtFight[r]!] : []));
    return `r${r} fight ${xs.length ? median(xs) : "-"} (${Math.round((100 * xs.length) / runs)}% of runs)`;
  });
  console.log(`  weapon skill, median fight first reached: ${rankFights.join("   ")}`);
  const knew = outcomes.filter((o) => o.knewSpell);
  const starters = outcomes.filter((o) => o.starter);
  const rest = outcomes.filter((o) => !o.starter);
  const clearPct = (xs: Outcome[]) => (xs.length ? `${Math.round((100 * xs.filter((o) => o.result === "cleared").length) / xs.length)}%` : "-");
  const casters = outcomes.filter((o) => o.casts > 0);
  console.log(`  magic: knew a spell in ${Math.round((100 * knew.length) / runs)}% of runs (started with one ${Math.round((100 * starters.length) / runs)}%); tomes read per run ${avg(outcomes.map((o) => o.tomes)).toFixed(2)}`);
  console.log(`      casters (${casters.length} runs): ${avg(casters.map((o) => o.casts)).toFixed(1)} casts a run, a cast in ${Math.round(100 * avg(casters.map((o) => (o.fights ? o.castFights / o.fights : 0))))}% of fights; best spell level ${spread(casters.map((o) => o.spellLevel))}; best school rank ${spread(casters.map((o) => o.schoolRank))}`);
  console.log(`      cleared: started with a spell ${clearPct(starters)} (${starters.length}) · didn't ${clearPct(rest)} (${rest.length}) · ever knew one ${clearPct(knew)} (${knew.length}) · never ${clearPct(outcomes.filter((o) => !o.knewSpell))}`);
  console.log("  deaths by cause:");
  for (const [cause, n] of [...causes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(n).padStart(4)}  ${cause}`);
  }
  pacingReport(outcomes, bot);
  summaries.push({ mode, clear: (100 * cleared.length) / runs, rounds: avg(rounds), damage: avg(damage) });
}

if (summaries.length === 2) {
  const [a, b] = summaries as [typeof summaries[0], typeof summaries[0]];
  const sign = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1);
  console.log(`\n${a.mode} vs ${b.mode}: clear ${sign(a.clear - b.clear)} pts, rounds/fight ${sign(a.rounds - b.rounds)}, damage/fight ${sign(a.damage - b.damage)}`);
}
