import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import { loadContent } from "../src/content/load";
import { StepContext, isAllowed } from "../src/step";
import { startCombat } from "../src/combat";
import { buildArena, insideOf } from "../src/grid/arena";
import {
  bandOf, coord, dist, index, lineOfSight, pathField, parseCoord, blocksMove,
} from "../src/grid/geometry";
import { generateEnemy } from "../src/gen/enemy";
import { parseCommand } from "../src/parser";
import { forceDice, resetRng, setRandomSource } from "../src/rng";
import { rawContent } from "@crawler/content";
import { DIRS, type ArenaState, type Dir, type Enemy, type Room, type World } from "../src/state";
import type { GameEvent, GameEventType } from "../src/events";

const content = loadContent(rawContent as never);
const engine = createEngine(content);

const of = <T extends GameEventType>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const lines = (events: GameEvent[]) => of(events, "combatLine").map((e) => e.text).join("\n");

afterEach(() => resetRng());

function testEnemy(over: Partial<Enemy> = {}): Enemy {
  return {
    uid: `e${Math.random().toString(36).slice(2, 7)}`, familyId: "sump_rat", name: "Test Rat", level: 4, tier: "mob",
    stats: { STR: 4, DEX: 5, CON: 4, INT: 1, CHA: 1 },
    maxHP: 10, hp: 10, armor: 0, defense: 12, speed: 4,
    attacks: [{ name: "Bite", dice: "1d4", damageType: "physical", stat: "DEX", range: "close", ready: 0 }],
    ai: ["attack"], preferRange: "close", talkable: false, range: "close",
    statuses: [], regen: 0, fleeBelow: 0, initiative: 5, xp: 10,
    ...over,
  };
}

const FEATURES: Record<string, string> = { "#": "pillar", "%": "rubble", "=": "crate", "~": "sludge" };
const HAZARDS: Record<string, string> = { "^": "steam_vent", "*": "caltrops" };

/**
 * A grid fight from ASCII: `.` floor, `#` pillar, `%` rubble, `=` crate, `~` sludge,
 * `^` steam vent, `*` caltrops, `@` you, `a`-`h` the enemies in order,
 * `D` the door you came in by, `d` another door (direction from its edge).
 */
function gridWorld(rows: string[], enemies: Enemy[]): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  const c = world.game.crawler!;
  c.baseStats = { STR: 10, DEX: 6, CON: 8, INT: 4, CHA: 8 };
  c.skills = {};
  c.statuses = [];
  c.inventory = [{
    uid: "w1", baseId: "test_club", kind: "gear", name: "Test Club", rarity: "common",
    slot: "mainHand", damage: "1d6", damageType: "physical", stat: "STR",
    modifiers: [], weight: 1, value: 0, qty: 1, tags: [],
  }];
  c.equipment = { mainHand: "w1" };
  c.hp = 34;
  world.account.settings = { combatMode: "grid" };
  const h = rows.length;
  const w = rows[0]!.length;
  const arena: ArenaState = { w, h, tiles: new Array(w * h).fill(""), hazards: [], items: [], exits: [], crawler: { x: 0, y: 0 }, moveLeft: 0 };
  const edgeDir = (x: number, y: number): Dir => (x === 0 ? "west" : x === w - 1 ? "east" : y === 0 ? "north" : "south");
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const p = { x, y };
    if (FEATURES[ch]) arena.tiles[index(arena, p)] = FEATURES[ch]!;
    else if (HAZARDS[ch]) arena.hazards.push({ ...p, id: HAZARDS[ch]! });
    else if (ch === "@") arena.crawler = p;
    else if (ch === "D" || ch === "d") arena.exits.push({ ...p, dir: edgeDir(x, y), entry: ch === "D" });
    else if (ch >= "a" && ch <= "h") enemies[ch.charCodeAt(0) - 97]!.pos = p;
  }));
  for (const e of enemies) e.range = bandOf(dist(e.pos!, arena.crawler));
  world.game.combat = {
    mode: "grid", enemies, round: 1, playerInitiative: 15, minorActionsUsed: 0, turnBegun: false,
    fromRoom: world.game.floor!.currentRoom, arena,
  };
  world.game.phase = "combat";
  return world;
}

function arenaOf(world: World): ArenaState {
  return world.game.combat!.arena!;
}

describe("grid geometry", () => {
  const arena = (rows: string[]): ArenaState => {
    const w = gridWorld(rows, []);
    return arenaOf(w);
  };

  it("bands come from tile distance: close <= 1, near 2-3, far 4+", () => {
    expect([0, 1, 2, 3, 4, 9].map(bandOf)).toEqual(["close", "close", "near", "near", "far", "far"]);
  });

  it("pillars and crates block sight; rubble and sludge don't; sight is symmetric", () => {
    const a = arena(["@.#..", ".....", "@.%..", "@.=..", "@.~.."]);
    expect(lineOfSight(a, content, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(lineOfSight(a, content, { x: 4, y: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(lineOfSight(a, content, { x: 0, y: 2 }, { x: 4, y: 2 })).toBe(true);
    expect(lineOfSight(a, content, { x: 0, y: 3 }, { x: 4, y: 3 })).toBe(false);
    expect(lineOfSight(a, content, { x: 0, y: 4 }, { x: 4, y: 4 })).toBe(true);
    // adjacent tiles always see each other
    expect(lineOfSight(a, content, { x: 1, y: 0 }, { x: 2, y: 1 })).toBe(true);
  });

  it("a diagonal step squeezing between two obstacles is blocked; past one corner is fine", () => {
    const a = arena(["@#.", "#..", "..."]);
    const field = pathField(a, content, { x: 0, y: 0 });
    expect(field.cost[index(a, { x: 1, y: 1 })]).toBe(Infinity);
    const b = arena(["@#.", "...", "..."]);
    expect(pathField(b, content, { x: 0, y: 0 }).cost[index(b, { x: 1, y: 1 })]).toBe(1);
  });

  it("sludge costs two movement", () => {
    const a = arena(["@~.", "###"]);
    const field = pathField(a, content, { x: 0, y: 0 });
    expect(field.cost[index(a, { x: 1, y: 0 })]).toBe(2);
    expect(field.cost[index(a, { x: 2, y: 0 })]).toBe(3);
  });

  it("coordinates are column letter + row number from the top", () => {
    expect(coord({ x: 2, y: 3 })).toBe("c4");
    expect(parseCoord("c4")).toEqual({ x: 2, y: 3 });
    expect(parseCoord("rat")).toBeNull();
  });
});

describe("arena generation", () => {
  const theme = content.floors.get("undercroft");
  const room = (shape: Room["shape"], exits: Dir[]): Room => ({
    id: 0, x: 0, y: 0, type: shape === "corridor" ? "corridor" : "chamber", shape, name: "Test", visited: true,
    seen: true, searched: false, desc: null,
    exits: Object.fromEntries(exits.map((d, i) => [d, i + 1])),
  });

  it("every enemy and door is reachable, nothing sits on a door, spawns are distinct (200 per shape and entry)", () => {
    for (const shape of ["corridor", "small", "chamber"] as const) {
      for (const entry of DIRS) {
        for (let i = 0; i < 200; i++) {
          const exits = DIRS.filter((d) => d === entry || Math.random() < 0.5);
          const family = content.enemies.all[i % content.enemies.all.length]!;
          const enemies = [0, 1, 2, 3].slice(0, 2 + (i % 3)).map(() => generateEnemy(family, "minion", 1, content));
          const ambush = i % 4 === 0 ? new Set([enemies[0]!.uid]) : new Set<string>();
          const a = buildArena({ room: room(shape, exits), theme, entry, enemies, ambushers: ambush }, content);
          const expected = shape === "corridor"
            ? (entry === "north" || entry === "south" ? [4, 9] : [9, 4])
            : shape === "small" ? [6, 6] : [8, 8];
          expect([a.w, a.h]).toEqual(expected);
          expect(a.exits).toHaveLength(exits.length);
          expect(a.exits.filter((x) => x.entry)).toHaveLength(1);
          expect(blocksMove(a, content, a.crawler)).toBe(false);
          const field = pathField(a, content, a.crawler);
          const spots = new Set<string>([coord(a.crawler)]);
          for (const e of enemies) {
            expect(e.pos).toBeDefined();
            expect(blocksMove(a, content, e.pos!)).toBe(false);
            expect(field.cost[index(a, e.pos!)]).toBeLessThan(Infinity);
            spots.add(coord(e.pos!));
            if (!ambush.has(e.uid)) expect(dist(e.pos!, a.crawler)).toBeGreaterThanOrEqual(3);
            else expect(dist(e.pos!, a.crawler)).toBeLessThanOrEqual(3);
          }
          expect(spots.size).toBe(enemies.length + 1);
          for (const x of a.exits) {
            expect(field.cost[index(a, x)]).toBeLessThan(Infinity);
            expect(a.tiles[index(a, x)]).toBe("");
            expect(blocksMove(a, content, insideOf(a.w, a.h, x))).toBe(false);
          }
          const entryDoor = a.exits.find((x) => x.entry)!;
          expect(a.crawler).toEqual(insideOf(a.w, a.h, entryDoor));
        }
      }
    }
  });

  it("a real grid fight builds an arena and puts everyone on it", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    world.account.settings = { combatMode: "grid" };
    world.game.crawler!.hp = 500;
    const ctx = new StepContext(world, content);
    const family = content.enemies.get("sump_rat");
    startCombat(ctx, [0, 1, 2].map(() => generateEnemy(family, "minion", 1, content)));
    const combat = ctx.game.combat!;
    expect(combat.mode).toBe("grid");
    expect(combat.arena).toBeDefined();
    for (const e of combat.enemies) expect(e.pos).toBeDefined();
    expect(engine.view(ctx.world).combat!.grid!.units).toHaveLength(4);
  });
});

describe("grid fights", () => {
  it("an adjacent swing uses the same to-hit and damage math as bands", () => {
    const world = gridWorld(["@a.."], [testEnemy()]);
    forceDice(10, 4, /* rat swings back */ 2);
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(w.game.combat!.enemies[0]!.hp).toBe(1);
    expect(lines(events)).toContain("9 damage");
  });

  it("attacking out of reach walks into reach first, then swings", () => {
    const world = gridWorld(["@...a"], [testEnemy()]);
    forceDice(10, 4, 1);
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(arenaOf(w).crawler).toEqual({ x: 3, y: 0 });
    expect(lines(events)).toContain("9 damage");
  });

  it("if the walk falls short, the turn ends with a can't-reach", () => {
    const world = gridWorld(["@.....a"], [testEnemy({ speed: 1 })]);
    forceDice(1); // the rat steps up and whiffs
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(arenaOf(w).crawler).toEqual({ x: 4, y: 0 });
    expect(events.some((e) => e.type === "narration" && e.key === "combat.cantReach")).toBe(true);
    expect(w.game.combat!.enemies[0]!.pos).toEqual({ x: 5, y: 0 });
    expect(w.game.combat!.round).toBe(2);
  });

  it("moving doesn't end the turn; movement is capped at speed", () => {
    const world = gridWorld(["@.......", "........"], [testEnemy({ pos: undefined })].slice(0, 0));
    world.game.combat!.enemies = [testEnemy({ hp: 50, maxHP: 50 })];
    world.game.combat!.enemies[0]!.pos = { x: 7, y: 1 };
    const r1 = engine.input(world, "move c1");
    expect(arenaOf(r1.world).crawler).toEqual({ x: 2, y: 0 });
    expect(arenaOf(r1.world).moveLeft).toBe(2);
    expect(r1.world.game.combat!.round).toBe(1);
    const r2 = engine.input(r1.world, "move h1");
    expect(of(r2.events, "error")).toHaveLength(1);
    expect(arenaOf(r2.world).crawler).toEqual({ x: 2, y: 0 });
    const r3 = engine.input(r1.world, "e 2");
    expect(arenaOf(r3.world).crawler).toEqual({ x: 4, y: 0 });
    expect(arenaOf(r3.world).moveLeft).toBe(0);
  });

  it("slowed moves one tile, hasted six", () => {
    const slow = gridWorld(["@.......", ".......a"], [testEnemy({ hp: 50, maxHP: 50 })]);
    slow.game.crawler!.statuses = [{ id: "slowed", remaining: 2, stacks: 1 }];
    const r1 = engine.input(slow, "move e 3");
    expect(arenaOf(r1.world).crawler).toEqual({ x: 1, y: 0 });

    const fast = gridWorld(["@.......", ".......a"], [testEnemy({ hp: 50, maxHP: 50 })]);
    fast.game.crawler!.statuses = [{ id: "hasted", remaining: 2, stacks: 1 }];
    const r2 = engine.input(fast, "move e 6");
    expect(arenaOf(r2.world).crawler).toEqual({ x: 6, y: 0 });
  });

  it("a stunned crawler's first command, even a move, ends the turn", () => {
    const world = gridWorld(["@......a"], [testEnemy({ speed: 1 })]);
    world.game.crawler!.statuses = [{ id: "stunned", remaining: 1, stacks: 1 }];
    const { world: w, events } = engine.input(world, "move e 2");
    expect(arenaOf(w).crawler).toEqual({ x: 0, y: 0 });
    expect(lines(events)).toContain("stunned");
    expect(w.game.combat!.round).toBe(2);
  });

  it("a ranged goblin backs off to near range and shoots", () => {
    const goblin = testEnemy({
      name: "Test Goblin", ai: ["keep_range", "attack"], preferRange: "near",
      attacks: [{ name: "Hurled Debris", dice: "1d6", damageType: "physical", stat: "DEX", range: "near", ready: 0 }],
    });
    const world = gridWorld(["@a......", "........"], [goblin]);
    forceDice(1); // the throw misses
    const { world: w, events } = engine.step(world, { type: "wait" });
    const g = w.game.combat!.enemies[0]!;
    expect(dist(g.pos!, arenaOf(w).crawler)).toBe(3);
    expect(lines(events)).toContain("Hurled Debris");
  });

  it("a ranged enemy with a pillar in the way moves to get a clean line", () => {
    const goblin = testEnemy({
      name: "Test Goblin", ai: ["keep_range", "attack"], preferRange: "near",
      attacks: [{ name: "Hurled Debris", dice: "1d6", damageType: "physical", stat: "DEX", range: "near", ready: 0 }],
    });
    const world = gridWorld(["@.#a", "....", "...."], [goblin]);
    forceDice(1);
    const { world: w, events } = engine.step(world, { type: "wait" });
    const a = arenaOf(w);
    const g = w.game.combat!.enemies[0]!;
    expect(lineOfSight(a, content, g.pos!, a.crawler)).toBe(true);
    expect(lines(events)).toContain("Hurled Debris");
  });

  it("melee enemies path around obstacles and never through each other", () => {
    const rat = testEnemy({ speed: 5 });
    const world = gridWorld(["@.#.a", "..#..", "....."], [rat]);
    forceDice(1);
    const { world: w } = engine.step(world, { type: "wait" });
    const r = w.game.combat!.enemies[0]!;
    expect(dist(r.pos!, arenaOf(w).crawler)).toBe(1);
    expect(blocksMove(arenaOf(w), content, r.pos!)).toBe(false);
  });

  it("three enemies around you each get +2 to hit (pack bonus)", () => {
    const world = gridWorld(["a@b", ".c."], [testEnemy(), testEnemy(), testEnemy()]);
    forceDice(1, 1, 1);
    const { events } = engine.step(world, { type: "wait" });
    expect((lines(events).match(/\+2 pack/g) ?? []).length).toBe(3);
  });

  it("a fleeing enemy that reaches a door is gone, for no XP", () => {
    const coward = testEnemy({ ai: ["flee_below_50", "attack"], hp: 2, maxHP: 10 });
    const world = gridWorld(["@..ad"], [coward]);
    const xp = world.game.crawler!.xp;
    const { world: w, events } = engine.step(world, { type: "wait" });
    expect(of(events, "combatEnded")[0]!.outcome).toBe("victory");
    expect(w.game.crawler!.xp).toBe(xp);
  });

  it("fleeing out the door you came in lands back where you came from", () => {
    const world = gridWorld(["D@.....a"], [testEnemy()]);
    const floor = world.game.floor!;
    const here = floor.rooms[floor.currentRoom]!;
    const from = Object.values(here.exits)[0]!;
    world.game.combat!.fromRoom = from;
    // nobody within 3 tiles: walk to the door and out, no roll
    const { world: w, events } = engine.step(world, { type: "flee" });
    expect(of(events, "combatEnded")[0]!.outcome).toBe("fled");
    expect(w.game.floor!.currentRoom).toBe(from);
  });

  it("fleeing out another door walks you into that room (time passes)", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    const floor = world.game.floor!;
    const here = floor.rooms[floor.currentRoom]!;
    const dir = (Object.keys(here.exits) as Dir[])[0]!;
    const dest = here.exits[dir]!;
    floor.rooms[dest]!.type = "empty"; // no fight or trap waiting there
    const rows = ["........", "...@....", "........", "......a."];
    const g = gridWorld(rows, [testEnemy()]);
    g.game.floor = floor;
    const a = arenaOf(g);
    const door = dir === "north" ? { x: 3, y: 0 } : dir === "south" ? { x: 3, y: 3 } : dir === "west" ? { x: 0, y: 1 } : { x: 7, y: 1 };
    a.exits.push({ ...door, dir, entry: false });
    a.crawler = dir === "north" || dir === "south" ? { x: 3, y: dir === "north" ? 1 : 2 } : { x: dir === "west" ? 1 : 6, y: 1 };
    g.game.combat!.enemies[0]!.pos = { x: dir === "east" ? 0 : 7, y: dir === "south" ? 0 : 3 };
    const time = floor.timeLeft;
    const { world: w, events } = engine.step(g, { type: "flee" });
    expect(of(events, "combatEnded")[0]!.outcome).toBe("fled");
    expect(w.game.floor!.currentRoom).toBe(dest);
    expect(w.game.floor!.timeLeft).toBeLessThan(time);
  });

  it("a mid-fight save round-trips through JSON and the board renders", () => {
    const world = gridWorld(["@.#a", "..~.", "^..d"], [testEnemy()]);
    const restored = engine.restore(JSON.parse(JSON.stringify(world.game)), JSON.parse(JSON.stringify(world.account)));
    expect(restored).toEqual(world);
    const look = engine.step(world, { type: "look" });
    const info = of(look.events, "info")[0]!;
    expect(info.lines!.slice(0, 4)).toEqual(["   a b c d", " 1 @ . # r", " 2 . . ~ .", " 3 ^ . . +"]);
  });

  it("every tap and every button parses and is allowed", () => {
    const world = gridWorld(["@.#.a", "..~..", "^...b", "....d"], [testEnemy(), testEnemy({ talkable: true })]);
    const v = engine.view(world);
    const inputs = [
      ...v.combat!.grid!.tiles.map((t) => t.tap).filter((t): t is string => !!t),
      ...engine.commands(world).map((c) => c.input),
    ];
    expect(inputs.length).toBeGreaterThan(5);
    for (const input of inputs) {
      const parsed = parseCommand(input, world);
      expect(parsed.ok, input).toBe(true);
      if (parsed.ok) expect(isAllowed(world, parsed.action.type), input).toBe(true);
    }
    const tiles = v.combat!.grid!.tiles;
    expect(tiles.find((t) => t.coord === "e1")!.tap).toBe("attack e1");
    expect(tiles.find((t) => t.coord === "b1")!.tap).toBe("move b1");
    expect(tiles.find((t) => t.coord === "c1")!.tap).toBeUndefined(); // pillar
  });

  it("you can attack by tile", () => {
    const world = gridWorld(["@a", "b."], [testEnemy({ name: "Rat One" }), testEnemy({ name: "Rat Two" })]);
    forceDice(10, 4, 1, 1);
    const { events } = engine.input(world, "attack a2");
    expect(lines(events)).toContain("hit the Rat Two");
  });

  it("the combat mode is locked for the fight", () => {
    setRandomSource(() => 0.5);
    const world = gridWorld(["@.a"], [testEnemy()]);
    const r = engine.input(world, "set combat bands");
    expect(r.world.game.combat!.mode).toBe("grid");
    expect(r.world.account.settings!.combatMode).toBe("bands");
  });
});
