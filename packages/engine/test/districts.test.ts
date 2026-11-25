/** Milestone 9: districts and elites on Floors 2-3. */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { bfsDistances, generateFloor } from "../src/gen/floor";
import { MAX_DISTRICT_SHARE, MIN_DISTRICT_SHARE } from "../src/gen/district";
import { seedRoomState } from "../src/gen/roomstate";
import { generateGroup } from "../src/gen/enemy";
import { describeRoom, enterFloor, enterRoom } from "../src/explore";
import { recordKill, wantsToFlee } from "../src/combat";
import { groupEnemies } from "../src/roomwork";
import { loadContent } from "../src/content/load";
import { rawContent } from "@crawler/content";
import { resetRng, setRandomSource } from "../src/rng";
import { StepContext } from "../src/step";
import { clone } from "../src/clone";
import { content, engine, of, testEnemy } from "./helpers";
import type { FloorState, Room, World } from "../src/state";

afterEach(() => resetRng());

const lobby = content.floors.get("welcome_lobby");
const warrens = content.floors.get("lost_and_found_warrens");
const garage = content.floors.get("flooded_parking_garage");

function exploring(): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  return world;
}

/** A fresh run moved onto a floor, the way descending gets there. */
function onFloor(theme = warrens): StepContext {
  const ctx = new StepContext(exploring(), content);
  enterFloor(ctx, theme);
  ctx.events.length = 0;
  return ctx;
}

/** Rooms of district `d`, and whether they hang together without leaving it. */
function connectedWithin(f: FloorState, d: number): boolean {
  const mine = f.rooms.filter((r) => r.district === d);
  const seen = new Set([mine[0]!.id]);
  const queue = [mine[0]!.id];
  while (queue.length) {
    for (const next of Object.values(f.rooms[queue.shift()!]!.exits)) {
      if (f.rooms[next]!.district === d && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen.size === mine.length;
}

describe("district generation (100 floors each of Floors 2-3)", () => {
  const floors: Record<string, FloorState[]> = {};
  beforeAll(() => {
    for (const theme of [warrens, garage]) {
      floors[theme.id] = Array.from({ length: 100 }, () => {
        const f = generateFloor(theme, { safe: content.pacing.safeRooms });
        seedRoomState(f, theme, content);
        return f;
      });
    }
  });
  const each = (fn: (f: FloorState, theme: typeof warrens) => void) => {
    for (const theme of [warrens, garage]) for (const f of floors[theme.id]!) fn(f, theme);
  };

  it("Floor 1 is one district and carries none of it", () => {
    const f = generateFloor(lobby, { safe: content.pacing.safeRooms });
    expect(f.districts).toBeUndefined();
    expect(f.rooms.every((r) => r.district === undefined)).toBe(true);
  });

  it("splits the floor into the theme's districts, every room in one", () => {
    expect(warrens.districts).toHaveLength(3);
    expect(garage.districts).toHaveLength(4);
    each((f, theme) => {
      expect(f.districts).toEqual(theme.districts.map((d) => d.id));
      for (const r of f.rooms) {
        expect(r.district).toBeGreaterThanOrEqual(0);
        expect(r.district).toBeLessThan(theme.districts.length);
      }
    });
  });

  it("each district hangs together, with a fair share of the rooms", () => {
    each((f, theme) => {
      const n = theme.districts.length;
      const even = f.rooms.length / n;
      for (let d = 0; d < n; d++) {
        expect(connectedWithin(f, d)).toBe(true);
        const size = f.rooms.filter((r) => r.district === d).length;
        expect(size).toBeGreaterThanOrEqual(even * MIN_DISTRICT_SHARE);
        expect(size).toBeLessThanOrEqual(even * MAX_DISTRICT_SHARE);
      }
    });
  });

  it("district 0 holds the entrance, and deeper districts are further from it", () => {
    each((f, theme) => {
      expect(f.rooms[f.startRoom]!.district).toBe(0);
      const dist = bfsDistances(f.rooms, f.startRoom);
      const mean = theme.districts.map((_, d) => {
        const mine = f.rooms.filter((r) => r.district === d);
        return mine.reduce((s, r) => s + dist[r.id]!, 0) / mine.length;
      });
      for (let d = 1; d < mean.length; d++) expect(mean[d]!).toBeGreaterThanOrEqual(mean[d - 1]!);
    });
  });

  it("every district has a safe room", () => {
    each((f, theme) => {
      for (let d = 0; d < theme.districts.length; d++) {
        expect(f.rooms.some((r) => r.district === d && r.type === "safe")).toBe(true);
      }
    });
  });

  it("every champion has one lair in its own district, away from stairs, beds and the boss", () => {
    each((f, theme) => {
      const special = (r: Room) => r.type === "stairwell" || r.type === "safe" || r.id === f.bossRoom;
      for (const [d, def] of theme.districts.entries()) {
        if (!def.champion) continue;
        const lairs = f.rooms.filter((r) => r.rs.groups.some((g) => g.champion === def.id));
        expect(lairs).toHaveLength(1);
        const lair = lairs[0]!;
        expect(lair.district).toBe(d);
        expect(lair.type).toBe("lair");
        expect(lair.id).not.toBe(f.startRoom);
        expect(special(lair)).toBe(false);
        expect(Object.values(lair.exits).some((id) => special(f.rooms[id]!))).toBe(false);
        // Just the champion's group: no extra pack, no hazard, not a dense room.
        expect(lair.rs.groups).toEqual([{ kind: "elite", champion: def.id }]);
        expect(lair.rs.hazards).toHaveLength(0);
        expect(lair.rs.dense).toBe(false);
      }
    });
  });

  it("is still fully reachable, with no route to the stairs far from a bed", () => {
    const cfg = content.pacing.safeRooms;
    each((f) => {
      const dist = bfsDistances(f.rooms, f.startRoom);
      expect(dist.every((d) => d >= 0)).toBe(true);
      const safes = f.rooms.filter((r) => r.type === "safe").map((s) => bfsDistances(f.rooms, s.id));
      const gap = f.rooms.map((r) => Math.min(...safes.map((d) => d[r.id]!)));
      for (const st of f.rooms.filter((r) => r.type === "stairwell")) expect(gap[st.id]).toBeLessThanOrEqual(cfg.maxGapRooms);
    });
  });
});

describe("district encounters", () => {
  it("a district's level offset lifts its enemies", () => {
    const mean = (offset: number) => {
      let sum = 0;
      for (let i = 0; i < 300; i++) sum += generateGroup(2, "elite", content, { levelOffset: offset })[0]!.level;
      return sum / 300;
    };
    const lift = mean(2) - mean(0);
    expect(lift).toBeGreaterThan(1.6);
    expect(lift).toBeLessThan(2.4);
  });

  it("favored families lead more often", () => {
    const n = 1500;
    let plain = 0;
    let favored = 0;
    for (let i = 0; i < n; i++) {
      if (generateGroup(2, "elite", content)[0]!.familyId === "umbrella_bat") plain++;
      if (generateGroup(2, "elite", content, { favored: ["umbrella_bat"] })[0]!.familyId === "umbrella_bat") favored++;
    }
    // 1 in 5 by default; 3 in 7 at the default weight of 3.
    expect(plain / n).toBeGreaterThan(0.14);
    expect(plain / n).toBeLessThan(0.26);
    expect(favored / n).toBeGreaterThan(0.36);
    expect(favored / n).toBeLessThan(0.5);
  });

  it("a champion is a titled elite with escorts, even when the floor asks for an easy fight", () => {
    const def = warrens.districts.find((d) => d.champion)!;
    const champ = { district: def.id, title: def.champion!.title, family: def.champion!.family, levelBonus: def.champion!.levelBonus };
    for (let i = 0; i < 50; i++) {
      const group = generateGroup(2, "elite", content, { champion: champ, easy: true });
      const [boss, ...escorts] = group;
      expect(boss!.tier).toBe("elite");
      expect(boss!.name).toBe(def.champion!.title);
      expect(boss!.champion).toBe(def.id);
      expect(boss!.familyId).toBe(def.champion!.family);
      expect(escorts.length).toBeGreaterThanOrEqual(warrens.encounters.eliteEscorts[0]);
      expect(escorts.every((e) => e.tier === "minion" && e.familyId === def.champion!.family)).toBe(true);
      expect(boss!.fleeBelow).toBe(0);
      expect(boss!.talkable).toBe(false);
    }
  });

  it("a champion stands its ground at 1 HP, and fear doesn't move it either", () => {
    const ctx = onFloor(garage);
    const def = garage.districts.find((d) => d.champion?.family === "valet_imp")!; // valet imps flee below 25%
    const champ = { district: def.id, title: def.champion!.title, family: def.champion!.family, levelBonus: 1 };
    const [chief] = generateGroup(3, "elite", content, { champion: champ });
    chief!.hp = 1;
    expect(chief!.ai.some((t) => t.startsWith("flee_below_") || t === "keep_range")).toBe(false);
    for (const token of [...content.enemies.get("valet_imp").ai, "flee_below_99"]) expect(wantsToFlee(ctx, chief!, token)).toBe(false);
    const imp = generateGroup(3, "pack", content)[0]!; // an ordinary enemy still runs
    imp.hp = 1;
    imp.fleeBelow = 0.5;
    expect(wantsToFlee(ctx, imp, "attack")).toBe(true);
  });

  it("the champion's lair rolls its champion inside the floor's easy opening fights", () => {
    const ctx = onFloor();
    const floor = ctx.game.floor!;
    expect(floor.fights).toBe(0);
    const lair = floor.rooms.find((r) => r.rs.groups.some((g) => g.champion))!;
    const enemies = groupEnemies(ctx, lair, lair.rs.groups[0]!);
    expect(enemies[0]!.champion).toBe(lair.rs.groups[0]!.champion);
    // The deeper the district, the higher the level: district index plus the champion's bonus over an elite.
    const def = warrens.districts[lair.district!]!;
    const base = 2 * 4 + warrens.encounters.levelOffset + lair.district! + def.champion!.levelBonus;
    expect(enemies[0]!.level).toBeGreaterThanOrEqual(base - 1);
    expect(enemies[0]!.level).toBeLessThanOrEqual(base + 2);
  });
});

describe("elite and champion boxes", () => {
  it("an elite kill pays a box: silver on silverChance, bronze otherwise", () => {
    const ctx = onFloor();
    setRandomSource(() => 0);
    recordKill(ctx, testEnemy({ tier: "elite", hp: 0 }), "swing");
    setRandomSource(() => 0.9);
    recordKill(ctx, testEnemy({ tier: "elite", hp: 0 }), "swing");
    resetRng();
    expect(of(ctx.events as never, "boxEarned").map((e) => e.tier)).toEqual(["silver", "bronze"]);
  });

  it("minions and mobs pay no box", () => {
    const ctx = onFloor();
    recordKill(ctx, testEnemy({ tier: "minion", hp: 0 }), "swing");
    recordKill(ctx, testEnemy({ tier: "mob", hp: 0 }), "swing");
    expect(of(ctx.events as never, "boxEarned")).toHaveLength(0);
  });

  it("a champion always pays its tier, says its last line, and the floor remembers", () => {
    const ctx = onFloor();
    const defs = warrens.districts.filter((d) => d.champion);
    for (const def of defs) recordKill(ctx, testEnemy({ tier: "elite", hp: 0, name: def.champion!.title, champion: def.id }), "swing");
    const boxes = of(ctx.events as never, "boxEarned");
    expect(boxes).toHaveLength(defs.length);
    expect(boxes.every((b) => b.tier === content.boxes.drops.champion && b.boxType === "boss")).toBe(true);
    const texts = ctx.events.filter((e) => e.type === "combatLine" || e.type === "narration").map((e) => (e as { text: string }).text);
    for (const def of defs) expect(texts).toContain(def.champion!.defeat);
    expect(ctx.events.filter((e) => e.type === "narration" && e.key === "champion.killed")).toHaveLength(defs.length);
    expect(ctx.game.floor!.championsKilled).toEqual(defs.map((d) => d.id));
    // The last one clears the floor's champions, once.
    expect(of(ctx.events as never, "championsCleared")).toHaveLength(1);
    expect(ctx.events.filter((e) => e.type === "kill" && e.champion)).toHaveLength(defs.length);
  });
});

describe("crossing into a district", () => {
  it("the entrance's district is announced when the floor starts, and shows in the status bar", () => {
    const ctx = new StepContext(exploring(), content);
    enterFloor(ctx, warrens);
    const entered = of(ctx.events as never, "districtEntered");
    expect(entered).toHaveLength(1);
    expect(entered[0]!.index).toBe(0);
    expect(entered[0]!.of).toBe(3);
    expect(ctx.events.some((e) => e.type === "narration" && e.text === warrens.districts[0]!.enter)).toBe(true);
    expect(engine.view(ctx.world).status.district).toBe(warrens.districts[0]!.name);
    expect(ctx.game.guide.some((g) => g.section === "districts" && g.id === "district.2.0")).toBe(true);
  });

  it("a new district is announced once; going back in is not", () => {
    const ctx = onFloor();
    const floor = ctx.game.floor!;
    const other = floor.rooms.find((r) => r.district === 1 && r.type !== "lair")!;
    enterRoom(ctx, other.id, "first");
    enterRoom(ctx, floor.startRoom, "revisit");
    enterRoom(ctx, other.id, "revisit");
    const entered = of(ctx.events as never, "districtEntered");
    expect(entered.map((e) => e.index)).toEqual([1]);
    expect(entered[0]!.allSeen).toBe(false);
    expect(ctx.game.crawler!.counters["districts.entered"] ?? 0).toBe(0); // counted when the step settles
    expect(floor.districtsSeen).toEqual([0, 1]);
  });

  it("seeing the last district says so", () => {
    const ctx = onFloor();
    const floor = ctx.game.floor!;
    for (const d of [1, 2]) enterRoom(ctx, floor.rooms.find((r) => r.district === d)!.id, "first");
    expect(of(ctx.events as never, "districtEntered").map((e) => e.allSeen)).toEqual([false, true]);
  });

  it("Floor 1 shows no district", () => {
    expect(engine.view(exploring()).status.district).toBeNull();
  });

  it("the map command names the district you're in", () => {
    const ctx = onFloor();
    const { events } = engine.step(ctx.world, { type: "map" });
    const info = events.find((e) => e.type === "info");
    expect(JSON.stringify(info)).toContain(`District: ${warrens.districts[0]!.name} (1 of 3)`);
  });

  it("a room's description can borrow from its district's flavor", () => {
    const district = warrens.districts[1]!;
    const room = { shape: "chamber", type: "chamber" } as Room;
    setRandomSource(() => 0); // every coin flip takes the district's line
    const lines = describeRoom(warrens, room, district);
    resetRng();
    expect(lines[1]).toBe(district.sights[0]);
    expect(lines[2]).toBe(district.sounds[0]);
  });

  it("a killed champion's Guide entry says it's dead", () => {
    const ctx = onFloor();
    const def = warrens.districts[0]!;
    recordKill(ctx, testEnemy({ tier: "elite", hp: 0, name: def.champion!.title, champion: def.id }), "swing");
    expect(ctx.game.guide.find((g) => g.id === "district.2.0")!.text).toContain("Dead.");
  });
});

describe("district content checks", () => {
  it("a district can only favor families from its floor's hard pool", () => {
    const raw = clone(rawContent) as unknown as { "floors.json": { districts?: { favored: string[] }[] }[] };
    raw["floors.json"][1]!.districts![0]!.favored = ["sump_rat"];
    expect(() => loadContent(raw as never)).toThrow(/favored/);
  });

  it("district ids are unique on a floor", () => {
    const raw = clone(rawContent) as unknown as { "floors.json": { districts?: { id: string }[] }[] };
    raw["floors.json"][1]!.districts![1]!.id = raw["floors.json"][1]!.districts![0]!.id;
    expect(() => loadContent(raw as never)).toThrow(/unique/);
  });
});
