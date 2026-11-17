/** Shared fixtures for grid-combat tests. */
import { createEngine } from "../src/engine";
import { loadContent } from "../src/content/load";
import { bandOf, dist, index } from "../src/grid/geometry";
import { rawContent } from "@crawler/content";
import type { ArenaState, Dir, Enemy, World } from "../src/state";
import type { GameEvent, GameEventType } from "../src/events";

export const content = loadContent(rawContent as never);
export const engine = createEngine(content);

export const of = <T extends GameEventType>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
export const lines = (events: GameEvent[]) => of(events, "combatLine").map((e) => e.text).join("\n");

export function testEnemy(over: Partial<Enemy> = {}): Enemy {
  return {
    uid: `e${Math.random().toString(36).slice(2, 7)}`, familyId: "sump_rat", name: "Test Rat", level: 4, tier: "mob",
    stats: { STR: 4, DEX: 5, CON: 4, INT: 1, CHA: 1 },
    maxHP: 10, hp: 10, armor: 0, guard: 0, speed: 4,
    attacks: [{ name: "Bite", power: [1, 2, 3], damageType: "physical", stat: "DEX", range: "close", ready: 0 }],
    ai: ["attack"], preferRange: "close", talkable: false, range: "close",
    statuses: [], regen: 0, fleeBelow: 0, initiative: 5, xp: 10,
    ...over,
  };
}

export const FEATURES: Record<string, string> = { "#": "pillar", "%": "rubble", "=": "crate", "~": "sludge" };
export const HAZARDS: Record<string, string> = { "^": "steam_vent", "*": "caltrops" };

/**
 * A grid fight from ASCII: `.` floor, `#` pillar, `%` rubble, `=` crate, `~` sludge,
 * `^` steam vent, `*` caltrops, `@` you, `a`-`h` the enemies in order,
 * `D` the door you came in by, `d` another door (direction from its edge).
 */
export function gridWorld(rows: string[], enemies: Enemy[]): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  const c = world.game.crawler!;
  c.baseStats = { STR: 10, DEX: 6, CON: 8, INT: 4, CHA: 8 };
  c.skills = {};
  c.statuses = [];
  c.inventory = [{
    uid: "w1", baseId: "test_club", kind: "gear", name: "Test Club", rarity: "common",
    slot: "mainHand", power: [2, 4, 6], damageType: "physical", stat: "STR",
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
    mode: "grid", enemies, round: 1, playerInitiative: 15, ap: 0, apMax: 3, turnBegun: false,
    fromRoom: world.game.floor!.currentRoom, arena,
  };
  world.game.phase = "combat";
  return world;
}

export function arenaOf(world: World): ArenaState {
  return world.game.combat!.arena!;
}

