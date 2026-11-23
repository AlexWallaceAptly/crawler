/**
 * Fire meets oil on the board (grid/fire.ts), and where explosives and ranged weapons
 * turn up in a run (loot tables and floor scatter).
 */
import { afterEach, describe, expect, it } from "vitest";
import { arenaOf, content, engine, gridWorld, lines, testEnemy } from "./helpers";
import { forceDice, resetRng, setRandomSource } from "../src/rng";
import { itemFromRef } from "../src/gen/item";
import type { World } from "../src/state";

afterEach(() => resetRng());

function give(world: World, id: string, qty = 1) {
  world.game.crawler!.inventory.push(itemFromRef(content, id, qty));
}

function oil(world: World, tiles: [number, number][]) {
  for (const [x, y] of tiles) arenaOf(world).hazards.push({ x, y, id: "oil_slick" });
}

const at = (w: World, id: string) => arenaOf(w).hazards.filter((h) => h.id === id).map((h) => `${h.x},${h.y}`).sort();

describe("fire spreads to oil", () => {
  it("a molotov next to a slick sets the whole connected slick alight, and only that slick", () => {
    const world = gridWorld(["@.......", "........", "........", "........", ".......a"], [testEnemy({ hp: 30, maxHP: 30 })]);
    give(world, "molotov");
    oil(world, [[4, 1], [5, 1], [6, 1], [6, 2]]); // touches the molotov's 3x3 at d2
    oil(world, [[0, 4]]); // nowhere near
    setRandomSource(() => 0.99);
    forceDice(1, 1, 1, 1);
    const { world: w, events } = engine.input(world, "throw molotov at c2");
    expect(at(w, "oil_slick")).toEqual(["0,4"]);
    for (const t of ["4,1", "5,1", "6,1", "6,2"]) expect(at(w, "fire")).toContain(t);
    expect(lines(events)).toContain("Fire runs along the slick");
    const lit = arenaOf(w).hazards.find((h) => h.x === 6 && h.y === 2)!;
    expect(lit.rounds).toBe(content.arenaFeatures.get("oil_slick").flammable!.rounds);
  });

  it("whoever is standing on the slick when it goes up is standing in fire", () => {
    const rat = testEnemy({ hp: 30, maxHP: 30 });
    const world = gridWorld(["@.......", "........", "......a."], [rat]);
    give(world, "lighter_fluid");
    oil(world, [[4, 2], [5, 2], [6, 2]]);
    setRandomSource(() => 0.99);
    forceDice(1, 1, 1, 1, 1, 1);
    const { world: w, events } = engine.input(world, "throw lighter fluid at d3");
    const after = w.game.combat?.enemies[0];
    expect(lines(events)).toMatch(/standing in the fire|steps into the fire/i);
    expect(after ? after.hp : 0).toBeLessThan(30);
  });

  it("thrown oil next to a fire catches", () => {
    const world = gridWorld(["@.......", "........", "......a."], [testEnemy({ hp: 30, maxHP: 30 })]);
    give(world, "motor_oil");
    arenaOf(world).hazards.push({ x: 4, y: 1, id: "fire", rounds: 3 });
    setRandomSource(() => 0.99);
    forceDice(1, 1, 1, 1);
    const { world: w } = engine.input(world, "throw motor oil at c2"); // the plus reaches d2, next to the fire at e2
    expect(at(w, "oil_slick")).toEqual([]);
    expect(at(w, "fire")).toEqual(expect.arrayContaining(["2,0", "1,1", "2,1", "3,1", "2,2"]));
  });

  it("walking onto oil while you're burning lights it under you", () => {
    const world = gridWorld(["@.a....."], [testEnemy({ hp: 30, maxHP: 30, speed: 0 })]);
    oil(world, [[1, 0]]);
    world.game.crawler!.statuses.push({ id: "burning", remaining: 3, stacks: 1 });
    setRandomSource(() => 0.99);
    forceDice(1, 1, 1, 1, 1, 1, 1, 1);
    const { world: w, events } = engine.input(world, "move b1");
    expect(lines(events)).toContain("The oil at b1 catches");
    expect(at(w, "fire")).toContain("1,0");
  });

  it("a fire hit on something standing in oil lights the slick", () => {
    const rat = testEnemy({ hp: 40, maxHP: 40 });
    const world = gridWorld(["@a......"], [rat]);
    oil(world, [[1, 0], [2, 0]]);
    world.game.crawler!.inventory[0]!.damageType = "fire";
    setRandomSource(() => 0.99);
    forceDice(5, 5, 1, 1, 1, 1);
    const { world: w } = engine.step(world, { type: "attack", target: "test rat" });
    expect(at(w, "fire")).toEqual(["1,0", "2,0"]);
  });

  it("an ordinary hit on oil does nothing", () => {
    const world = gridWorld(["@a......"], [testEnemy({ hp: 40, maxHP: 40 })]);
    oil(world, [[1, 0]]);
    forceDice(5, 5, 1, 1);
    const { world: w } = engine.step(world, { type: "attack", target: "test rat" });
    expect(at(w, "oil_slick")).toEqual(["1,0"]);
  });
});

describe("explosives and ranged weapons in the loot", () => {
  it("every explosive and every found-able ranged weapon is in some loot table or recipe", () => {
    const inTables = new Set(content.lootTables.all.flatMap((t) => t.entries.map((e) => e.item)));
    const crafted = new Set(content.recipes.all.flatMap((r) => (r.output.kind === "item" ? [r.output.ref] : [])));
    const oddities = new Set(content.oddities.all.map((o) => o.id));
    const missing = content.items.consumables.all
      .filter((x) => x.type === "explosive" && !oddities.has(x.id) && !inTables.has(x.id) && !crafted.has(x.id))
      .map((x) => x.id);
    expect(missing).toEqual([]);
    expect(content.lootTables.get("ranged").entries.length).toBeGreaterThanOrEqual(10);
    for (const e of content.lootTables.get("ranged").entries) {
      const b = content.items.bases.get(e.item);
      expect(b.range === "near" || b.range === "far", b.id).toBe(true);
    }
  });

  it("each floor scatters its own throwables and some ranged weapons", () => {
    for (const f of content.floors.all) {
      const tables = f.loot.scatter.map((s) => s.table);
      expect(tables).toContain(`throwables_f${f.floor}`);
      expect(tables).toContain("ranged");
    }
    let throwables = 0;
    let ranged = 0;
    for (let i = 0; i < 5; i++) {
      let { world } = engine.newWorld();
      ({ world } = engine.step(world, { type: "accept" }));
      for (const r of world.game.floor!.rooms) {
        for (const it of [...(r.items ?? []), ...(r.hidden ?? [])]) {
          const def = content.items.consumables.byId[it.baseId];
          if (def?.tags.includes("thrown")) throwables += it.qty;
          if (it.range && it.range !== "close") ranged++;
        }
      }
    }
    expect(throwables / 5).toBeGreaterThanOrEqual(3);
    expect(ranged / 5).toBeGreaterThanOrEqual(1);
  });

  it("motor oil and lane oil spray leave a slick when thrown", () => {
    expect(content.items.consumables.get("motor_oil").hazard?.id).toBe("oil_slick");
    expect(content.items.consumables.get("bowling_ball_wax").hazard?.id).toBe("oil_slick");
  });
});
