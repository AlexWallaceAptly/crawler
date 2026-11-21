import { beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import { loadContent } from "../src/content/load";
import { resetRng, setRandomSource } from "../src/rng";
import { rawContent } from "@crawler/content";
import type { World } from "../src/state";
import type { GameEvent, GameEventType } from "../src/events";

const content = loadContent(rawContent as never);
const engine = createEngine(content);

function freshRun(): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  return world;
}

const of = <T extends GameEventType>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

describe("exploring floor 1", () => {
  beforeEach(() => resetRng());

  it("accept drops the crawler into a generated Undercroft", () => {
    let { world, events } = engine.newWorld();
    ({ world, events } = engine.step(world, { type: "accept" }));
    expect(world.game.phase).toBe("exploring");
    expect(world.game.floor).not.toBeNull();
    const entered = of(events, "roomEntered");
    expect(entered).toHaveLength(1);
    expect(entered[0]!.first).toBe(true);
    expect(entered[0]!.lines.length).toBeGreaterThanOrEqual(3);
    expect(entered[0]!.exits.length).toBeGreaterThanOrEqual(1);
  });

  it("moving costs 10 minutes and marks the room visited; walking into a wall costs nothing", () => {
    const world = freshRun();
    const floor = world.game.floor!;
    const start = floor.rooms[floor.currentRoom]!;
    const openDir = (Object.keys(start.exits) as (keyof typeof start.exits)[])[0]!;
    const wallDir = (["north", "east", "south", "west"] as const).find((d) => start.exits[d] === undefined);

    if (wallDir) {
      const r = engine.step(world, { type: "go", dir: wallDir });
      expect(r.world.game.floor!.timeLeft).toBe(floor.timeLeft);
      expect(r.world.game.floor!.currentRoom).toBe(floor.currentRoom);
    }
    const r2 = engine.step(world, { type: "go", dir: openDir });
    const f2 = r2.world.game.floor!;
    expect(f2.timeLeft).toBe(floor.timeLeft - 10);
    expect(f2.currentRoom).toBe(start.exits[openDir]);
    expect(f2.rooms[f2.currentRoom]!.visited).toBe(true);
    expect(of(r2.events, "roomEntered")[0]!.first).toBe(true);
  });

  it("revisits reuse the cached description and send an empty block", () => {
    const world = freshRun();
    setRandomSource(() => 0.99); // keep this room-entry test out of random encounters
    const floor = world.game.floor!;
    const start = floor.rooms[floor.currentRoom]!;
    const dir = (Object.keys(start.exits) as (keyof typeof start.exits)[])[0]!;
    const back = { north: "south", south: "north", east: "west", west: "east" }[dir] as typeof dir;
    // a lair or trap next door would start a fight or spring on entry; this test is about descriptions
    floor.rooms[start.exits[dir]!]!.type = "empty";

    const out = engine.step(world, { type: "go", dir });
    const descAway = out.world.game.floor!.rooms[out.world.game.floor!.currentRoom]!.desc;
    expect(descAway).not.toBeNull();
    const ret = engine.step(out.world, { type: "go", dir: back });
    const entered = of(ret.events, "roomEntered")[0]!;
    expect(entered.first).toBe(false);
    expect(entered.lines).toHaveLength(0);
    // look prints the same cached lines again
    const look = engine.step(ret.world, { type: "look" });
    expect(of(look.events, "roomEntered")[0]!.lines).toEqual(
      ret.world.game.floor!.rooms[ret.world.game.floor!.currentRoom]!.desc,
    );
  });

  it("search takes 15 minutes and marks the room; rest heals a quarter", () => {
    const world = freshRun();
    const before = world.game.floor!.timeLeft;
    const s = engine.step(world, { type: "search" });
    expect(s.world.game.floor!.timeLeft).toBe(before - 15);
    expect(s.world.game.floor!.rooms[s.world.game.floor!.currentRoom]!.searched).toBe(true);

    s.world.game.crawler!.hp = 1;
    const r = engine.step(s.world, { type: "rest" });
    expect(r.world.game.crawler!.hp).toBeGreaterThan(1);
    expect(r.world.game.floor!.timeLeft).toBe(before - 15 - 60);
  });

  it("sleep is refused outside a safe room and heals fully inside one", () => {
    const world = freshRun();
    const refused = engine.step(world, { type: "sleep" });
    expect(refused.world.game.floor!.timeLeft).toBe(world.game.floor!.timeLeft);

    const floor = world.game.floor!;
    floor.currentRoom = floor.rooms.find((r) => r.type === "safe")!.id;
    world.game.crawler!.hp = 1;
    const slept = engine.step(world, { type: "sleep" });
    expect(slept.world.game.crawler!.hp).toBeGreaterThan(5);
    expect(slept.world.game.floor!.timeLeft).toBe(floor.timeLeft - 8 * 60);
  });

  it("descend is refused off the stairs and takes you down to Floor 2 on them", () => {
    const world = freshRun();
    const refused = engine.step(world, { type: "descend" });
    expect(refused.world.game.phase).toBe("exploring");

    const floor = world.game.floor!;
    floor.currentRoom = floor.rooms.find((r) => r.type === "stairwell")!.id;
    const deaths = world.account.deaths;
    const done = engine.step(world, { type: "descend" });
    expect(of(done.events, "floorCleared")).toHaveLength(1);
    expect(of(done.events, "floorEntered")[0]!.floor).toBe(2);
    expect(done.world.game.phase).toBe("exploring");
    expect(done.world.game.floor!.floor).toBe(2);
    expect(done.world.game.floor!.theme).toBe("lost_and_found_warrens");
    expect(done.world.account.bestFloor).toBe(2);
    expect(done.world.account.deaths).toBe(deaths); // a win, not a death
  });

  it("descending past the deepest built floor ends the run as a win and records it", () => {
    let world = freshRun();
    const deepest = Math.max(...content.floors.all.map((t) => t.floor));
    for (let f = 1; f <= deepest; f++) {
      const floor = world.game.floor!;
      floor.currentRoom = floor.rooms.find((r) => r.type === "stairwell" && !r.concealed && !r.boss)!.id;
      world = engine.step(world, { type: "descend" }).world;
    }
    expect(world.game.phase).toBe("dead");
    expect(world.game.floor).toBeNull();
    expect(world.account.bestFloor).toBe(deepest + 1);
    expect(world.account.thread.history.at(-1)!.outcome).toBe(`descended past Floor ${deepest}`);
  });

  it("warnings fire once per threshold as time crosses them", () => {
    const world = freshRun();
    world.game.floor!.timeLeft = 1445;
    const start = world.game.floor!.rooms[world.game.floor!.currentRoom]!;
    const dir = (Object.keys(start.exits) as (keyof typeof start.exits)[])[0]!;
    const r1 = engine.step(world, { type: "go", dir });
    expect(of(r1.events, "timerWarning")).toHaveLength(1);
    expect(of(r1.events, "timerWarning")[0]!.label).toContain("24");
    const back = { north: "south", south: "north", east: "west", west: "east" }[dir] as typeof dir;
    const r2 = engine.step(r1.world, { type: "go", dir: back });
    expect(of(r2.events, "timerWarning")).toHaveLength(0);
  });

  it("the collapse kills anyone off the stairs and pushes anyone on them down", () => {
    const world = freshRun();
    world.game.floor!.timeLeft = 5;
    const start = world.game.floor!.rooms[world.game.floor!.currentRoom]!;
    const dir = (Object.keys(start.exits) as (keyof typeof start.exits)[])[0]!;
    const dead = engine.step(world, { type: "go", dir });
    expect(dead.world.game.phase).toBe("dead");
    expect(of(dead.events, "died")[0]!.cause).toBe("floor collapse");

    const world2 = freshRun();
    const floor2 = world2.game.floor!;
    floor2.timeLeft = 5;
    floor2.currentRoom = floor2.rooms.find((r) => r.type === "stairwell")!.id;
    const swept = engine.step(world2, { type: "rest" });
    expect(of(swept.events, "floorCleared")).toHaveLength(1);
    expect(of(swept.events, "died")).toHaveLength(0);
    expect(swept.world.account.bestFloor).toBe(2);
  });

  it("an unspotted, unavoided trap hurts and only fires once", async () => {
    const { StepContext } = await import("../src/step");
    const { springTrap } = await import("../src/explore");
    const { forceDice, setRandomSource } = await import("../src/rng");
    const world = freshRun();
    const floor = world.game.floor!;
    const room = floor.rooms[floor.currentRoom]!;
    room.type = "trap";
    room.trap = "steam_radiator";
    const ctx = new StepContext(world, content);
    const before = ctx.crawler.hp;
    setRandomSource(() => 0.99); // no status proc; d20s and damage come from forceDice
    forceDice(1, 1, 3, 4); // spot nat 1, avoid nat 1, 2d6 = 7
    springTrap(ctx, room);
    expect(ctx.crawler.hp).toBeLessThan(before);
    expect(room.trapSprung).toBe(true);
    expect(ctx.events.filter((e) => e.type === "check")).toHaveLength(2);
    // second entry: nothing happens, no dice needed
    const hpAfter = ctx.crawler.hp;
    springTrap(ctx, room);
    expect(ctx.crawler.hp).toBe(hpAfter);
  });

  it("the whole exploring world survives a JSON save/restore round-trip", () => {
    const world = freshRun();
    const game = JSON.parse(JSON.stringify(world.game));
    const account = JSON.parse(JSON.stringify(world.account));
    const restored = engine.restore(game, account);
    expect(restored).not.toBeNull();
    const r = engine.step(restored!, { type: "map" });
    expect(r.events.some((e) => e.type === "info")).toBe(true);
  });
});
