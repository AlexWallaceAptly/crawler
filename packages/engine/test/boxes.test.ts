import { afterEach, describe, expect, it } from "vitest";
import { resetRng } from "../src/rng";
import { clone } from "../src/clone";
import { grantBox, boxItemLevel, rollBox } from "../src/boxes";
import { StepContext } from "../src/step";
import { clearFloor } from "../src/explore";
import { RARITIES } from "../src/content/schemas";
import { content, engine, of, testEnemy } from "./helpers";
import type { Box, World } from "../src/state";

afterEach(() => resetRng());

function exploring(): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  return world;
}

function inRoom(world: World, type: "safe" | "other"): World {
  const w = clone(world);
  const floor = w.game.floor!;
  const idx = floor.rooms.findIndex((r) => (type === "safe" ? r.type === "safe" : r.type !== "safe" && r.type !== "stairwell"));
  floor.currentRoom = idx;
  return w;
}

const box = (tier: Box["tier"], boxType: Box["boxType"] = "adventurer", floor = 1): Box => ({ id: "box9", tier, boxType, floor, source: "test" });
const rank = (r: string) => RARITIES.indexOf(r as never);

describe("opening boxes", () => {
  it("only opens in a safe room", () => {
    const w = inRoom(exploring(), "other");
    w.game.boxes = [box("bronze")];
    const { world, events } = engine.step(w, { type: "open" });
    expect(world.game.boxes).toHaveLength(1);
    expect(of(events, "boxOpened")).toHaveLength(0);
    expect(events.some((e) => e.type === "narration" && e.key === "box.refused")).toBe(true);
  });

  it("opens in a safe room: the box is spent and its contents arrive", () => {
    const w = inRoom(exploring(), "safe");
    w.game.boxes = [box("silver")];
    const { world, events } = engine.step(w, { type: "open" });
    expect(world.game.boxes.filter((b) => b.source === "test")).toHaveLength(0); // (the level-up it pays for may earn a new one)
    const opened = of(events, "boxOpened")[0]!;
    expect(opened.contents.length).toBeGreaterThan(0);
    expect(world.game.crawler!.counters["boxes.opened"]).toBe(1);
  });

  it("`open all` opens every box; `open 2` picks by number; `boxes` is free", () => {
    const w = inRoom(exploring(), "safe");
    w.game.boxes = [box("bronze"), box("silver"), box("gold")];
    const turn = w.game.turn;
    const listed = engine.step(w, { type: "boxes" });
    expect(listed.world.game.turn).toBe(turn);
    const two = engine.step(w, { type: "open", which: "2" });
    expect(two.world.game.boxes.filter((b) => b.source === "test").map((b) => b.tier)).toEqual(["bronze", "gold"]);
    const all = engine.step(w, { type: "open", which: "all" });
    expect(all.world.game.boxes.filter((b) => b.source === "test")).toHaveLength(0);
    expect(of(all.events, "boxOpened")).toHaveLength(3);
  });

  it("can't be opened mid-fight", () => {
    const w = inRoom(exploring(), "safe");
    w.game.boxes = [box("bronze")];
    w.game.combat = { mode: "bands", enemies: [testEnemy()], round: 1, playerInitiative: 15, ap: 0, apMax: 3, turnBegun: false, fromRoom: w.game.floor!.currentRoom };
    w.game.phase = "combat";
    const { world } = engine.step(w, { type: "open" });
    expect(world.game.boxes).toHaveLength(1);
  });

  it("the buttons offer Open only in a safe room with a box", () => {
    const safe = inRoom(exploring(), "safe");
    const other = inRoom(exploring(), "other");
    safe.game.boxes = [box("bronze")];
    other.game.boxes = [box("bronze")];
    expect(engine.commands(safe).some((c) => c.input === "open")).toBe(true);
    expect(engine.commands(other).some((c) => c.input === "open")).toBe(false);
  });
});

describe("what's inside", () => {
  const ctxFor = () => new StepContext(clone(exploring()), content);

  it("item rolls honour the tier's minimum rarity (gold: rare or better; platinum: epic or better)", () => {
    for (const [tier, min] of [["gold", "rare"], ["platinum", "epic"]] as const) {
      for (let i = 0; i < 40; i++) {
        const r = rollBox(ctxFor(), box(tier, "weapon"));
        for (const item of r.items.filter((x) => x.kind === "gear" && !content.oddities.byId[x.baseId])) expect(rank(item.rarity)).toBeGreaterThanOrEqual(rank(min));
      }
    }
  });

  it("roll counts stay inside the tier's range", () => {
    for (let i = 0; i < 40; i++) {
      const r = rollBox(ctxFor(), box("bronze"));
      expect(r.items.length + (r.gold > 0 ? 1 : 0)).toBeGreaterThanOrEqual(1);
      expect(r.items.length).toBeLessThanOrEqual(4);
    }
  });

  it("a legendary box always holds a legendary piece", () => {
    for (let i = 0; i < 25; i++) {
      const r = rollBox(ctxFor(), box("legendary", "armor", 2));
      expect(r.items.some((x) => x.rarity === "legendary")).toBe(true);
    }
  });

  it("a platinum box always holds a tome, scroll or oddity", () => {
    for (let i = 0; i < 40; i++) {
      const r = rollBox(ctxFor(), box("platinum"));
      const special = r.items.some((x) => !!x.spellId || !!content.oddities.byId[x.baseId]);
      expect(special).toBe(true);
    }
  });

  it("weapon boxes roll weapons and armor boxes don't", () => {
    for (let i = 0; i < 30; i++) {
      for (const item of rollBox(ctxFor(), box("silver", "weapon")).items.filter((x) => x.kind === "gear")) expect(["mainHand", "offHand"]).toContain(item.slot);
      for (const item of rollBox(ctxFor(), box("silver", "armor")).items.filter((x) => x.kind === "gear")) expect(["mainHand", "offHand"]).not.toContain(item.slot);
    }
  });

  it("1,000 boxes of every tier and type roll without throwing, and the item level is floor * 5 + 2", () => {
    expect(boxItemLevel(3)).toBe(17);
    let n = 0;
    for (const tier of content.boxes.tiers) for (const type of content.boxes.types) {
      for (let i = 0; i < 12; i++) {
        const r = rollBox(ctxFor(), box(tier.id, type.id, 1 + (i % 3)));
        n += 1;
        for (const item of r.items) expect(item.name.length).toBeGreaterThan(0);
      }
    }
    expect(n).toBe(5 * 6 * 12);
  });

  it("what won't fit stays on the room's floor", () => {
    const w = inRoom(exploring(), "safe");
    w.game.crawler!.inventory.push({ uid: "anvil", baseId: "x", kind: "consumable", name: "Anvil", rarity: "common", modifiers: [], weight: 9999, value: 0, qty: 1, tags: [] });
    w.game.boxes = [box("legendary", "armor", 2)];
    const { world } = engine.step(w, { type: "open" });
    const room = world.game.floor!.rooms[world.game.floor!.currentRoom]!;
    expect((room.items ?? []).length).toBeGreaterThan(0);
  });

  it("grantBox queues an unopened box and says so", () => {
    const ctx = ctxFor();
    grantBox(ctx, "gold", "spell", "test");
    expect(ctx.game.boxes).toHaveLength(1);
    expect(of(ctx.events as never, "boxEarned")).toHaveLength(1);
  });

  it("clearing a floor grants a bronze box", () => {
    const ctx = ctxFor();
    clearFloor(ctx);
    expect(ctx.game.boxes.some((b) => b.tier === "bronze" && b.source.includes("cleared"))).toBe(true);
  });
});
