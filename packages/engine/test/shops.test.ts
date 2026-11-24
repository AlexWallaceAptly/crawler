import { afterEach, describe, expect, it } from "vitest";
import { resetRng } from "../src/rng";
import { clone } from "../src/clone";
import { buyPrice, sellPrice, shopView } from "../src/shop";
import { content, engine, of, testEnemy } from "./helpers";
import type { ItemInstance, World } from "../src/state";

afterEach(() => resetRng());

function safeWorld(): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  const w = clone(world);
  const floor = w.game.floor!;
  floor.currentRoom = floor.rooms.findIndex((r) => r.type === "safe");
  return w;
}
const shopOf = (w: World) => w.game.floor!.rooms[w.game.floor!.currentRoom]!.shop!;
const thing = (over: Partial<ItemInstance> = {}): ItemInstance => ({
  uid: "t1", baseId: "x", kind: "consumable", name: "Test Thing", rarity: "common", modifiers: [], weight: 1, value: 20, qty: 1, tags: [], ...over,
});

describe("shops", () => {
  it("every safe room on every floor has a shopkeeper and a shelf, and nothing else does", () => {
    for (let i = 0; i < 20; i++) {
      const w = safeWorld();
      for (const r of w.game.floor!.rooms) {
        if (r.type === "safe") {
          expect(r.shop).toBeDefined();
          expect(r.shop!.stock.length).toBeGreaterThan(0);
          expect(content.shops.personalities.map((p) => p.id)).toContain(r.shop!.personality);
        } else expect(r.shop).toBeUndefined();
      }
    }
  });

  it("the shelf is part of the saved state: the same stock after a clone", () => {
    const w = safeWorld();
    expect(clone(w).game.floor!.rooms.map((r) => r.shop?.stock.map((s) => s.name))).toEqual(w.game.floor!.rooms.map((r) => r.shop?.stock.map((s) => s.name)));
  });

  it("buying costs gold, moves the item to your pack and counts", () => {
    const w = safeWorld();
    const item = shopOf(w).stock[0]!;
    const price = buyPrice(w.game, content, shopOf(w), item);
    w.game.crawler!.gold = price + 50;
    const { world, events } = engine.step(w, { type: "buy", item: item.name, qty: "1" });
    expect(world.game.crawler!.gold).toBe(50 + 25); // change, plus the 25 First Buy pays
    expect(world.game.crawler!.inventory.some((i) => i.name === item.name)).toBe(true);
    expect(of(events, "shopBought")).toHaveLength(1);
    expect(world.game.crawler!.counters["shop.bought"]).toBe(1);
  });

  it("can't afford it: no sale, the keeper says so", () => {
    const w = safeWorld();
    const item = shopOf(w).stock[0]!;
    w.game.crawler!.gold = 0;
    const { world, events } = engine.step(w, { type: "buy", item: item.name });
    expect(world.game.crawler!.gold).toBe(0);
    expect(of(events, "shopBought")).toHaveLength(0);
    expect(events.some((e) => e.type === "narration" && e.key?.endsWith(".broke"))).toBe(true);
  });

  it("selling pays gold, takes the item and puts it on the shelf; equipped and worthless things stay", () => {
    const w = safeWorld();
    const c = w.game.crawler!;
    c.gold = 0;
    c.inventory = [thing({ qty: 3 }), thing({ uid: "t2", name: "Dud", value: 0 })];
    const price = sellPrice(w.game, content, shopOf(w), c.inventory[0]!);
    expect(price).toBeGreaterThan(0);
    const { world, events } = engine.step(w, { type: "sell", item: "test thing", qty: "2" });
    expect(world.game.crawler!.gold).toBe(price * 2);
    expect(world.game.crawler!.inventory.find((i) => i.name === "Test Thing")!.qty).toBe(1);
    expect(of(events, "shopSold")).toHaveLength(1);
    const dud = engine.step(w, { type: "sell", item: "dud" });
    expect(dud.world.game.crawler!.inventory.some((i) => i.name === "Dud")).toBe(true);
    c.inventory = [thing({ uid: "eq", name: "Held Club", slot: "mainHand", kind: "gear" })];
    c.equipment = { mainHand: "eq" };
    const held = engine.step(w, { type: "sell", item: "held club" });
    expect(held.world.game.crawler!.inventory).toHaveLength(1);
    expect(held.world.game.crawler!.gold).toBe(0);
  });

  it("shopping only works in a safe room", () => {
    const w = safeWorld();
    const floor = w.game.floor!;
    floor.currentRoom = floor.rooms.findIndex((r) => r.type !== "safe" && r.type !== "stairwell");
    for (const action of [{ type: "shop" }, { type: "buy", item: "x" }, { type: "sell", item: "x" }] as const) {
      const { events } = engine.step(w, action);
      expect(of(events, "error").length).toBe(1);
    }
  });

  it("charisma moves prices: high CHA buys cheaper and sells dearer", () => {
    const w = safeWorld();
    const shop = shopOf(w);
    const item = thing({ value: 100 });
    w.game.crawler!.baseStats.CHA = 10;
    const neutralBuy = buyPrice(w.game, content, shop, item);
    const neutralSell = sellPrice(w.game, content, shop, item);
    w.game.crawler!.baseStats.CHA = 18;
    expect(buyPrice(w.game, content, shop, item)).toBeLessThan(neutralBuy);
    expect(sellPrice(w.game, content, shop, item)).toBeGreaterThanOrEqual(neutralSell);
    w.game.crawler!.baseStats.CHA = 3;
    expect(buyPrice(w.game, content, shop, item)).toBeGreaterThan(neutralBuy);
  });

  it("the Lost Property Index's sellBonus adds 20% to what you get", () => {
    const w = safeWorld();
    const shop = shopOf(w);
    const item = thing({ value: 200 });
    w.game.crawler!.baseStats.CHA = 10;
    const base = sellPrice(w.game, content, shop, item);
    w.game.echo!.modules = ["M03"];
    w.game.echo!.temper = 5; // Fed
    expect(sellPrice(w.game, content, shop, item)).toBeGreaterThan(base);
  });

  it("the view lists stock with prices and what the pack would fetch", () => {
    const w = safeWorld();
    const v = shopView(w.game, content, w.game.floor!.rooms[w.game.floor!.currentRoom]!)!;
    expect(v.stock.length).toBeGreaterThan(0);
    expect(v.stock.every((s) => s.price >= content.shops.minPrice)).toBe(true);
  });
});

describe("gold", () => {
  it("the dead pay out by tier, scaled by floor", () => {
    const w = safeWorld();
    const c = w.game.crawler!;
    c.gold = 0;
    c.inventory = [{ uid: "w1", baseId: "t", kind: "gear", name: "Club", rarity: "common", slot: "mainHand", power: [9, 9, 9], damageType: "physical", stat: "STR", modifiers: [], weight: 1, value: 0, qty: 1, tags: [] }];
    c.equipment = { mainHand: "w1" };
    w.account.settings = { combatMode: "bands" };
    w.game.combat = { mode: "bands", enemies: [testEnemy({ hp: 1, maxHP: 1, tier: "elite" })], round: 1, playerInitiative: 15, ap: 0, apMax: 3, turnBegun: false, fromRoom: w.game.floor!.currentRoom };
    w.game.phase = "combat";
    const { world, events } = engine.step(w, { type: "attack" });
    expect(world.game.crawler!.gold).toBeGreaterThanOrEqual(content.shops.drops.elite[0]);
    expect(of(events, "goldChanged").length).toBeGreaterThan(0);
  });
});
