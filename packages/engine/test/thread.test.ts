/**
 * The thread layer (docs/DESIGN.md, "The thread"): Echo, Temper, shards, the Codex,
 * modules, floor bosses and their weaknesses.
 */
import { afterEach, describe, expect, it } from "vitest";
import { content, engine, of, testEnemy } from "./helpers";
import { StepContext } from "../src/step";
import { forceDice, resetRng, setRandomSource } from "../src/rng";
import { generateFloor, bfsDistances, bfsAvoiding } from "../src/gen/floor";
import {
  actOn, answerUrge, codexView, endingFor, maybeRoomShard, maybeUrge, shardFound, shiftTemper, sideOf, stageOn, wholenessOn,
} from "../src/echo";
import { enterRoom, springTrap } from "../src/explore";
import { effectsNow } from "../src/modules";
import { spawnBoss } from "../src/boss";
import { startCombat } from "../src/combat";
import { migrateAccount } from "../src/engine";
import { itemFromRef } from "../src/gen/item";
import type { Room, World } from "../src/state";

afterEach(() => resetRng());

function freshRun(): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  world.game.crawler!.hp = 500;
  return world;
}

const lobby = content.floors.get("welcome_lobby");

// ---------------------------------------------------------------- content

describe("thread content", () => {
  it("has 52 shards: three room shards and one boss throwaway on each of Floors 1-12, four on Floor 13", () => {
    expect(content.shards.all).toHaveLength(52);
    for (let f = 1; f <= 12; f++) {
      const on = content.shards.all.filter((s) => s.floor === f);
      expect(on.filter((s) => s.delivery === "room"), `floor ${f}`).toHaveLength(3);
      expect(on.filter((s) => s.delivery === "boss"), `floor ${f}`).toHaveLength(1);
      expect(on.every((s) => s.reaction), `floor ${f} reactions`).toBe(true);
    }
    const f13 = content.shards.all.filter((s) => s.floor === 13);
    expect(f13).toHaveLength(4);
    expect(f13.every((s) => s.reactionCalm && s.reactionFed)).toBe(true);
  });

  it("has a boss for every floor of the arc, and the Floor 1-3 bosses can fight", () => {
    expect(content.thread.floors).toHaveLength(13);
    for (const f of content.thread.floors) expect(content.bosses.has(f.boss)).toBe(true);
    for (const id of ["free_sample_mimic", "lost_property_golem", "valet_kraken"]) {
      expect(content.bosses.get(id).family, id).toBeDefined();
      expect(content.bosses.get(id).weakness.trigger, id).toBeDefined();
    }
  });

  it("unlocks every module from a real shard, and M01-M06 are built with parts that exist", () => {
    for (const m of content.modules.all) expect(content.shards.has(m.unlockedBy)).toBe(true);
    for (const id of ["M01", "M02", "M03", "M04", "M05", "M06"]) {
      const m = content.modules.get(id);
      expect(m.effects, id).toBeDefined();
      for (const p of m.parts) expect(content.items.consumables.has(p.item) || content.items.bases.has(p.item), p.item).toBe(true);
    }
  });

  it("gives every module a Codex recipe entry, and every Codex lore line is a real shard", () => {
    for (const m of content.modules.all) {
      expect(content.codex.all.some((e) => e.type === "recipe" && e.unlock.module === m.id), m.id).toBe(true);
    }
    expect(content.codex.all.filter((e) => e.type === "lore")).toHaveLength(6);
    expect(content.codex.all.filter((e) => e.type === "ending")).toHaveLength(3);
  });

  it("registers the workbook's 30 oddities as items", () => {
    expect(content.oddities.all).toHaveLength(30);
    for (const o of content.oddities.all) {
      expect(content.items.bases.has(o.id) || content.items.consumables.has(o.id), o.id).toBe(true);
    }
    expect(itemFromRef(content, "rues_braid_tie").rarity).toBe("legendary");
  });

  it("lays Floors 1-3 out as the Welcome Lobby, the Warrens and the Garage", () => {
    expect(content.floors.all.map((t) => [t.floor, t.id])).toEqual([
      [1, "welcome_lobby"], [2, "lost_and_found_warrens"], [3, "flooded_parking_garage"],
    ]);
  });
});

// ---------------------------------------------------------------- Echo and Temper

describe("Echo", () => {
  it("wakes in a vessel when the run starts, at Temper 0 with nothing found", () => {
    const { world, events } = engine.step(engine.newWorld().world, { type: "accept" });
    const e = world.game.echo!;
    expect(content.thread.vessels.some((v) => v.id === e.vessel)).toBe(true);
    expect(e.temper).toBe(0);
    expect(e.shards).toEqual([]);
    expect(of(events, "narration").some((n) => n.voice === "echo")).toBe(true);
  });

  it("gains Wholeness by floor: 0 on Floor 1, 8 on Floor 2, 96 on Floor 13", () => {
    expect(wholenessOn(content, 1)).toBe(0);
    expect(wholenessOn(content, 2)).toBe(8);
    expect(wholenessOn(content, 13)).toBe(96);
  });

  it("takes its stage from the act, not the Wholeness number (Floor 5 is Confident at 32%)", () => {
    expect(wholenessOn(content, 5)).toBe(32);
    expect(actOn(content, 5)).toBe(2);
    expect(stageOn(content, 5).name).toBe("Confident");
    expect(stageOn(content, 1).name).toBe("Cautious");
    expect(stageOn(content, 13).name).toBe("Whole");
  });

  it("picks the variant by Temper: Calm at -3 and below, Fed at +3 and above", () => {
    expect(sideOf(content, -5)).toBe("calm");
    expect(sideOf(content, -3)).toBe("calm");
    expect(sideOf(content, -2)).toBe("base");
    expect(sideOf(content, 2)).toBe("base");
    expect(sideOf(content, 3)).toBe("fed");
  });

  it("clamps Temper to -5..+5", () => {
    const ctx = new StepContext(freshRun(), content);
    shiftTemper(ctx, 20);
    expect(ctx.game.echo!.temper).toBe(5);
    shiftTemper(ctx, -40);
    expect(ctx.game.echo!.temper).toBe(-5);
  });

  it("caps resting's Calm push per floor, and the cap resets on a new floor", () => {
    let world = freshRun();
    for (let i = 0; i < 4; i++) world = engine.step(world, { type: "rest" }).world;
    expect(world.game.echo!.temper).toBe(-2);
    const floor = world.game.floor!;
    floor.currentRoom = floor.rooms.find((r) => r.type === "stairwell" && !r.boss)!.id;
    world = engine.step(world, { type: "descend" }).world;
    world = engine.step(world, { type: "rest" }).world;
    expect(world.game.echo!.temper).toBe(-3);
  });

  it("urges: letting Echo act pushes Fed and does the thing; hushing pushes Calm", () => {
    const world = freshRun();
    const room = world.game.floor!.rooms[world.game.floor!.currentRoom]!;
    room.hidden = [itemFromRef(content, "duct_tape")];
    const ctx = new StepContext(world, content);
    setRandomSource(() => 0); // the urge fires
    maybeUrge(ctx, "explore");
    resetRng();
    expect(ctx.game.echo!.urge).toBeDefined();
    const kind = ctx.game.echo!.urge!.kind;
    answerUrge(ctx, true);
    expect(ctx.game.echo!.temper).toBe(1);
    if (kind === "rummage") expect(room.items?.some((i) => i.baseId === "duct_tape")).toBe(true);
    ctx.game.echo!.urge = { kind: "listen", where: room.id };
    answerUrge(ctx, false);
    expect(ctx.game.echo!.temper).toBe(0);
  });

  it("an urge lapses when you walk out of the room", () => {
    const world = freshRun();
    const start = world.game.floor!.rooms[world.game.floor!.currentRoom]!;
    world.game.echo!.urge = { kind: "listen", where: start.id };
    const dir = (Object.keys(start.exits) as (keyof typeof start.exits)[])[0]!;
    const after = engine.step(world, { type: "go", dir }).world;
    if (after.game.echo!.urge) expect(after.game.echo!.urge.where).not.toBe(start.id);
  });

  it("feeding salvage pushes Fed, up to the per-floor cap, and uses the junk up", () => {
    let world = freshRun();
    world.game.crawler!.inventory.push(itemFromRef(content, "thumbtacks"), itemFromRef(content, "duct_tape"), itemFromRef(content, "cardboard"));
    for (const item of ["thumbtacks", "duct tape", "cardboard"]) world = engine.step(world, { type: "feed", item }).world;
    expect(world.game.echo!.temper).toBe(2);
    expect(world.game.crawler!.inventory.some((i) => i.baseId === "cardboard")).toBe(true); // the third was refused
  });
});

// ---------------------------------------------------------------- shards and the Codex

describe("shards and the Codex", () => {
  it("delivers the floor's room shards on first visits, never the same one twice in a run", () => {
    const world = freshRun();
    const ctx = new StepContext(world, content);
    const floor = world.game.floor!;
    setRandomSource(() => 0.01); // every roll for a shard succeeds
    const seen: string[] = [];
    for (const room of floor.rooms.filter((r) => r.id !== floor.startRoom)) {
      room.desc = [];
      const s = maybeRoomShard(ctx, room);
      if (s) {
        shardFound(ctx, s);
        seen.push(s.id);
      }
    }
    resetRng();
    expect(seen).toHaveLength(3); // all three, then the pool is empty
    expect(new Set(seen).size).toBe(3);
    expect(seen.every((id) => content.shards.get(id).floor === 1 && content.shards.get(id).delivery === "room")).toBe(true);
    expect(world.game.echo!.shards).toEqual(seen);
  });

  it("never delivers on the start room, or when the roll fails", () => {
    const world = freshRun();
    const ctx = new StepContext(world, content);
    const floor = world.game.floor!;
    setRandomSource(() => 0.01);
    expect(maybeRoomShard(ctx, floor.rooms[floor.startRoom]!)).toBeNull();
    setRandomSource(() => 0.99);
    expect(maybeRoomShard(ctx, floor.rooms.find((r) => r.id !== floor.startRoom)!)).toBeNull();
  });

  it("gives the room a faint voice first; a search finds what's talking, then Echo reacts", () => {
    const world = freshRun();
    const floor = world.game.floor!;
    const room = floor.rooms.find((r) => !r.visited && r.id !== floor.startRoom)!;
    const ctx = new StepContext(world, content);
    setRandomSource(() => 0.01);
    floor.currentRoom = room.id;
    enterRoom(ctx, room.id, "first");
    resetRng();
    expect(room.shard).toBeDefined();
    const s = content.shards.get(room.shard!);
    // Heard, not found: no clue in the description, no reaction, nothing on the run yet.
    expect(ctx.events.some((e) => e.type === "shardVoice")).toBe(true);
    expect(room.desc).not.toContain(s.clue);
    expect(ctx.events.some((e) => e.type === "narration" && e.text === s.reaction)).toBe(false);
    expect(world.game.echo!.shards).toEqual([]);

    const searched = engine.step(world, { type: "search" });
    const after = searched.world.game.floor!.rooms[room.id]!;
    expect(after.desc).toContain(s.clue);
    expect(searched.world.game.echo!.shards).toEqual([s.id]);
    const found = searched.events.find((e) => e.type === "shardFound");
    expect(found).toMatchObject({ delivery: "room", clue: s.clue, reaction: s.reaction });
    expect(found?.type === "shardFound" && found.intro).toContain(s.source!);
    expect(searched.events.some((e) => e.type === "narration" && e.voice === "echo" && e.text === s.reaction)).toBe(true);
    expect(searched.events.some((e) => e.type === "narration" && e.key === "explore.searchNothing")).toBe(false);
  });

  it("reminds you of the voice on a revisit, and never puts one shard in two rooms", () => {
    const world = freshRun();
    const floor = world.game.floor!;
    const ctx = new StepContext(world, content);
    setRandomSource(() => 0.01);
    const rooms = floor.rooms.filter((r) => r.id !== floor.startRoom).slice(0, 4);
    for (const r of rooms) {
      r.desc = [];
      maybeRoomShard(ctx, r);
    }
    resetRng();
    const placed = rooms.map((r) => r.shard).filter(Boolean);
    expect(placed).toHaveLength(3); // the floor has three room shards
    expect(new Set(placed).size).toBe(3);

    const room = rooms.find((r) => r.shard)!;
    room.visited = true;
    const again = new StepContext(world, content);
    enterRoom(again, room.id, "revisit");
    expect(again.events.some((e) => e.type === "shardVoice")).toBe(false);
    expect(again.events.some((e) => e.type === "narration" && e.key === undefined && e.voice === "narrator")).toBe(true);
  });

  it("gives every room shard a source to walk up to", () => {
    for (const s of content.shards.all.filter((x) => x.delivery === "room")) expect(s.source, s.id).toBeTruthy();
  });

  it("remembers shards in the account across runs; the run's list starts empty", () => {
    const world = freshRun();
    const ctx = new StepContext(world, content);
    shardFound(ctx, content.shards.get("S01"));
    shardFound(ctx, content.shards.get("S01")); // no double counting
    expect(ctx.account.thread.shards).toEqual(["S01"]);
    let next = engine.step(ctx.world, { type: "abandon", confirm: true }).world;
    next = engine.step(next, { type: "newCrawler" }).world;
    next = engine.step(next, { type: "accept" }).world;
    expect(next.game.echo!.shards).toEqual([]);
    expect(next.account.thread.shards).toEqual(["S01"]);
    expect(next.account.thread.history.at(-1)!.outcome).toBe("quit");
  });

  it("fills a lore entry in one line per shard, and unlocks it only on its unlock shards", () => {
    const world = freshRun();
    const ctx = new StepContext(world, content);
    const motherOf = () => codexView(content, ctx.account).entries.find((e) => e.id === "lore_mother_below")!;
    shardFound(ctx, content.shards.get("S04")); // a Mother Below line, but not an unlock shard
    expect(motherOf().unlocked).toBe(false);
    expect(motherOf().recorded).toBe(1);
    shardFound(ctx, content.shards.get("S01")); // unlocks it
    const m = motherOf();
    expect(m.unlocked).toBe(true);
    expect(m.lines).toHaveLength(2);
    expect(m.missing).toBe(content.codex.get("lore_mother_below").lines.length - 2);
  });

  it("Floor 13 reactions follow Temper: Calm at 0 and below, Fed above", () => {
    const world = freshRun();
    const ctx = new StepContext(world, content);
    const s49 = content.shards.get("S49");
    ctx.game.echo!.temper = 3;
    shardFound(ctx, s49);
    expect(ctx.events.some((e) => e.type === "narration" && e.text === s49.reactionFed)).toBe(true);
  });

  it("picks the ending by Temper at the edges", () => {
    expect(endingFor(content, -3).id).toBe("share_the_load");
    expect(endingFor(content, -2).id).toBe("peace_terms");
    expect(endingFor(content, 2).id).toBe("peace_terms");
    expect(endingFor(content, 3).id).toBe("take_the_node");
  });

  it("migrates a version-1 account without losing legacy points", () => {
    const old = { version: 1, legacyPoints: 42, rerolls: 1, unlocks: ["x"], bestFloor: 2, runs: 3, deaths: 2, codex: { enemies: [], items: [], achievements: [] } };
    const a = migrateAccount(old)!;
    expect(a.version).toBe(2);
    expect(a.legacyPoints).toBe(42);
    expect(a.thread.shards).toEqual([]);
    expect(migrateAccount({ version: 99 })).toBeNull();
  });
});

// ---------------------------------------------------------------- modules

describe("Echo's modules", () => {
  function atBench(world: World): Room {
    const floor = world.game.floor!;
    const safe = floor.rooms.find((r) => r.type === "safe")!;
    floor.currentRoom = safe.id;
    return safe;
  }

  it("builds Glow at a bench once S02 is found, records the recipe once, and won't build it twice", () => {
    let world = freshRun();
    atBench(world);
    world.game.crawler!.inventory.push(itemFromRef(content, "cracked_screen"), itemFromRef(content, "d_batteries"));
    const refused = engine.step(world, { type: "craft", recipe: "glow" });
    expect(refused.world.game.echo!.modules).toEqual([]); // not unlocked: no shard yet
    world.game.echo!.shards.push("S02");
    const built = engine.step(world, { type: "craft", recipe: "glow" });
    world = built.world;
    expect(world.game.echo!.modules).toEqual(["M01"]);
    expect(of(built.events, "moduleBuilt")).toHaveLength(1);
    expect(world.account.thread.recipes).toEqual(["M01"]);
    expect(world.game.crawler!.inventory.some((i) => i.baseId === "cracked_screen")).toBe(false);
    world.game.crawler!.inventory.push(itemFromRef(content, "cracked_screen"), itemFromRef(content, "d_batteries"));
    world = engine.step(world, { type: "craft", recipe: "glow" }).world;
    expect(world.game.echo!.modules).toEqual(["M01"]);
    expect(world.account.thread.recipes).toEqual(["M01"]);
  });

  it("switches Rope Bind's variant with Temper: tether 1, tether 2 when Calm, a yank when Fed", () => {
    const world = freshRun();
    world.game.echo!.modules = ["M06"];
    expect(effectsNow(world.game, content)).toEqual({ tether: 1 });
    world.game.echo!.temper = -3;
    expect(effectsNow(world.game, content)).toEqual({ tether: 2 });
    world.game.echo!.temper = 4;
    expect(effectsNow(world.game, content)).toEqual({ yank: 5 });
  });

  it("Rope Bind tethers an enemy so it can't close in (bands)", () => {
    const world = freshRun();
    world.game.echo!.modules = ["M06"];
    world.account.settings = { combatMode: "bands" };
    const ctx = new StepContext(world, content);
    const rat = testEnemy({ range: "near", initiative: -50 });
    forceDice(20, 1);
    startCombat(ctx, [rat]);
    const r = engine.step(ctx.world, { type: "module", verb: "bind" });
    const live = r.world.game.combat!.enemies[0]!;
    expect(live.statuses.some((s) => s.id === "tethered")).toBe(true);
    expect(r.world.game.combat!.used).toContain("bind");
  });

  it("Fed Rope Bind yanks for damage and pushes Temper further toward Fed", () => {
    const world = freshRun();
    world.game.echo!.modules = ["M06"];
    world.game.echo!.temper = 3;
    world.account.settings = { combatMode: "bands" };
    const ctx = new StepContext(world, content);
    const rat = testEnemy({ range: "near", initiative: -50, hp: 30, maxHP: 30 });
    forceDice(20, 1);
    startCombat(ctx, [rat]);
    const r = engine.step(ctx.world, { type: "module", verb: "bind" });
    const live = r.world.game.combat!.enemies[0]!;
    expect(live.hp).toBe(25);
    expect(live.range).toBe("close");
    expect(r.world.game.echo!.temper).toBe(4);
  });

  it("Glow (Calm) spots traps for you", () => {
    const world = freshRun();
    world.game.echo!.modules = ["M01"];
    world.game.echo!.temper = -3;
    const floor = world.game.floor!;
    const room = floor.rooms[floor.currentRoom]!;
    room.type = "trap";
    room.trap = "steam_radiator";
    const ctx = new StepContext(world, content);
    const before = ctx.crawler.hp;
    springTrap(ctx, room);
    expect(ctx.crawler.hp).toBe(before);
    expect(ctx.events.filter((e) => e.type === "check")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- floor bosses

describe("floor bosses", () => {
  function bossFight(id: string): World {
    const world = freshRun();
    world.account.settings = { combatMode: "bands" };
    const boss = content.bosses.get(id);
    const ctx = new StepContext(world, content);
    const e = spawnBoss(content, boss, boss.floor);
    e.initiative = -50; // you act first
    e.range = "close";
    setRandomSource(() => 0.99); // no shard line, no urge, no taunt
    forceDice(20, 1);
    startCombat(ctx, [e], { boss: { id, uid: e.uid, declines: 0, triggered: false } });
    resetRng();
    return ctx.world;
  }

  it("the Free Sample Mimic can't attack you once you've declined twice", () => {
    let world = bossFight("free_sample_mimic");
    world = engine.step(world, { type: "decline" }).world;
    expect(world.game.combat!.boss!.declines).toBe(1);
    const r = engine.step(world, { type: "decline" });
    world = r.world;
    const mimic = world.game.combat!.enemies[0]!;
    expect(mimic.statuses.some((s) => s.id === "sated")).toBe(true);
    expect(world.account.thread.weaknesses).toContain("free_sample_mimic");
    const hp = world.game.crawler!.hp;
    for (let i = 0; i < 3; i++) world = engine.step(world, { type: "wait" }).world;
    expect(world.game.crawler!.hp).toBe(hp);
  });

  it("returning a tagged item stops the Lost Property Golem for 3 turns", () => {
    let world = bossFight("lost_property_golem");
    world.game.crawler!.inventory.push(itemFromRef(content, "tagged_umbrella"));
    world = engine.step(world, { type: "use", item: "tagged umbrella" }).world;
    const golem = world.game.combat!.enemies[0]!;
    expect(golem.statuses.find((s) => s.id === "sorting")?.remaining).toBe(3);
    expect(world.game.crawler!.inventory.some((i) => i.baseId === "tagged_umbrella")).toBe(false);
    const hp = world.game.crawler!.hp;
    for (let i = 0; i < 3; i++) world = engine.step(world, { type: "wait" }).world;
    expect(world.game.crawler!.hp).toBe(hp);
  });

  it("a stamped ticket parks the Valet Kraken for 2 turns", () => {
    let world = bossFight("valet_kraken");
    world.game.crawler!.inventory.push(itemFromRef(content, "valet_ticket_stamped"));
    world = engine.step(world, { type: "use", item: "valet ticket" }).world;
    const kraken = world.game.combat!.enemies[0]!;
    expect(kraken.statuses.find((s) => s.id === "parked")?.remaining).toBe(2);
    expect(world.account.thread.weaknesses).toContain("valet_kraken");
  });

  it("an ordinary item does nothing special to a boss", () => {
    let world = bossFight("valet_kraken");
    world.game.crawler!.inventory.push(itemFromRef(content, "tagged_umbrella"));
    world = engine.step(world, { type: "use", item: "tagged umbrella" }).world;
    expect(world.game.combat!.enemies[0]!.statuses).toEqual([]);
  });

  it("beating a boss clears its lair, drops loot and records the weakness", () => {
    let world = bossFight("free_sample_mimic");
    const floor = world.game.floor!;
    floor.bossRoom = floor.currentRoom;
    floor.rooms[floor.currentRoom]!.boss = "free_sample_mimic";
    world.game.combat!.enemies[0]!.hp = 1;
    forceDice(10, 10);
    world = engine.step(world, { type: "attack" }).world;
    expect(world.game.phase).toBe("exploring");
    expect(world.game.floor!.bossDefeated).toBe(true);
    expect(world.game.floor!.rooms[world.game.floor!.currentRoom]!.boss).toBeUndefined();
    expect(world.account.thread.weaknesses).toContain("free_sample_mimic");
  });

  it("picking up a hint item records its boss's weakness", () => {
    let world = freshRun();
    const room = world.game.floor!.rooms[world.game.floor!.currentRoom]!;
    room.items = [itemFromRef(content, "complimentary_eyeball")];
    world = engine.step(world, { type: "take", item: "eyeball" }).world;
    expect(world.account.thread.weaknesses).toContain("free_sample_mimic");
  });

  it("Floors 1-4: the mini-boss has its own lair and every stairwell stays reachable without it (100 floors)", () => {
    for (let i = 0; i < 100; i++) {
      const f = generateFloor(lobby, { safe: content.pacing.safeRooms, bossGate: "none", boss: "free_sample_mimic" });
      const lair = f.rooms[f.bossRoom!]!;
      expect(lair.type).toBe("lair");
      expect(lair.boss).toBe("free_sample_mimic");
      expect(lair.id).not.toBe(f.startRoom);
      const around = bfsAvoiding(f.rooms, f.startRoom, lair.id);
      for (const s of f.rooms.filter((r) => r.type === "stairwell")) {
        expect(s.concealed).toBeFalsy();
        expect(around[s.id]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("Floors 5+: the boss holds the nearest stairwell, the rest are hidden, and one is reachable around it (100 floors)", () => {
    for (let i = 0; i < 100; i++) {
      const f = generateFloor(lobby, { safe: content.pacing.safeRooms, bossGate: "obviousStairs", boss: "house" });
      const stairs = f.rooms.filter((r) => r.type === "stairwell");
      const gate = f.rooms[f.bossRoom!]!;
      const d = bfsDistances(f.rooms, f.startRoom);
      expect(gate.type).toBe("stairwell");
      expect(gate.boss).toBe("house");
      expect(Math.min(...stairs.map((s) => d[s.id]!))).toBe(d[gate.id]);
      const others = stairs.filter((s) => s !== gate);
      expect(others.every((s) => s.concealed)).toBe(true);
      const around = bfsAvoiding(f.rooms, f.startRoom, gate.id);
      expect(others.some((s) => around[s.id]! >= 0)).toBe(true);
    }
  });

  it("won't descend a hidden stairwell until it's found, or a guarded one while the boss lives", () => {
    let world = freshRun();
    const floor = world.game.floor!;
    const stairs = floor.rooms.find((r) => r.type === "stairwell")!;
    stairs.concealed = true;
    floor.currentRoom = stairs.id;
    world = engine.step(world, { type: "descend" }).world;
    expect(world.game.floor!.floor).toBe(1);
    world = engine.step(world, { type: "search" }).world;
    expect(world.game.floor!.rooms[stairs.id]!.concealed).toBe(false);
    const guarded = world.game.floor!.rooms[stairs.id]!;
    guarded.boss = "house";
    world.game.floor!.bossDefeated = false;
    world = engine.step(world, { type: "descend" }).world;
    expect(world.game.floor!.floor).toBe(1);
  });
});
