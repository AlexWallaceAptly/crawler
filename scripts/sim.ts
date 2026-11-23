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
 *
 * Echo's urges are answered at random (half let, half hush), so the Temper spread is a
 * coin-flip baseline. Boss fights use the boss's weakness when the crawler can.
 */
import { createEngine, loadContent, bfsDistances, powerScore, type World, type Dir, type GameEvent, type CombatMode } from "../packages/engine/src/index";
import { autoAssign, atWorkbench } from "../packages/engine/src/craft";
import { effectsNow, moduleViews } from "../packages/engine/src/modules";
import { counterItems } from "../packages/engine/src/boss";
import { openStairwell } from "../packages/engine/src/explore";
import { pendingShard, sideOf } from "../packages/engine/src/echo";
import { rawContent } from "../packages/content/index";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const runs = Number(args.find((a) => /^\d+$/.test(a)) ?? 200);
const modeArg = flag("mode") ?? "default";
const modes: (CombatMode | "default")[] = modeArg === "both" ? ["grid", "bands"] : [modeArg as CombatMode | "default"];
const content = loadContent(rawContent as never);
const engine = createEngine(content);
const crafty = args.includes("--craft");
/** Play down to (and including) this floor. */
const floorsArg = Math.max(1, Number(flag("floors") ?? 1));
/** A fight that drags past this many rounds counts as stuck (AI or rules deadlock). */
const MAX_ROUNDS = 60;

interface Outcome {
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
function stepToward(world: World, target: number): Dir | undefined {
  const floor = world.game.floor!;
  const dist = bfsDistances(floor.rooms, target);
  const here = floor.rooms[floor.currentRoom]!;
  let best: { dir: Dir; d: number } | undefined;
  for (const [dir, id] of Object.entries(here.exits) as [Dir, number][]) {
    if (dist[id]! >= 0 && (!best || dist[id]! < best.d)) best = { dir, d: dist[id]! };
  }
  return best?.dir;
}

function runOne(mode: CombatMode | "default"): Outcome {
  let { world } = engine.newWorld();
  if (mode !== "default") world.account.settings = { combatMode: mode };
  ({ world } = engine.step(world, { type: "accept" }));
  let fights = 0;
  let fled = 0;
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
  const act = (a: Parameters<typeof engine.step>[1]) => {
    const wasBoss = !!world.game.combat?.boss;
    const r = engine.step(world, a);
    world = r.world;
    lastEvents = r.events;
    for (const e of r.events) if (e.type === "shardFound") shardsByFloor[e.floor] = (shardsByFloor[e.floor] ?? 0) + 1;
    if (r.events.some((e) => e.type === "codexUpdated" && e.kind === "weakness") && (wasBoss || world.game.combat?.boss)) weakness++;
    if (r.events.some((e) => e.type === "combatStarted")) {
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
  const stuck = (cause: string, i: number): Outcome => ({
    result: "stuck", cause, actions: i, roomsVisited: 0, xp: 0, fights, level: 1, fightRounds, fightDamage, fled, crafted, earlyDeath,
    deepest, shardsByFloor, modules: 0, bossFights, bossWins, weakness, temper: 0,
  });
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

  /** Put on anything the view calls better than what's on now (generated gear, Milestone 5). */
  const wearBetter = () => {
    for (let k = 0; k < 4; k++) {
      const better = engine.view(world).inventory.find((it) => it.verdict === "better" && it.kind === "gear");
      if (!better || !tryAct({ type: "equip", item: better.name.toLowerCase() })) return;
    }
  };

  for (let i = 0; i < 4000 * floorsArg; i++) {
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
    if (here.type === "safe" && hpPct(world) < 0.85) { act({ type: "sleep" }); continue; }
    if (hpPct(world) < 0.4 && healItem(world)) { act({ type: "use", item: healItem(world)! }); continue; }
    if (hpPct(world) < 0.65 && timeToSpare) { act({ type: "rest" }); continue; }
    // A faint voice: search for what's talking (that's the only way to find a room shard).
    if (pendingShard(world.game, content, here)) { act({ type: "search" }); continue; }

    const dist = bfsDistances(floor.rooms, floor.currentRoom);
    const unvisited = floor.rooms.filter((r) => !r.visited && dist[r.id]! >= 0);
    const visited = floor.rooms.filter((r) => r.visited).length;
    // A sane crawler sees most of the floor, not all of it, then takes the stairs.
    const headHome = floor.timeLeft < 36 * 60 || unvisited.length === 0 || visited / floor.rooms.length > 0.6;
    if (headHome) {
      if (openStairwell(floor, here)) { act({ type: "descend" }); continue; }
      const stairs = floor.rooms.filter((r) => openStairwell(floor, r))
        .sort((a, b) => dist[a.id]! - dist[b.id]!)[0];
      if (!stairs) return stuck("no stairwell", i);
      const dir = stepToward(world, stairs.id);
      if (!dir) return stuck("no path", i);
      act({ type: "go", dir });
      continue;
    }
    const target = unvisited.sort((a, b) => dist[a.id]! - dist[b.id]!)[0]!;
    const dir = stepToward(world, target.id);
    if (!dir) return stuck("no path", i);
    act({ type: "go", dir });
  }

  const c = world.game.crawler!;
  const died = world.game.log.filter((e) => e.type === "died").pop();
  const cleared = world.account.bestFloor >= floorsArg + 1;
  const roomsVisited = roomsF1;
  void lastEvents;
  return {
    result: cleared ? "cleared" : died ? "died" : "stuck",
    cause: cleared ? "descended" : died ? died.cause : `ran out of actions (${world.game.phase}; ${world.game.floor?.timeLeft ?? 0} min left; room ${world.game.floor?.currentRoom ?? "none"}; combat ${world.game.combat?.enemies.filter((e) => e.hp > 0).map((e) => `${e.name}:${e.hp}`).join(",") ?? "none"}; round ${world.game.combat?.round ?? "-"})\n      last: ${world.game.log.slice(-4).map((e) => ("text" in e ? e.text : e.type)).join(" | ").slice(0, 400)}`,
    actions: world.game.turn,
    roomsVisited,
    xp: c.xp,
    fights,
    level: c.level,
    fightRounds,
    fightDamage,
    fled,
    crafted,
    earlyDeath,
    deepest,
    shardsByFloor,
    modules: world.game.echo?.modules.length ?? 0,
    bossFights,
    bossWins,
    weakness,
    temper: world.game.echo?.temper ?? 0,
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const summaries: { mode: string; clear: number; rounds: number; damage: number }[] = [];

for (const mode of modes) {
  const outcomes: Outcome[] = [];
  for (let i = 0; i < runs; i++) outcomes.push(runOne(mode));

  const cleared = outcomes.filter((o) => o.result === "cleared");
  const died = outcomes.filter((o) => o.result === "died");
  const stuck = outcomes.filter((o) => o.result === "stuck");
  const causes = new Map<string, number>();
  for (const o of died) causes.set(o.cause, (causes.get(o.cause) ?? 0) + 1);
  const rounds = outcomes.flatMap((o) => o.fightRounds);
  const damage = outcomes.flatMap((o) => o.fightDamage);
  const fights = outcomes.reduce((s, o) => s + o.fights, 0);
  const fled = outcomes.reduce((s, o) => s + o.fled, 0);

  console.log(`\n${floorsArg === 1 ? "Floor 1" : `Floors 1-${floorsArg}`} sim — ${runs} runs — combat: ${mode}${crafty ? " — crafting on" : ""}`);
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
  console.log("  deaths by cause:");
  for (const [cause, n] of [...causes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(n).padStart(4)}  ${cause}`);
  }
  summaries.push({ mode, clear: (100 * cleared.length) / runs, rounds: avg(rounds), damage: avg(damage) });
}

if (summaries.length === 2) {
  const [a, b] = summaries as [typeof summaries[0], typeof summaries[0]];
  const sign = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1);
  console.log(`\n${a.mode} vs ${b.mode}: clear ${sign(a.clear - b.clear)} pts, rounds/fight ${sign(a.rounds - b.rounds)}, damage/fight ${sign(a.damage - b.damage)}`);
}
