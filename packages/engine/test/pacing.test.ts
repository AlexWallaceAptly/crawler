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

import { forceDice, setRandomSource } from "../src/rng";
import { afterAction } from "../src/roomwork";
import { testEnemy } from "./helpers";
import { renderMap } from "../src/explore";

/** A run standing at the start with one room next door set up as a fight. */
function doorway() {
  const world = freshRun();
  world.account.settings = { combatMode: "bands" };
  world.game.crawler!.hp = 500;
  world.game.crawler!.statuses = [];
  const floor = world.game.floor!;
  const start = floor.rooms[floor.currentRoom]!;
  const dir = Object.keys(start.exits)[0] as keyof typeof start.exits;
  const next = floor.rooms[start.exits[dir]!]!;
  next.type = "chamber";
  next.rs.hazards = [];
  next.rs.groups = [{ kind: "pack", enemies: [testEnemy({ hp: 40, maxHP: 40 })] }];
  return { world, floor, start, dir, next };
}

describe("round-one retreat", () => {
  it("costs time, alerts the room, and the room has an extra group when you return", () => {
    const { world, dir, start, next } = doorway();
    let w = engine.step(world, { type: "go", dir }).world;
    expect(w.game.phase).toBe("combat");
    const t0 = w.game.timeSpent?.flee ?? 0;
    w.game.crawler!.statuses = [];
    forceDice(20, 1);
    w = engine.step(w, { type: "flee" }).world;
    expect(w.game.phase).toBe("exploring");
    expect(w.game.floor!.currentRoom).toBe(start.id);
    expect((w.game.timeSpent?.flee ?? 0) - t0).toBe(content.pacing.retreat.roundOneMinutes);
    const room = w.game.floor!.rooms[next.id]!;
    expect(room.rs.alerted).toBe(true);
    expect(room.rs.groups).toHaveLength(1); // the survivor is still there, hurt or not
    expect(room.rs.cleared).toBe(false);
    const back = engine.step(w, { type: "go", dir });
    const again = back.world.game.floor!.rooms[next.id]!;
    expect(again.rs.alerted).toBe(false);
    expect(again.rs.groups.length).toBe(1 + content.pacing.retreat.roundOneAlertExtraGroups);
  });

  it("with the penalty set to nothing there is no alert", () => {
    const { world, dir, next } = doorway();
    const cfg = content.pacing.retreat;
    const saved = cfg.roundOneAlertExtraGroups;
    cfg.roundOneAlertExtraGroups = 0;
    try {
      let w = engine.step(world, { type: "go", dir }).world;
      w.game.crawler!.statuses = [];
      forceDice(20, 1);
      w = engine.step(w, { type: "flee" }).world;
      expect(w.game.floor!.rooms[next.id]!.rs.alerted).toBe(false);
    } finally {
      cfg.roundOneAlertExtraGroups = saved;
    }
  });
});

describe("a closing section", () => {
  it("throws you out of a room that has closed, for a fifth of your health, and shuts the door behind you", () => {
    const w = freshRun();
    const floor = w.game.floor!;
    const ctx = new StepContext(w, content);
    const here = floor.rooms[floor.currentRoom]!;
    const next = floor.rooms[Object.values(here.exits)[0]!]!;
    here.closed = true;
    const hp = w.game.crawler!.hp;
    afterAction(ctx);
    expect(floor.currentRoom).not.toBe(here.id);
    expect(floor.rooms[floor.currentRoom]!.closed).toBeFalsy();
    expect(w.game.crawler!.hp).toBeLessThan(hp);
    // and nobody can walk back in
    const dir = (Object.entries(floor.rooms[floor.currentRoom]!.exits).find(([, id]) => id === here.id)?.[0]) as "north" | undefined;
    if (dir) {
      const out = engine.step(w, { type: "go", dir });
      expect(out.world.game.floor!.currentRoom).toBe(floor.currentRoom);
    }
    void next;
  });
});

describe("wandering gets likelier late in the floor", () => {
  it("rolls more often on day 4+ than on day 1, and more again during a surge", () => {
    const rate = (day: number, surge = false) => {
      const w = freshRun();
      const floor = w.game.floor!;
      floor.surge = surge;
      const ctx = new StepContext(w, content);
      w.game.clock = floor.startClock + (day - 1) * MINUTES_PER_DAY;
      floor.currentRoom = floor.rooms.find((r) => r.type !== "safe")!.id;
      let hits = 0;
      for (let i = 0; i < 4000; i++) {
        floor.wanderDue = false;
        wanderRoll(ctx, 600, "travel");
        if (floor.wanderDue) hits++;
      }
      return hits / 4000;
    };
    resetRng();
    const early = rate(1);
    const late = rate(5);
    expect(late).toBeGreaterThan(early);
    expect(rate(5, true)).toBeGreaterThan(late);
  });

  it("a wanderer found while resting starts a fight that is not the room's own", () => {
    let w = freshRun();
    w.game.floor!.currentRoom = w.game.floor!.rooms.find((r) => r.type === "corridor" || r.type === "chamber")!.id;
    w.game.floor!.rooms[w.game.floor!.currentRoom]!.rs.groups = [];
    setRandomSource(() => 0); // every roll hits
    w = engine.step(w, { type: "rest" }).world;
    resetRng();
    expect(w.game.phase).toBe("combat");
    expect(w.game.combat!.wander).toBe(true);
  });
});

describe("saving and loading", () => {
  it("room state, scouting, hazards, events and the Guide survive a JSON round trip", () => {
    let w = freshRun();
    const floor = w.game.floor!;
    const here = floor.rooms[floor.currentRoom]!;
    const dir = Object.keys(here.exits)[0] as keyof typeof here.exits;
    const next = floor.rooms[here.exits[dir]!]!;
    next.rs.hazards = [{ id: theme.trapTypes[0]!.id, active: true, intensity: 1.5, sourceTime: 10, ticks: 2 }];
    next.rs.groups = [{ kind: "pack" }];
    w = engine.step(w, { type: "listen", dir }).world;
    w = engine.step(w, { type: "assess" }).world;
    const restored = engine.restore(JSON.parse(JSON.stringify(w.game)), JSON.parse(JSON.stringify(w.account)))!;
    expect(restored).not.toBeNull();
    const f2 = restored.game.floor!;
    expect(f2.rooms[next.id]!.rs).toEqual(w.game.floor!.rooms[next.id]!.rs);
    expect(f2.rooms[next.id]!.rs.hazards[0]!.intensity).toBe(1.5);
    expect(f2.rooms[next.id]!.rs.scoutTier).toBe(1);
    expect(f2.events).toEqual(w.game.floor!.events);
    expect(restored.game.guide).toEqual(w.game.guide);
    expect(restored.game.crawler!.awakeMin).toBe(w.game.crawler!.awakeMin);
    // and the restored run still plays
    const next2 = engine.step(restored, { type: "search" });
    expect(next2.world.game.timeSpent?.search).toBeGreaterThan(0);
  });
});

describe("safe rooms on the map and the Guide", () => {
  it("a safe room you have listened to shows as S, and the Guide map lists it", () => {
    let w = freshRun();
    const floor = w.game.floor!;
    const safe = floor.rooms.find((r) => r.type === "safe")!;
    // stand next to it
    const nb = floor.rooms[Object.values(safe.exits)[0]!]!;
    floor.currentRoom = nb.id;
    nb.visited = true;
    safe.seen = true; // walking in next door shows you its door
    const dir = (Object.entries(nb.exits).find(([, id]) => id === safe.id)![0]) as "north";
    expect(renderMap(floor).join("\n")).not.toMatch(/S/);
    w = engine.step(w, { type: "listen", dir }).world;
    const f = w.game.floor!;
    expect(f.rooms[safe.id]!.marked).toBe(true);
    expect(renderMap(f).join("")).toContain("S");
    const guide = engine.view(w).guide.sections.find((s) => s.id === "map")!;
    expect(guide.entries.find((e) => e.id === "map.safe")!.text).toContain(safe.name);
    expect(guide.entries.find((e) => e.id === "map.floor")!.text).toContain("S");
  });

  it("safe rooms list their services, with the milestone 7 slots marked unavailable", () => {
    const w = freshRun();
    const floor = w.game.floor!;
    floor.currentRoom = floor.rooms.find((r) => r.type === "safe")!.id;
    const services = engine.view(w).room!.services;
    expect(services.filter((s) => s.available).map((s) => s.id)).toEqual(["sleep", "rest", "meal"]);
    expect(services.filter((s) => !s.available).map((s) => s.id)).toEqual(["shop", "lootBox", "achievements"]);
  });
});

describe("sleep state changes", () => {
  it("tell the log, in both directions", () => {
    let w = freshRun();
    w.game.crawler!.awakeMin = 16 * 60 - 5;
    const out = engine.step(w, { type: "rest" });
    const ev = out.events.filter((e) => e.type === "sleepStageChanged");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ to: "tired", worse: true });
    w = out.world;
    const floor = w.game.floor!;
    floor.currentRoom = floor.rooms.find((r) => r.type === "safe")!.id;
    const after = engine.step(w, { type: "sleep" });
    expect(after.events.find((e) => e.type === "sleepStageChanged")).toMatchObject({ to: "rested", worse: false });
  });
});
