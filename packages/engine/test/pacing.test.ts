import { describe, expect, it } from "vitest";
import { content, engine } from "./helpers";
import { actionMinutes, sleepStage, sleepStageAt } from "../src/rules/sleep";
import { derive } from "../src/rules/derived";
import { resetRng } from "../src/rng";

function freshRun() {
  resetRng();
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  return world;
}

describe("sleep deprivation", () => {
  it("stages come from pacing.json by hours awake", () => {
    expect(sleepStageAt(content, 0).id).toBe("rested");
    expect(sleepStageAt(content, 16).id).toBe("tired");
    expect(sleepStageAt(content, 30).id).toBe("exhausted");
    expect(sleepStageAt(content, 41).id).toBe("delirious");
  });

  it("every action that costs time ages the crawler, and the stage hits the numbers", () => {
    const w = freshRun();
    const c = w.game.crawler!;
    const base = derive(c, content);
    expect(c.awakeMin ?? 0).toBeGreaterThanOrEqual(0);
    c.awakeMin = 41 * 60;
    expect(sleepStage(c, content).id).toBe("delirious");
    const tired = derive(c, content);
    expect(tired.guard).toBeLessThan(base.guard);
    expect(actionMinutes(c, content, 20)).toBe(25);
    const before = c.awakeMin;
    const next = engine.step(w, { type: "search" }).world;
    expect(next.game.crawler!.awakeMin).toBeGreaterThan(before);
  });

  it("time is booked by reason through the one clock", () => {
    const w = freshRun();
    const out = engine.step(w, { type: "search" }).world;
    expect(out.game.timeSpent?.search).toBeGreaterThan(0);
    const total = Object.values(out.game.timeSpent ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBe(out.game.clock);
  });
});

import { generateFloor, bfsDistances, MINUTES_PER_DAY } from "../src/gen/floor";
import { seedFloorLoot } from "../src/gen/loot";
import { seedRoomState } from "../src/gen/roomstate";
import { scheduleEvents, runEvents } from "../src/showEvents";
import { StepContext } from "../src/step";
import { clone } from "../src/clone";
import { escalateHazards } from "../src/explore";
import { dangerOf } from "../src/roomwork";
import { newRoomState } from "../src/state";

const theme = content.floors.get("welcome_lobby");
function seeded() {
  const floor = generateFloor(theme, { safe: content.pacing.safeRooms });
  seedFloorLoot(floor, theme, content);
  seedRoomState(floor, theme, content);
  scheduleEvents(floor, theme, content);
  return floor;
}

describe("room state at generation", () => {
  it("hides loot by default but keeps quest objects, safe rooms and the tutorial kit visible", () => {
    for (let i = 0; i < 20; i++) {
      const floor = seeded();
      for (const r of floor.rooms) {
        if (r.type !== "safe") for (const it of r.items ?? []) expect(it.plain).toBe(true);
        for (const it of r.hidden ?? []) expect(it.searchDc).toBeGreaterThanOrEqual(content.pacing.search.dcMin);
        expect(r.rs.hiddenTotal).toBe((r.hidden ?? []).reduce((n, it) => n + it.qty, 0));
        if (r.type === "safe") { expect(r.rs.groups).toHaveLength(0); expect(r.rs.hazards).toHaveLength(0); expect(r.hidden).toBeUndefined(); }
      }
    }
  });

  it("tags 15-25% of the ordinary rooms as dense, each with an extra group", () => {
    for (let i = 0; i < 20; i++) {
      const floor = seeded();
      const open = floor.rooms.filter((r) => r.id !== floor.startRoom && r.type !== "safe" && r.type !== "stairwell" && !r.boss);
      const dense = open.filter((r) => r.rs.dense);
      expect(dense.length / open.length).toBeGreaterThanOrEqual(0.1);
      expect(dense.length / open.length).toBeLessThanOrEqual(0.26);
      for (const r of dense) { expect(r.rs.groups.length).toBeGreaterThanOrEqual(1); expect(dangerOf(r)).toBe("dangerous"); }
    }
  });

  it("trap rooms hold a hazard; no hazard ever blocks a way (every room stays enterable)", () => {
    const floor = seeded();
    for (const r of floor.rooms.filter((r) => r.type === "trap")) expect(r.rs.hazards.length).toBe(1);
    for (const r of floor.rooms) expect(r.closed).toBeUndefined();
  });
});

describe("hazards", () => {
  it("grow with the days you stay away, up to a cap", () => {
    const w = freshRun();
    const ctx = new StepContext(w, content);
    const room = w.game.floor!.rooms[1]!;
    room.rs.hazards = [{ id: "x", active: true, intensity: 1, sourceTime: 0, ticks: 0 }];
    room.rs.lastVisit = 0;
    w.game.clock = 2 * MINUTES_PER_DAY;
    escalateHazards(ctx, room);
    expect(room.rs.hazards[0]!.intensity).toBeGreaterThan(1);
    w.game.clock = 400 * MINUTES_PER_DAY;
    room.rs.lastVisit = 0;
    room.rs.hazards[0]!.sourceTime = 0;
    escalateHazards(ctx, room);
    expect(room.rs.hazards[0]!.intensity).toBe(content.pacing.hazards.maxIntensity);
  });

  it("disarm costs time and, on success, switches the hazard off for good", () => {
    const w = freshRun();
    const floor = w.game.floor!;
    const room = floor.rooms[floor.currentRoom]!;
    room.rs.hazards = [{ id: theme.trapTypes[0]!.id, active: true, intensity: 1, sourceTime: 0, ticks: 0 }];
    w.game.crawler!.hp = 500;
    let w2 = w;
    for (let i = 0; i < 40 && room.rs.hazards[0]!.active; i++) {
      w2 = engine.step(w2, { type: "disarm" }).world;
      w2.game.crawler!.hp = 500;
      if (!w2.game.floor!.rooms[floor.currentRoom]!.rs.hazards[0]!.active) break;
    }
    expect(w2.game.floor!.rooms[floor.currentRoom]!.rs.hazards[0]!.active).toBe(false);
    expect(w2.game.timeSpent?.disarm).toBeGreaterThanOrEqual(content.pacing.hazards.disarmMinutes);
  });
});

describe("searching in passes and scouting", () => {
  it("each pass finds what is within reach; more passes reach deeper; nothing is found twice", () => {
    let w = freshRun();
    const floor = w.game.floor!;
    const room = floor.rooms[floor.currentRoom]!;
    room.hidden = [{ ...generateOne(), searchDc: 5 }, { ...generateOne(), searchDc: 60 }];
    room.rs.hiddenTotal = 2;
    for (let i = 0; i < 12; i++) w = engine.step(w, { type: "search" }).world;
    const after = w.game.floor!.rooms[floor.currentRoom]!;
    expect(after.rs.searchPasses).toBe(12);
    expect(after.hidden?.length).toBe(1); // dc 60 is out of reach even after 12 passes
    expect(after.items?.some((i) => i.searchDc === 5)).toBe(true);
  });

  it("listen costs time, reports a band and a hazard flag, and is kept in the Guide", () => {
    let w = freshRun();
    const floor = w.game.floor!;
    const here = floor.rooms[floor.currentRoom]!;
    const dir = Object.keys(here.exits)[0] as keyof typeof here.exits;
    const next = floor.rooms[here.exits[dir]!]!;
    next.rs.groups = [{ kind: "pack" }, { kind: "pack" }];
    w.game.crawler!.awakeMin = 0;
    w = engine.step(w, { type: "listen", dir }).world;
    const n = w.game.floor!.rooms[next.id]!;
    expect(n.rs.scoutTier).toBe(1);
    expect(n.rs.danger).toBe("dangerous");
    expect(w.game.guide.some((g) => g.section === "scouting")).toBe(true);
    expect(w.game.timeSpent?.scout).toBeGreaterThan(0);
  });

  it("assess names who is waiting and how much is hidden", () => {
    let w = freshRun();
    const floor = w.game.floor!;
    const room = floor.rooms[floor.currentRoom]!;
    room.rs.groups = [{ kind: "pack" }];
    room.hidden = [generateOne()];
    const out = engine.step(w, { type: "assess" });
    const text = JSON.stringify(out.events);
    expect(text).toContain("Waiting:");
    expect(text).toContain("Hidden: 1");
    expect(out.world.game.floor!.rooms[floor.currentRoom]!.rs.scoutTier).toBe(2);
  });
});

import { itemFromRef } from "../src/gen/item";
function generateOne() { return itemFromRef(content, "duct_tape"); }

describe("rooms remember", () => {
  it("a beaten group stays beaten; a fled one waits; the state survives a JSON round trip", () => {
    const w = freshRun();
    const floor = w.game.floor!;
    const room = floor.rooms[floor.currentRoom]!;
    room.rs.groups = [{ kind: "pack" }];
    room.rs.alerted = true;
    const copy = clone(w);
    expect(JSON.parse(JSON.stringify(copy)).game.floor.rooms[floor.currentRoom].rs.alerted).toBe(true);
    expect(newRoomState().cleared).toBe(false);
  });
});

describe("show events", () => {
  it("2-4 per floor, at least one reward and one reason to descend early, closing sections never cut the floor", () => {
    for (let i = 0; i < 60; i++) {
      const floor = seeded();
      const n = floor.events.length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(content.pacing.events.max);
      expect(floor.events.some((e) => e.type === "reward")).toBe(true);
      expect(floor.events.some((e) => e.type === "closing" || e.type === "surge")).toBe(true);
      for (const e of floor.events.filter((e) => e.type === "closing")) {
        const gone = new Set(e.rooms);
        const seen = new Set([floor.startRoom]);
        const q = [floor.startRoom];
        while (q.length) for (const nx of Object.values(floor.rooms[q.shift()!]!.exits)) if (!gone.has(nx) && !seen.has(nx)) { seen.add(nx); q.push(nx); }
        expect(seen.size).toBe(floor.rooms.length - gone.size);
        for (const id of e.rooms) expect(["safe", "stairwell"]).not.toContain(floor.rooms[id]!.type);
      }
    }
  });

  it("fire from the one clock: announced ahead into the Guide, then they start", () => {
    const w = freshRun();
    const floor = w.game.floor!;
    const ctx = new StepContext(w, content);
    const total = theme.days * MINUTES_PER_DAY;
    w.game.clock = floor.startClock + total - 1;
    runEvents(ctx);
    expect(floor.events.every((e) => e.announced && e.started)).toBe(true);
    expect(w.game.guide.some((g) => g.section === "events")).toBe(true);
    expect(floor.events.filter((e) => e.type === "closing").every((e) => e.rooms.every((id) => floor.rooms[id]!.closed))).toBe(true);
  });
});

describe("wandering", () => {
  it("never finds you in a safe room, and the rate grows late in the floor", () => {
    const w = freshRun();
    const floor = w.game.floor!;
    const ctx = new StepContext(w, content);
    const safe = floor.rooms.find((r) => r.type === "safe")!;
    floor.currentRoom = safe.id;
    for (let i = 0; i < 300; i++) wanderRollOnce(ctx);
    expect(floor.wanderDue).toBeFalsy();
  });
});
import { wanderRoll } from "../src/roomwork";
function wanderRollOnce(ctx: StepContext) { wanderRoll(ctx, 600, "travel"); }
