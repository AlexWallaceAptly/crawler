import { afterEach, describe, expect, it } from "vitest";
import { forceDice, resetRng, setRandomSource } from "../src/rng";
import { itemFromRef } from "../src/gen/item";
import { lineOfSight } from "../src/grid/geometry";
import { arenaOf, content, engine, gridWorld, lines, of, testEnemy } from "./helpers";
import { StepContext } from "../src/step";
import { startCombat } from "../src/combat";
import type { Enemy, World } from "../src/state";

afterEach(() => resetRng());

function give(world: World, id: string, qty = 1) {
  world.game.crawler!.inventory.push(itemFromRef(content, id, qty));
}

/** Bands fight with the same pinned crawler. */
function bandsWorld(enemies: Enemy[]): World {
  const w = gridWorld(["@"], []);
  w.account.settings = { combatMode: "bands" };
  w.game.combat = { ...w.game.combat!, mode: "bands", enemies };
  delete w.game.combat.arena;
  return w;
}

describe("shove", () => {
  it("a won shove pushes the target a tile straight back", () => {
    // stunned, so it can't just walk straight back in on its turn
    const world = gridWorld(["@a..", "...."], [testEnemy({ hp: 30, maxHP: 30, statuses: [{ id: "stunned", remaining: 1, stacks: 1 }] })]);
    forceDice(15, 2);
    const { world: w, events } = engine.input(world, "shove");
    expect(w.game.combat!.enemies[0]!.pos).toEqual({ x: 2, y: 0 });
    expect(lines(events)).toContain("stumbles back to c1");
  });

  it("shoved into caltrops, it takes the caltrops", () => {
    const world = gridWorld(["@a*.", "...."], [testEnemy({ hp: 30, maxHP: 30 })]);
    setRandomSource(() => 0); // caltrops' slow lands
    forceDice(15, 2, /* caltrops 1d3 */ 3, /* its turn */ 1);
    const { world: w, events } = engine.input(world, "shove");
    const rat = w.game.combat!.enemies[0]!;
    expect(rat.hp).toBe(27);
    expect(rat.statuses.some((s) => s.id === "slowed")).toBe(true);
    expect(lines(events)).toContain("caltrops");
  });

  it("shoved into a pillar, it slams for 1d4 and stays put", () => {
    const world = gridWorld(["@a#.", "...."], [testEnemy({ hp: 30, maxHP: 30 })]);
    forceDice(15, 2, /* slam */ 4, 1);
    const { world: w, events } = engine.input(world, "shove");
    const rat = w.game.combat!.enemies[0]!;
    expect(rat.pos).toEqual({ x: 1, y: 0 });
    expect(rat.hp).toBe(26);
    expect(lines(events)).toContain("slams into the pillar");
  });

  it("a lost shove does nothing; a braced target can't be shoved at all", () => {
    const lost = gridWorld(["@a.."], [testEnemy()]);
    forceDice(1, 20, 1);
    const r1 = engine.input(lost, "shove");
    expect(r1.world.game.combat!.enemies[0]!.pos).toEqual({ x: 1, y: 0 });

    const braced = gridWorld(["@a.."], [testEnemy({ statuses: [{ id: "braced", remaining: 1, stacks: 1 }] })]);
    forceDice(1);
    const r2 = engine.input(braced, "shove");
    expect(r2.world.game.combat!.enemies[0]!.pos).toEqual({ x: 1, y: 0 });
    expect(lines(r2.events)).toContain("doesn't budge");
  });

  it("in bands mode a shove knocks it back a band", () => {
    const world = bandsWorld([testEnemy({ range: "close", statuses: [{ id: "stunned", remaining: 1, stacks: 1 }] })]);
    forceDice(15, 2);
    const { world: w, events } = engine.input(world, "shove");
    expect(w.game.combat!.enemies[0]!.range).toBe("near");
    expect(lines(events)).toContain("staggers back to near range");
  });
});

describe("throwing junk on the board", () => {
  it("caltrops land in a plus, and the AI walks around them", () => {
    const world = gridWorld(["@.......", "........", "........", "........", ".......a"], [testEnemy({ hp: 30, maxHP: 30 })]);
    give(world, "caltrops_jacks");
    forceDice(1, 1); // nothing in the splash to roll damage for; the rat's swing if it arrives
    const { world: w, events } = engine.input(world, "throw bag of metal jacks at c3");
    const a = arenaOf(w);
    expect(a.hazards.filter((h) => h.id === "caltrops").map((h) => `${h.x},${h.y}`).sort())
      .toEqual(["1,2", "2,1", "2,2", "2,3", "3,2"]);
    expect(lines(events)).toContain("Caltrops now covers c3");
    const rat = w.game.combat!.enemies[0]!;
    expect(a.hazards.some((h) => h.x === rat.pos!.x && h.y === rat.pos!.y)).toBe(false);
  });

  it("a molotov hits everything in the 3x3, including you if you're standing in it", () => {
    const world = gridWorld(["@a..", "b...", "...."], [testEnemy({ hp: 30, maxHP: 30 }), testEnemy({ hp: 30, maxHP: 30 })]);
    give(world, "molotov");
    setRandomSource(() => 0.99); // no burning procs from the fire
    forceDice(3, 3, /* rats' swings */ 1, 1);
    const hp = world.game.crawler!.hp;
    const { world: w, events } = engine.input(world, "throw molotov at b1");
    expect(w.game.combat!.enemies.every((e) => e.hp < 30)).toBe(true);
    expect(w.game.crawler!.hp).toBeLessThan(hp);
    expect(lines(events)).toContain("to you");
    expect(arenaOf(w).hazards.filter((h) => h.id === "fire").length).toBeGreaterThanOrEqual(6);
  });

  it("fire burns out after 3 rounds; smoke blocks sight while it lasts", () => {
    const world = gridWorld(["@.....a"], [testEnemy({ speed: 1, hp: 30, maxHP: 30 })]);
    give(world, "smoke_bomb");
    forceDice(1, 1, 1, 1, 1, 1);
    let w = engine.input(world, "throw smoke at c1").world;
    const a = arenaOf(w);
    expect(lineOfSight(a, content, a.crawler, { x: 6, y: 0 })).toBe(false);
    for (let i = 0; i < 3; i++) w = engine.input(w, "wait").world;
    expect(arenaOf(w).hazards.some((h) => h.id === "smoke")).toBe(false);
  });

  it("you can't throw past 3 tiles, at what you can't see, or with nothing to throw", () => {
    const world = gridWorld(["@.#..a"], [testEnemy()]);
    give(world, "pepper_spray");
    expect(of(engine.input(world, "throw pepper spray at f1").events, "error")).toHaveLength(1);
    expect(of(engine.input(world, "throw pepper spray at d1").events, "error")).toHaveLength(1);
    expect(of(engine.input(world, "throw banana at b1").events, "error")).toHaveLength(1);
  });

  it("`use` on a throwable in a grid fight throws it at the nearest target in range", () => {
    const world = gridWorld(["@.a..."], [testEnemy({ hp: 30, maxHP: 30 })]);
    give(world, "pepper_spray");
    forceDice(1);
    const { world: w } = engine.input(world, "use pepper spray");
    expect(w.game.combat!.enemies[0]!.statuses.some((s) => s.id === "blinded")).toBe(true);
  });

  it("bands mode: caltrops just apply their effects to every enemy", () => {
    const world = bandsWorld([testEnemy({ hp: 30, maxHP: 30 }), testEnemy({ hp: 30, maxHP: 30 })]);
    give(world, "caltrops_jacks");
    forceDice(2, 2, 1, 1);
    const { world: w } = engine.input(world, "throw jacks");
    expect(w.game.combat!.enemies.every((e) => e.hp === 28)).toBe(true);
  });
});

describe("dash, defend, and loose junk", () => {
  it("dash covers double movement and ends the turn", () => {
    const world = gridWorld(["@.......a"], [testEnemy({ hp: 30, maxHP: 30, speed: 1 })]);
    forceDice(1);
    const { world: w } = engine.input(world, "dash h1");
    expect(arenaOf(w).crawler).toEqual({ x: 7, y: 0 });
    expect(w.game.combat!.round).toBe(2);
  });

  it("defend: +4 defense until your next turn, and it ends when that turn starts", () => {
    const world = gridWorld(["@a"], [testEnemy()]);
    forceDice(10); // rat: 10 + 5 = 15 vs your defense
    const { world: w, events } = engine.input(world, "defend");
    expect(lines(events)).toMatch(/vs your \d+/);
    const def = Number(/vs your (\d+)/.exec(lines(events))![1]);
    const plain = gridWorld(["@a"], [testEnemy()]);
    forceDice(10);
    const p = engine.input(plain, "wait");
    expect(def - Number(/vs your (\d+)/.exec(lines(p.events))![1])).toBe(4);
    expect(w.game.crawler!.statuses.some((s) => s.id === "braced")).toBe(true);
    forceDice(1, 1);
    const next = engine.input(w, "attack");
    expect(next.world.game.crawler!.statuses.some((s) => s.id === "braced")).toBe(false);
  });

  it("junk on the board can be picked up next to you for a tile of movement, and returns to the room after", () => {
    const world = gridWorld(["@..a.", "....."], [testEnemy({ hp: 1, maxHP: 10 })]);
    arenaOf(world).items.push({ x: 1, y: 0, item: itemFromRef(content, "lead_pipe") }, { x: 4, y: 0, item: itemFromRef(content, "thumbtacks") });
    const v = engine.view(world).combat!.grid!;
    expect(v.tiles.find((t) => t.coord === "b1")!.tap).toBe("take length of lead pipe");
    let w = engine.input(world, "take lead pipe").world;
    expect(w.game.crawler!.inventory.some((i) => i.baseId === "lead_pipe")).toBe(true);
    expect(arenaOf(w).moveLeft).toBe(3);
    w = engine.input(w, "wield lead pipe").world;
    expect(arenaOf(w).moveLeft).toBe(2);
    // finish the fight (two steps in, one swing); the tacks go back on the room floor
    forceDice(19, 6);
    w = engine.input(w, "attack").world;
    expect(w.game.phase).toBe("exploring");
    const room = w.game.floor!.rooms[w.game.floor!.currentRoom]!;
    expect(room.items!.some((i) => i.baseId === "thumbtacks")).toBe(true);
  });

  it("a real grid fight scatters the room's junk on the board", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    world.account.settings = { combatMode: "grid" };
    world.game.crawler!.hp = 500;
    const floor = world.game.floor!;
    const room = floor.rooms[floor.currentRoom]!;
    room.items = [itemFromRef(content, "lead_pipe"), itemFromRef(content, "duct_tape")];
    const ctx = new StepContext(world, content);
    startCombat(ctx, [testEnemy({ uid: "x1", hp: 50, maxHP: 50 }), testEnemy({ uid: "x2", hp: 50, maxHP: 50 })]);
    const a = ctx.game.combat!.arena!;
    expect(a.items.map((i) => i.item.baseId)).toEqual(expect.arrayContaining(["lead_pipe", "duct_tape"]));
    expect(room.items).toBeUndefined();
  });
});
