/**
 * Headless auto-play (spec: "npm run sim"). Rolls crawlers, runs Floor 1 with a
 * simple policy, and reports outcomes. This is the balance tool: extend the
 * policy as milestones add systems.
 *
 *   npm run sim            200 runs
 *   npm run sim -- 1000    more runs
 */
import { createEngine, loadContent, bfsDistances, type World, type Dir, type GameEvent } from "../packages/engine/src/index";
import { rawContent } from "../packages/content/index";

const runs = Number(process.argv[2] ?? 200);
const engine = createEngine(loadContent(rawContent as never));

interface Outcome {
  result: "cleared" | "died" | "stuck";
  cause: string;
  actions: number;
  roomsVisited: number;
  xp: number;
  fights: number;
  level: number;
}

function hpPct(world: World): number {
  const c = world.game.crawler!;
  const max = engine.view(world).status.hp?.max ?? 1;
  return c.hp / max;
}

function healItem(world: World): string | undefined {
  return world.game.crawler!.inventory.find((i) => i.kind === "consumable" && i.tags.includes("healing"))?.name;
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

function runOne(): Outcome {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  let fights = 0;
  let lastEvents: GameEvent[] = [];
  const act = (a: Parameters<typeof engine.step>[1]) => {
    const r = engine.step(world, a);
    world = r.world;
    lastEvents = r.events;
    if (r.events.some((e) => e.type === "combatStarted")) fights++;
  };

  for (let i = 0; i < 3000; i++) {
    const phase = world.game.phase;
    if (phase === "dead") break;

    if (phase === "combat") {
      const heal = healItem(world);
      if (hpPct(world) < 0.45 && heal) act({ type: "use", item: heal });
      else if (hpPct(world) < 0.3) act({ type: "flee" });
      else act({ type: "attack" });
      continue;
    }

    // exploring
    const floor = world.game.floor!;
    const here = floor.rooms[floor.currentRoom]!;
    const timeToSpare = floor.timeLeft > 24 * 60;
    if (here.type === "safe" && hpPct(world) < 0.85) { act({ type: "sleep" }); continue; }
    if (hpPct(world) < 0.4 && healItem(world)) { act({ type: "use", item: healItem(world)! }); continue; }
    if (hpPct(world) < 0.65 && timeToSpare) { act({ type: "rest" }); continue; }

    const dist = bfsDistances(floor.rooms, floor.currentRoom);
    const unvisited = floor.rooms.filter((r) => !r.visited && dist[r.id]! >= 0);
    const visited = floor.rooms.filter((r) => r.visited).length;
    // A sane crawler sees most of the floor, not all of it, then takes the stairs.
    const headHome = floor.timeLeft < 36 * 60 || unvisited.length === 0 || visited / floor.rooms.length > 0.6;
    if (headHome) {
      if (here.type === "stairwell") { act({ type: "descend" }); continue; }
      const stairs = floor.rooms.filter((r) => r.type === "stairwell")
        .sort((a, b) => dist[a.id]! - dist[b.id]!)[0];
      if (!stairs) return { result: "stuck", cause: "no stairwell", actions: i, roomsVisited: 0, xp: 0, fights, level: 1 };
      const dir = stepToward(world, stairs.id);
      if (!dir) return { result: "stuck", cause: "no path", actions: i, roomsVisited: 0, xp: 0, fights, level: 1 };
      act({ type: "go", dir });
      continue;
    }
    const target = unvisited.sort((a, b) => dist[a.id]! - dist[b.id]!)[0]!;
    const dir = stepToward(world, target.id);
    if (!dir) return { result: "stuck", cause: "no path", actions: i, roomsVisited: 0, xp: 0, fights, level: 1 };
    act({ type: "go", dir });
  }

  const c = world.game.crawler!;
  const died = world.game.log.filter((e) => e.type === "died").pop();
  const cleared = world.account.bestFloor >= 2;
  const roomsVisited = world.game.floor?.rooms.filter((r) => r.visited).length ?? 60;
  void lastEvents;
  return {
    result: cleared ? "cleared" : died ? "died" : "stuck",
    cause: cleared ? "descended" : died ? died.cause : `ran out of actions (${world.game.phase}; ${world.game.floor?.timeLeft ?? 0} min left; room ${world.game.floor?.currentRoom ?? "none"}; combat ${world.game.combat?.enemies.filter((e) => e.hp > 0).map((e) => `${e.name}:${e.hp}`).join(",") ?? "none"})`,
    actions: world.game.turn,
    roomsVisited,
    xp: c.xp,
    fights,
    level: c.level,
  };
}

const outcomes: Outcome[] = [];
for (let i = 0; i < runs; i++) outcomes.push(runOne());

const cleared = outcomes.filter((o) => o.result === "cleared");
const died = outcomes.filter((o) => o.result === "died");
const stuck = outcomes.filter((o) => o.result === "stuck");
const causes = new Map<string, number>();
for (const o of died) causes.set(o.cause, (causes.get(o.cause) ?? 0) + 1);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

console.log(`\nFloor 1 sim — ${runs} runs`);
console.log(`  cleared : ${cleared.length} (${Math.round((100 * cleared.length) / runs)}%)`);
console.log(`  died    : ${died.length} (${Math.round((100 * died.length) / runs)}%)`);
if (stuck.length) console.log(`  stuck   : ${stuck.length}  ← should be zero`);
if (stuck.length) for (const o of stuck) console.log(`    ${o.cause}`);
console.log(`  avg fights/run: ${avg(outcomes.map((o) => o.fights))}   avg xp: ${avg(outcomes.map((o) => o.xp))}   avg rooms: ${avg(outcomes.map((o) => o.roomsVisited))}`);
console.log("  deaths by cause:");
for (const [cause, n] of [...causes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(4)}  ${cause}`);
}
