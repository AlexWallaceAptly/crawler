/**
 * Milestone 8: death and the account. Legacy points, the death achievements, the bequest,
 * unlocks (rerolls, backstory pools, starting kits), the old codex, and the account migration.
 */
import { afterEach, describe, expect, it } from "vitest";
import { resetRng } from "../src/rng";
import { clone } from "../src/clone";
import { settle } from "../src/achievements";
import { generateCrawler } from "../src/gen/backstory";
import { bfsDistances } from "../src/gen/floor";
import { itemInfo } from "../src/itemInfo";
import { migrateAccount } from "../src/engine";
import { StepContext } from "../src/step";
import { LEGACY } from "../src/legacy";
import { content, engine, of, testEnemy } from "./helpers";
import type { Action } from "../src/actions";
import type { GameEvent } from "../src/events";
import type { ItemInstance, World } from "../src/state";

afterEach(() => resetRng());

function play(world: World, ...actions: (Action | string)[]): { world: World; events: GameEvent[] } {
  let events: GameEvent[] = [];
  for (const a of actions) {
    const r = typeof a === "string" ? engine.input(world, a) : engine.step(world, a);
    world = r.world;
    events = r.events;
  }
  return { world, events };
}

function exploring(account?: World["account"]): World {
  let { world } = engine.newWorld(account);
  ({ world } = engine.step(world, { type: "accept" }));
  return world;
}

/** A bands fight against one sump rat that hits for far more than the crawler has. */
function aboutToDie(world: World, over: Parameters<typeof testEnemy>[0] = {}): World {
  const w = clone(world);
  w.account.settings = { combatMode: "bands" };
  w.game.crawler!.hp = 1;
  const rat = testEnemy({
    attacks: [{ name: "Bite", power: [99, 99, 99], damageType: "physical", stat: "DEX", range: "close", ready: 0 }],
    ...over,
  });
  w.game.combat = {
    mode: "bands", enemies: [rat], round: 1, playerInitiative: 15, ap: 0, apMax: 3, turnBegun: false,
    fromRoom: w.game.floor!.currentRoom,
  };
  w.game.phase = "combat";
  return w;
}

const gear = (over: Partial<ItemInstance> = {}): ItemInstance => ({
  uid: `g${Math.random().toString(36).slice(2, 7)}`, baseId: "crowbar", kind: "gear", name: "Test Crowbar", rarity: "rare", slot: "mainHand",
  power: [3, 5, 7], damageType: "physical", stat: "STR", modifiers: [], weight: 2, value: 40, qty: 1, tags: [], ...over,
});

describe("dying", () => {
  it("an enemy kill says who, how and where, and pays legacy points at the end of the step", () => {
    const start = exploring();
    const { world, events } = play(aboutToDie(start), { type: "wait" });
    expect(world.game.phase).toBe("dead");
    const died = of(events, "died")[0]!;
    expect(died).toMatchObject({ source: "enemy", killer: "sump_rat", tier: "mob", floor: 1, rounds: 1, asleep: false });
    const end = world.game.ended!;
    expect(end.kind).toBe("died");
    const t = end.legacy!;
    const c = world.game.crawler!;
    expect(t.floors).toBe(LEGACY.perFloor * 1);
    expect(t.achievementCount).toBe(c.achievements.length);
    expect(t.total).toBe(t.floors + t.achievements + t.bosses + t.bonus);
    expect(world.account.legacyPoints).toBe(start.account.legacyPoints + t.total);
    expect(world.account.legacyEarned).toBe(t.total);
    expect(of(events, "runEnded")[0]).toMatchObject({ kind: "died", legacy: t.total });
    const record = world.account.thread.history.at(-1)!;
    expect(record.outcome).toMatch(/^died: /);
    expect(record.legacy).toBe(t.total);
  });

  it("the death achievements fire on the dying step and pay legacy, not boxes", () => {
    const { world } = play(aboutToDie(exploring()), { type: "wait" });
    const c = world.game.crawler!;
    // a sump rat, on Floor 1
    expect(c.achievements).toEqual(expect.arrayContaining(["first_death", "rodent_rights", "tutorial_boss"]));
    const paid = ["first_death", "rodent_rights", "tutorial_boss"].reduce((n, id) => {
      const r = content.achievements.get(id).reward;
      return n + ("legacy" in r ? r.legacy : 0);
    }, 0);
    expect(world.game.ended!.legacy!.bonus).toBeGreaterThanOrEqual(paid);
    expect(world.game.boxes.every((b) => !b.source.includes("Pilot Episode"))).toBe(true);
  });

  it("dying in your sleep: a collapse during a rest", () => {
    const w = clone(exploring());
    const floor = w.game.floor!;
    expect(floor.rooms[floor.currentRoom]!.type).not.toBe("stairwell");
    floor.timeLeft = 1;
    const { world, events } = play(w, { type: "rest" });
    expect(of(events, "died")[0]).toMatchObject({ source: "collapse", asleep: true, rounds: 0 });
    expect(world.game.crawler!.achievements).toContain("rest_in_pieces");
  });

  it("nothing more is earned once the run has been tallied", () => {
    const { world } = play(aboutToDie(exploring()), { type: "wait" });
    const before = world.game.crawler!.achievements.length;
    const draft = clone(world);
    draft.account.deaths = 50; // would trip recurring_customer
    const ctx = new StepContext(draft, content);
    ctx.emit({ type: "info", text: "" });
    settle(ctx);
    expect(draft.game.crawler!.achievements.length).toBe(before);
  });
});

describe("quitting and winning", () => {
  it("quitting pays nothing for floors and earns no death achievements", () => {
    const { world, events } = play(exploring(), { type: "abandon", confirm: true });
    expect(of(events, "died")[0]!.source).toBe("quit");
    const t = world.game.ended!.legacy!;
    expect(t.deepest).toBe(1);
    expect(t.floors).toBe(0);
    expect(world.game.crawler!.achievements).not.toContain("first_death");
    expect(world.game.crawler!.achievements).not.toContain("tutorial_boss");
    expect(world.account.thread.history.at(-1)!.outcome).toBe("quit");
  });

  it("accept-and-quit can't print points", () => {
    let world = exploring();
    for (let i = 0; i < 3; i++) world = play(world, { type: "abandon", confirm: true }, { type: "newCrawler" }, { type: "accept" }).world;
    expect(world.account.legacyPoints).toBeLessThanOrEqual(2 * LEGACY.perAchievement * 3);
  });

  it("descending past the last built floor counts one more floor", () => {
    const w = clone(exploring());
    const last = Math.max(...content.floors.all.map((f) => f.floor));
    const theme = content.floors.all.find((f) => f.floor === last)!;
    w.game.floor!.floor = last;
    w.game.floor!.theme = theme.id;
    const stairs = w.game.floor!.rooms.find((r) => r.type === "stairwell" && !r.concealed)!;
    w.game.floor!.currentRoom = stairs.id;
    const { world } = play(w, { type: "descend" });
    expect(world.game.phase).toBe("dead");
    const t = world.game.ended!.legacy!;
    expect(world.game.ended!.kind).toBe("descended");
    expect(t.deepest).toBe(last + 1);
    expect(t.floors).toBe(LEGACY.perFloor * (last + 1));
  });
});

describe("the bequest", () => {
  function deadWith(items: ItemInstance[]): World {
    const w = clone(exploring());
    w.game.crawler!.inventory.push(...items);
    return play(aboutToDie(w), { type: "wait" }).world;
  }

  it("one non-legendary item goes to the account, one of a stack, marked as an heirloom", () => {
    const pipe = gear({ name: "Grandpa's Pipe" });
    const world = play(deadWith([pipe]), "bequeath grandpa's pipe").world;
    const b = world.account.bequest!;
    expect(b.item.name).toBe("Grandpa's Pipe");
    expect(b.item.qty).toBe(1);
    expect(b.item.heirloom).toMatchObject({ from: world.game.crawler!.name });
    expect(b.cause).toBe(world.game.ended!.cause);
    expect(world.game.ended!.bequeathed).toBe("Grandpa's Pipe");
    expect(engine.view(world).runEnd!.bequeathed).toBe("Grandpa's Pipe");
  });

  it("legendary items stay with the house", () => {
    const world = play(deadWith([gear({ name: "Crown of Ruin", rarity: "legendary" })]), "bequeath crown of ruin").world;
    expect(world.account.bequest).toBeNull();
    expect(engine.view(world).runEnd!.legendary).toContain("Crown of Ruin");
    expect(engine.view(world).runEnd!.candidates.some((c) => c.name === "Crown of Ruin")).toBe(false);
  });

  it("a later pick replaces an earlier one, and `bequeath nothing` clears it", () => {
    let world = deadWith([gear({ name: "First Thing" }), gear({ name: "Second Thing" })]);
    world = play(world, "bequeath first thing", "bequeath second thing").world;
    expect(world.account.bequest!.item.name).toBe("Second Thing");
    world = play(world, "bequeath nothing").world;
    expect(world.account.bequest).toBeNull();
  });

  it("only the dead can bequeath", () => {
    const { world, events } = play(exploring(), "bequeath pipe");
    expect(world.account.bequest).toBeNull();
    expect(of(events, "narration").some((e) => e.key === "command.notNow")).toBe(true);
  });

  it("the next crawler finds it in a Floor 1 safe room (not the tutorial one), and then it's off the account", () => {
    let world = play(deadWith([gear({ name: "Family Crowbar" })]), "bequeath family crowbar").world;
    const from = world.game.crawler!.name;
    world = play(world, { type: "newCrawler" }).world;
    expect(world.account.bequest).not.toBeNull(); // still waiting while the next crawler is made
    const { world: w, events } = play(world, { type: "accept" });
    const floor = w.game.floor!;
    expect(w.account.bequest).toBeNull();
    expect(floor.bequest).toMatchObject({ name: "Family Crowbar", from });
    const room = floor.rooms[floor.bequest!.room]!;
    expect(room.type).toBe("safe");
    const fromStart = bfsDistances(floor.rooms, floor.startRoom);
    const safes = floor.rooms.filter((r) => r.type === "safe").sort((a, b) => fromStart[a.id]! - fromStart[b.id]!);
    expect(room.id).toBe(safes[1]!.id);
    const left = room.items!.find((i) => i.name === "Family Crowbar")!;
    expect(left.heirloom?.from).toBe(from);
    expect(of(events, "narration").some((e) => e.key === "bequest.waiting")).toBe(true);
    expect(w.game.guide.some((g) => g.id === "bequest")).toBe(true);
    expect(itemInfo(w.game.crawler!, content, left).detail.join(" ")).toContain(from);
  });
});

describe("unlocks", () => {
  function deadRich(points: number): World {
    const { world } = play(exploring(), { type: "abandon", confirm: true });
    world.account.legacyPoints = points;
    return world;
  }

  it("buying spends legacy points; too poor or already owned is refused", () => {
    const odd = content.unlocks.get("pool_odd_jobs");
    let world = deadRich(odd.cost - 1);
    world = play(world, "unlock odd jobs").world;
    expect(world.account.unlocks).not.toContain("pool_odd_jobs");
    expect(world.account.legacyPoints).toBe(odd.cost - 1);
    world.account.legacyPoints = odd.cost * 2;
    world = play(world, "unlock odd jobs").world;
    expect(world.account.unlocks).toContain("pool_odd_jobs");
    expect(world.account.legacyPoints).toBe(odd.cost);
    const { world: again, events } = play(world, "unlock odd jobs");
    expect(again.account.legacyPoints).toBe(odd.cost);
    expect(of(events, "narration").some((e) => e.key === "unlock.owned")).toBe(true);
  });

  it("rerolls can be bought again and again, and are spent after the free ones", () => {
    const cost = content.unlocks.get("second_opinion").cost;
    let world = play(deadRich(cost * 2), "unlock second opinion", "unlock second opinion").world;
    expect(world.account.rerolls).toBe(2);
    expect(world.account.legacyPoints).toBe(0);
    world = play(world, { type: "newCrawler" }, "reroll", "reroll", "reroll", "reroll").world; // 3 free, then 1 bought
    expect(world.account.rerolls).toBe(1);
  });

  it("can't be bought mid-run", () => {
    const world = exploring();
    world.account.legacyPoints = 999;
    const { world: w } = play(world, "unlock odd jobs");
    expect(w.account.unlocks).toEqual([]);
  });

  it("backstory pools: locked entries never roll until the pool is bought", () => {
    const pooled = new Set(content.backstory.occupations.all.filter((o) => o.pool === "odd_jobs").map((o) => o.id));
    expect(pooled.size).toBeGreaterThan(20);
    const locked = Array.from({ length: 400 }, () => generateCrawler(content).backstory.occupation);
    expect(locked.some((id) => pooled.has(id))).toBe(false);
    const open = Array.from({ length: 400 }, () => generateCrawler(content, ["odd_jobs"]).backstory.occupation);
    expect(open.some((id) => pooled.has(id))).toBe(true);
  });

  it("a starting kit joins the pack on accept; `kit none` skips it", () => {
    const kit = content.unlocks.get("kit_first_aid");
    let world = play(deadRich(kit.cost), "unlock break room first aid").world;
    expect(world.account.kit).toBe("kit_first_aid");
    let w = play(world, { type: "newCrawler" }, { type: "accept" });
    const potions = w.world.game.crawler!.inventory.filter((i) => i.baseId === "healing_potion" || i.baseId === "bandage_roll");
    expect(potions.reduce((n, i) => n + i.qty, 0)).toBeGreaterThanOrEqual(3);
    expect(of(w.events, "narration").some((e) => e.key === "kit.granted")).toBe(true);
    world = play(w.world, { type: "abandon", confirm: true }, "kit none").world;
    expect(world.account.kit).toBe("none");
    w = play(world, { type: "newCrawler" }, { type: "accept" });
    expect(of(w.events, "narration").some((e) => e.key === "kit.granted")).toBe(false);
  });

  it("the view lists what's owned and affordable", () => {
    const world = deadRich(content.unlocks.get("pool_worst_moments").cost);
    const v = engine.view(world).account;
    expect(v.unlocks.length).toBe(content.unlocks.all.length);
    expect(v.unlocks.find((u) => u.id === "pool_worst_moments")!.canBuy).toBe(true);
    expect(v.unlocks.find((u) => u.id === "kit_library_card")!.canBuy).toBe(content.unlocks.get("kit_library_card").cost <= v.legacyPoints);
    expect(engine.commands(world).some((c) => c.input === "unlocks")).toBe(true);
  });
});

describe("a new crawler starts clean", () => {
  it("boxes, achievement counts and the System AI's mood are per run", () => {
    let world = exploring();
    world.game.boxes.push({ id: "b1", tier: "bronze", boxType: "adventurer", floor: 1, source: "test" });
    world.game.narrator.mood = 7;
    world.game.achieved = { first_blood: 1 };
    world = play(world, { type: "abandon", confirm: true }, { type: "newCrawler" }).world;
    expect(world.game.boxes).toEqual([]);
    expect(world.game.achieved).toEqual({});
    expect(world.game.narrator.mood).toBe(0);
    expect(world.game.ended).toBeUndefined();
  });
});

describe("the account codex", () => {
  it("fights, kills and deaths fill the bestiary; the pack fills the items", () => {
    const start = exploring();
    const { world } = play(aboutToDie(start), { type: "wait" });
    const codex = world.account.codex;
    expect(codex.enemies).toContain("sump_rat");
    expect(codex.tallies.sump_rat!.killedYou).toBe(1);
    for (const it of start.game.crawler!.inventory) expect(codex.items).toContain(it.baseId);
    const v = engine.view(world).codex.records;
    const rat = v.bestiary.find((b) => b.id === "sump_rat")!;
    expect(rat.name).toBe(content.enemies.get("sump_rat").name);
    expect(rat.line).not.toContain("speechless");
    expect(rat.line).not.toContain("{");
    expect(v.items.found).toBe(codex.items.length);
    expect(v.items.groups.every((g) => !g.line.includes("speechless") && !g.line.includes("{"))).toBe(true);
  });

  it("a fight that starts counts as meeting them", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    const before = world.account.codex.tallies;
    // walk until a fight starts (or give up after a while: rooms can be empty)
    for (let i = 0; i < 60 && world.game.phase !== "combat"; i++) {
      const room = world.game.floor!.rooms[world.game.floor!.currentRoom]!;
      const dir = Object.keys(room.exits)[i % Object.keys(room.exits).length] as "north";
      world = engine.step(world, { type: "go", dir }).world;
      if (world.game.phase === "dead") break;
    }
    if (world.game.phase !== "combat") return; // no fight found; nothing to check
    const fam = world.game.combat!.enemies[0]!.familyId;
    expect(world.account.codex.enemies).toContain(fam);
    expect(world.account.codex.tallies[fam]!.met).toBeGreaterThan(before[fam]?.met ?? 0);
  });
});

describe("account-level achievements", () => {
  it("fire once per account, not once per crawler", () => {
    let world = exploring();
    world.account.deaths = 9;
    world = play(aboutToDie(world), { type: "wait" }).world; // the tenth death
    expect(world.game.crawler!.achievements).toContain("recurring_customer");
    world = play(world, { type: "newCrawler" }, { type: "accept" }).world;
    world = play(aboutToDie(world), { type: "wait" }).world;
    expect(world.game.crawler!.achievements).not.toContain("recurring_customer");
    // ...but the list still shows it as earned
    expect(engine.view(world).rewards.achievements.find((a) => a.id === "recurring_customer")!.earned).toBe(true);
  });

  it("every vessel Echo wakes in is remembered", () => {
    const world = exploring();
    expect(world.account.thread.vessels).toEqual([world.game.echo!.vessel]);
  });
});

describe("account migration", () => {
  it("a version-2 account keeps everything and reads its vessels back out of the run history", () => {
    const v = content.thread.vessels;
    const old = {
      version: 2, legacyPoints: 30, rerolls: 1, unlocks: [], bestFloor: 2, runs: 2, deaths: 2,
      codex: { enemies: ["sump_rat"], items: [], achievements: ["first_blood"] },
      thread: {
        shards: ["S01"], recipes: [], weaknesses: [], endings: [],
        history: [
          { run: 1, crawler: "A", floor: 1, outcome: "quit", shards: 0, temper: 0, vessel: v[0]!.name },
          { run: 2, crawler: "B", floor: 2, outcome: "died: a rat", shards: 1, temper: 0, vessel: v[1]!.name },
        ],
      },
    };
    const a = migrateAccount(old, content)!;
    expect(a.version).toBe(3);
    expect(a.legacyPoints).toBe(30);
    expect(a.legacyEarned).toBe(30);
    expect(a.codex.enemies).toEqual(["sump_rat"]);
    expect(a.codex.tallies).toEqual({});
    expect(a.thread.vessels.sort()).toEqual([v[0]!.id, v[1]!.id].sort());
    expect(a.bequest).toBeNull();
    // and it plays
    expect(engine.newWorld(a).world.account.version).toBe(3);
  });
});
