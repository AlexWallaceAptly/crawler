import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import { loadContent } from "../src/content/load";
import { generateFloor, bfsDistances } from "../src/gen/floor";
import { seedFloorLoot } from "../src/gen/loot";
import { itemFromRef } from "../src/gen/item";
import { effectiveTags, findItems } from "../src/inventory";
import { mapGrid } from "../src/explore";
import { derive } from "../src/rules/derived";
import { parseCommand } from "../src/parser";
import { isAllowed } from "../src/step";
import { resetRng } from "../src/rng";
import { rawContent } from "@crawler/content";
import type { RoomType, World } from "../src/state";
import type { GameEvent, GameEventType } from "../src/events";

const content = loadContent(rawContent as never);
const engine = createEngine(content);
const theme = content.floors.get("welcome_lobby");

const of = <T extends GameEventType>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

afterEach(() => resetRng());

function freshRun(): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  return world;
}

/** A run standing in an empty room with nothing on the floor (so tests control what's there). */
function quietRoom(): World {
  const world = freshRun();
  const floor = world.game.floor!;
  const room = floor.rooms[floor.currentRoom]!;
  delete room.items;
  delete room.hidden;
  room.searched = false;
  return world;
}

describe("junk seeding", () => {
  it("rooms fill by type: treasure > chamber > corridor; stairwells stay empty; safe rooms have binding", () => {
    const totals = new Map<RoomType, { rooms: number; items: number }>();
    let workshops = 0;
    for (let i = 0; i < 200; i++) {
      const floor = generateFloor(theme, { safe: content.pacing.safeRooms });
      seedFloorLoot(floor, theme, content);
      for (const r of floor.rooms) {
        const t = totals.get(r.type) ?? { rooms: 0, items: 0 };
        t.rooms++;
        t.items += (r.items?.length ?? 0) + (r.hidden?.length ?? 0);
        totals.set(r.type, t);
        if (r.type === "stairwell") expect(r.items ?? []).toHaveLength(0);
        if (r.type === "safe") {
          expect(r.workbench).toBe(true);
          expect((r.items ?? []).some((it) => effectiveTags(it).includes("bind"))).toBe(true);
        }
      }
      const benches = floor.rooms.filter((r) => r.workbench && r.type !== "safe");
      expect(benches.length).toBeGreaterThanOrEqual(1);
      expect(benches.length).toBeLessThanOrEqual(2);
      workshops += benches.length;
      // the first safe room (nearest the start) holds the tutorial kit
      const d = bfsDistances(floor.rooms, floor.startRoom);
      const first = floor.rooms.filter((r) => r.type === "safe").sort((a, b) => d[a.id]! - d[b.id]!)[0]!;
      for (const id of ["lead_pipe", "thumbtacks", "duct_tape"]) {
        expect(first.items!.some((it) => it.baseId === id), id).toBe(true);
      }
    }
    const avg = (t: RoomType) => totals.get(t)!.items / totals.get(t)!.rooms;
    expect(avg("treasure")).toBeGreaterThan(avg("chamber"));
    expect(avg("chamber")).toBeGreaterThan(avg("corridor"));
    expect(workshops).toBeGreaterThan(200);
  });

  it("entering a room lists what's on the floor and offers to take it", () => {
    const world = quietRoom();
    const room = world.game.floor!.rooms[world.game.floor!.currentRoom]!;
    room.items = [itemFromRef(content, "duct_tape"), itemFromRef(content, "thumbtacks", 3)];
    const { events } = engine.step(world, { type: "look" });
    expect(of(events, "roomEntered")[0]!.items).toEqual(["Roll of Duct Tape", "Box of Thumbtacks ×3"]);
    const cmds = engine.commands(world).map((c) => c.input);
    expect(cmds).toContain("take roll of duct tape");
    expect(cmds).toContain("take all");
    for (const input of cmds) {
      const p = parseCommand(input, world);
      expect(p.ok, input).toBe(true);
      if (p.ok) expect(isAllowed(world, p.action.type), input).toBe(true);
    }
  });

  it("search turns up hidden things once, for the search cost", () => {
    const world = quietRoom();
    const floor = world.game.floor!;
    const room = floor.rooms[floor.currentRoom]!;
    room.hidden = [itemFromRef(content, "barbed_wire_coil")];
    const t = floor.timeLeft;
    const r1 = engine.step(world, { type: "search" });
    expect(r1.world.game.floor!.timeLeft).toBe(t - content.pacing.costs.search);
    const after = r1.world.game.floor!.rooms[floor.currentRoom]!;
    expect(after.items!.map((i) => i.baseId)).toEqual(["barbed_wire_coil"]);
    expect(after.hidden).toBeUndefined();
    expect(r1.events.some((e) => e.type === "narration" && e.key === "explore.searchFound")).toBe(true);
    const r2 = engine.step(r1.world, { type: "search" });
    expect(r2.events.some((e) => e.type === "narration" && e.key === "explore.searchNothing")).toBe(true);
  });
});

describe("inventory", () => {
  it("take and drop round-trip, and consumable stacks merge", () => {
    const world = quietRoom();
    const c = world.game.crawler!;
    c.inventory = c.inventory.filter((i) => i.baseId !== "thumbtacks");
    const room = world.game.floor!.rooms[world.game.floor!.currentRoom]!;
    room.items = [itemFromRef(content, "thumbtacks", 2), itemFromRef(content, "lead_pipe")];
    let w = engine.input(world, "take thumbtacks").world;
    w.game.floor!.rooms[w.game.floor!.currentRoom]!.items!.push(itemFromRef(content, "thumbtacks", 1));
    w = engine.input(w, "pick up thumbtacks").world;
    const tacks = w.game.crawler!.inventory.filter((i) => i.baseId === "thumbtacks");
    expect(tacks).toHaveLength(1);
    expect(tacks[0]!.qty).toBe(3);
    w = engine.input(w, "drop thumbtacks").world;
    expect(w.game.crawler!.inventory.some((i) => i.baseId === "thumbtacks")).toBe(false);
    const floorItems = w.game.floor!.rooms[w.game.floor!.currentRoom]!.items!;
    expect(floorItems.find((i) => i.baseId === "thumbtacks")!.qty).toBe(3);
  });

  it("take refuses what you can't carry", () => {
    const world = quietRoom();
    const c = world.game.crawler!;
    c.baseStats.STR = 3; // carry limit 32
    const room = world.game.floor!.rooms[world.game.floor!.currentRoom]!;
    room.items = [itemFromRef(content, "car_battery"), itemFromRef(content, "car_battery"), itemFromRef(content, "car_battery")];
    const { world: w, events } = engine.input(world, "take all");
    const limit = derive(w.game.crawler!, content).carryLimit;
    expect(derive(w.game.crawler!, content).carried).toBeLessThanOrEqual(limit);
    expect(events.some((e) => e.type === "narration" && e.key === "item.tooHeavy")).toBe(true);
    expect(w.game.floor!.rooms[w.game.floor!.currentRoom]!.items!.length).toBeGreaterThan(0);
  });

  it("equip swaps gear; a two-hander clears the off hand; armor soaks damage", () => {
    const world = quietRoom();
    const c = world.game.crawler!;
    c.inventory = [];
    c.equipment = {};
    c.inventory.push(itemFromRef(content, "lead_pipe"), itemFromRef(content, "trash_can_lid"), itemFromRef(content, "broom_handle"));
    const base = derive(c, content).armor;
    let w = engine.input(world, "wield lead pipe").world;
    w = engine.input(w, "equip trash can lid").world;
    let wc = w.game.crawler!;
    expect(wc.inventory.find((i) => i.uid === wc.equipment.mainHand)!.baseId).toBe("lead_pipe");
    expect(derive(wc, content).armor).toBe(base + 1);
    w = engine.input(w, "equip broom handle").world;
    wc = w.game.crawler!;
    expect(wc.inventory.find((i) => i.uid === wc.equipment.mainHand)!.baseId).toBe("broom_handle");
    expect(wc.equipment.offHand).toBeUndefined();
    expect(wc.inventory).toHaveLength(3); // nothing lost, just unequipped
  });

  it("name lookup prefers exact, then whole words, then substrings", () => {
    const items = [itemFromRef(content, "electrical_tape"), itemFromRef(content, "duct_tape"), itemFromRef(content, "lead_pipe")];
    expect(findItems(items, "roll of duct tape")[0]!.baseId).toBe("duct_tape");
    expect(findItems(items, "tape").map((i) => i.baseId)).toEqual(["electrical_tape", "duct_tape"]);
    expect(findItems(items, "pip")[0]!.baseId).toBe("lead_pipe");
  });

  it("effective tags include weapon type, weapon/armor and slot", () => {
    expect(effectiveTags(itemFromRef(content, "baseball_bat"))).toEqual(expect.arrayContaining(["blunt", "weapon", "slot:mainHand"]));
    expect(effectiveTags(itemFromRef(content, "trash_can_lid"))).toEqual(expect.arrayContaining(["plate", "armor", "slot:offHand"]));
  });
});

describe("workshops and save size", () => {
  it("a visited workshop shows on the minimap as a workshop", () => {
    const world = freshRun();
    const floor = world.game.floor!;
    const shop = floor.rooms.find((r) => r.workbench && r.type !== "safe")!;
    shop.visited = true;
    expect(mapGrid(floor).cells.find((c) => c.x === shop.x && c.y === shop.y)!.kind).toBe("workshop");
  });

  it("a seeded, fully described floor stays well under 250 KB of save", () => {
    const world = freshRun();
    for (const r of world.game.floor!.rooms) {
      r.visited = true;
      r.desc = ["a line of description", "another line", "a third"];
    }
    expect(JSON.stringify(world.game).length).toBeLessThan(250_000);
  });
});
