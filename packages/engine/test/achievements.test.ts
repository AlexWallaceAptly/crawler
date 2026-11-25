import { afterEach, describe, expect, it } from "vitest";
import { forceDice, resetRng } from "../src/rng";
import { clone } from "../src/clone";
import { settle } from "../src/achievements";
import { StepContext } from "../src/step";
import { clampMood } from "../src/mood";
import { content, engine, of, testEnemy } from "./helpers";
import type { GameEventBody } from "../src/events";
import type { Crawler, World } from "../src/state";

afterEach(() => resetRng());

function exploring(): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  return world;
}

const noop: GameEventBody = { type: "info", text: "" };
const kill = (over: Partial<Extract<GameEventBody, { type: "kill" }>> = {}): GameEventBody =>
  ({ type: "kill", target: "Test Rat", family: "sump_rat", tier: "mob", overkill: 0, how: "swing", ...over });
const hurt = (source: string, hpPct = 80): GameEventBody =>
  ({ type: "damageTaken", amount: 3, source, cause: "test", hp: 8, hpPct });
const died = (over: Partial<Extract<GameEventBody, { type: "died" }>> = {}): GameEventBody =>
  ({ type: "died", cause: "a test", source: "enemy", floor: 1, gold: 0, asleep: false, rounds: 3, killer: "scrap_goblin", tier: "mob", ...over });
/** The first n shards that fill a lore line in the Codex. */
const loreShards = (n: number) => content.codex.all.filter((e) => e.type === "lore").flatMap((e) => e.lines).slice(0, n);

/** Run the achievement engine on a world with some events, as the end of a step would. */
function settleWith(world: World, events: GameEventBody[], setup: (c: Crawler, w: World) => void = () => {}) {
  const draft = clone(world);
  setup(draft.game.crawler!, draft);
  const ctx = new StepContext(draft, content);
  for (const e of events) ctx.emit(e);
  settle(ctx);
  return ctx;
}
const earned = (ctx: StepContext) => ctx.game.crawler!.achievements;

/** Each starter achievement: what makes it fire. At least 20 must pass (the Milestone 7 check). */
const CASES: { id: string; events?: GameEventBody[]; setup?: (c: Crawler, w: World) => void }[] = [
  { id: "first_blood", events: [kill()] },
  { id: "first_spell", events: [{ type: "spellCast", spell: "Grease Fire", school: "fire", scroll: false, first: true, inCombat: true }] },
  { id: "first_safe_room", events: [noop], setup: (c) => { c.counters["rooms.safe"] = 1; } },
  { id: "first_craft", events: [{ type: "crafted", recipe: "Nail Bat" }] },
  { id: "first_level", events: [noop], setup: (c) => { c.counters.levels = 1; } },
  { id: "first_buy", events: [{ type: "shopBought", item: "Pipe", price: 10, shopkeeper: "Test" }] },
  { id: "first_box", events: [{ type: "boxOpened", boxId: "box1", tier: "bronze", boxType: "adventurer", contents: [] }] },
  { id: "rat_catcher_10", events: [noop], setup: (c) => { c.counters["kills.sump_rat"] = 10; } },
  { id: "kills_25", events: [noop], setup: (c) => { c.counters["kills.total"] = 25; } },
  { id: "kills_100", events: [noop], setup: (c) => { c.counters["kills.total"] = 100; } },
  { id: "overkill", events: [kill({ overkill: 20 })] },
  { id: "elite_slayer", events: [kill({ tier: "elite" })] },
  { id: "crit_five", events: [noop], setup: (c) => { c.counters["checks.crit"] = 5; } },
  { id: "last_stand", events: [{ type: "combatEnded", outcome: "victory" }], setup: (c) => { c.hp = 1; } },
  { id: "ten_percent", events: [hurt("enemy", 6)], setup: (c) => { c.hp = 1; } },
  { id: "ate_dirt", events: [noop], setup: (c) => { c.counters["damage.taken"] = 200; } },
  { id: "rooms_20", events: [noop], setup: (c) => { c.counters["rooms.entered"] = 20; } },
  { id: "rooms_60", events: [noop], setup: (c) => { c.counters["rooms.entered"] = 60; } },
  { id: "floor_cleared", events: [{ type: "floorCleared", floor: 1 }] },
  { id: "shard_hunter", events: [{ type: "shardFound", id: "s", strand: "x", floor: 1, first: true, delivery: "room", clue: "", reaction: "" }] },
  { id: "echo_module", events: [{ type: "moduleBuilt", name: "Chalk" }] },
  { id: "crafts_5", events: [noop], setup: (c) => { c.counters.crafts = 5; } },
  { id: "spells_20", events: [noop], setup: (c) => { c.counters["spells.cast"] = 20; } },
  { id: "potion_junkie", events: [noop], setup: (c) => { c.counters["items.potion"] = 10; } },
  { id: "hit_yourself", events: [hurt("self")] },
  { id: "trap_victim", events: [hurt("hazard")] },
  { id: "fumble_three", events: [noop], setup: (c) => { c.counters["checks.fumble"] = 3; } },
  { id: "broke", events: [noop], setup: (c) => { c.counters["shop.bought"] = 1; c.gold = 0; } },
  { id: "big_spender", events: [noop], setup: (c) => { c.counters["gold.spent"] = 500; } },
  { id: "seller", events: [noop], setup: (c) => { c.counters["shop.sold"] = 5; } },
  { id: "safe_sleeper", events: [{ type: "sleepStageChanged", from: "tired", to: "rested", name: "Rested", worse: false }], setup: (c) => { c.counters["rooms.safe"] = 2; } },
  { id: "mood_up", events: [noop], setup: (_c, w) => { w.game.narrator.mood = 6; } },
  { id: "boss_kill", events: [kill({ tier: "boss" })] },
  { id: "elite_five", events: [noop], setup: (c) => { c.counters["kills.elite"] = 5; } },
  // Milestone 9: districts and their champions.
  { id: "champion_slayer", events: [kill({ tier: "elite", champion: "intake" })] },
  { id: "regime_change", events: [{ type: "championsCleared", floor: 2, count: 3 }] },
  { id: "tourist", events: [{ type: "districtEntered", floor: 2, district: "the_unclaimed", name: "The Unclaimed", index: 2, of: 3, allSeen: true }] },
  { id: "kills_500", events: [noop], setup: (c) => { c.counters["kills.total"] = 500; } },
  { id: "crit_twenty", events: [noop], setup: (c) => { c.counters["checks.crit"] = 20; } },
  { id: "first_flee", events: [{ type: "combatEnded", outcome: "fled" }] },
  { id: "one_hp", events: [{ type: "damageTaken", amount: 4, source: "enemy", cause: "test", hp: 1, hpPct: 3 }] },
  { id: "big_hit", events: [{ type: "damageTaken", amount: 20, source: "enemy", cause: "test", hp: 5, hpPct: 15 }] },
  { id: "load_bearing", events: [noop], setup: (c) => { c.counters["damage.taken"] = 1000; } },
  { id: "rooms_100", events: [noop], setup: (c) => { c.counters["rooms.entered"] = 100; } },
  { id: "wide_awake", events: [{ type: "sleepStageChanged", from: "tired", to: "exhausted", name: "Exhausted", worse: true }] },
  { id: "seeing_things", events: [{ type: "sleepStageChanged", from: "exhausted", to: "delirious", name: "Delirious", worse: true }] },
  { id: "crafts_20", events: [noop], setup: (c) => { c.counters.crafts = 20; } },
  { id: "recipe_ten", events: [noop], setup: (c) => { c.recipes = Array.from({ length: 10 }, (_, i) => `r${i}`); } },
  { id: "spells_100", events: [noop], setup: (c) => { c.counters["spells.cast"] = 100; } },
  { id: "learn_five", events: [noop], setup: (c) => { c.spells = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`s${i}`, { level: 1, casts: 0, cooldown: 0 }])); } },
  { id: "empty_tank", events: [{ type: "spellCast", spell: "Grease Fire", school: "fire", scroll: false, first: false, inCombat: true }], setup: (c) => { c.mp = 0; } },
  { id: "dragon_complex", events: [noop], setup: (c) => { c.gold = 1000; } },
  { id: "loyalty_program", events: [noop], setup: (c) => { c.counters["shop.bought"] = 20; } },
  { id: "gambling_problem", events: [noop], setup: (c) => { c.counters["boxes.opened"] = 10; } },
  { id: "jackpot", events: [{ type: "boxOpened", boxId: "box1", tier: "gold", boxType: "adventurer", contents: [] }] },
  { id: "overachiever", events: [noop], setup: (c) => { c.achievements = Array.from({ length: 10 }, (_, i) => `fake${i}`); } },
  { id: "trophy_case", events: [noop], setup: (c) => { c.achievements = Array.from({ length: 25 }, (_, i) => `fake${i}`); } },
  { id: "fumble_ten", events: [noop], setup: (c) => { c.counters["checks.fumble"] = 10; } },
  { id: "cardio_day", events: [noop], setup: (c) => { c.counters["combats.fled"] = 5; } },
  { id: "shards_5", events: [noop], setup: (c) => { c.counters.shards = 5; } },
  { id: "modules_3", events: [noop], setup: (c) => { c.counters.modules = 3; } },
  { id: "villain_monologue", events: [{ type: "shardFound", id: "s", strand: "x", floor: 1, first: true, delivery: "boss", clue: "", reaction: "" }] },
  { id: "rat_union", events: [noop], setup: (c) => { c.counters["kills.sump_rat"] = 100; } },
  // Milestone 8: deaths (they pay legacy points) and the account-level ones.
  { id: "first_death", events: [died()] },
  { id: "rodent_rights", events: [died({ killer: "sump_rat" })] },
  { id: "death_by_furniture", events: [died({ source: "hazard", killer: undefined, tier: undefined })] },
  { id: "tutorial_boss", events: [died({ floor: 1 })] },
  { id: "cant_take_it", events: [died({ gold: 140 })] },
  { id: "rest_in_pieces", events: [died({ asleep: true })] },
  { id: "boss_briefly", events: [died({ tier: "boss", killer: "free_sample_mimic", rounds: 1 })] },
  { id: "recurring_customer", events: [noop], setup: (_c, w) => { w.account.deaths = 10; } },
  { id: "codex_lines_20", events: [noop], setup: (_c, w) => { w.account.thread.shards = loreShards(20); } },
  { id: "wardrobe_change", events: [noop], setup: (_c, w) => { w.account.thread.vessels = content.thread.vessels.map((v) => v.id); } },
];

describe("achievements fire", () => {
  it("every starter achievement has a case here", () => {
    expect(CASES.map((c) => c.id).sort()).toEqual(content.achievements.all.map((a) => a.id).sort());
  });

  for (const k of CASES) {
    it(`${k.id} fires`, () => {
      const ctx = settleWith(exploring(), k.events ?? [], k.setup);
      expect(earned(ctx)).toContain(k.id);
      expect(of(ctx.events as never, "achievementEarned").some((e) => e.achievementId === k.id)).toBe(true);
      expect(ctx.account.codex.achievements).toContain(k.id);
    });
  }

  it("a near miss does not fire (overkill 14, a mob, 24 kills)", () => {
    const ctx = settleWith(exploring(), [kill({ overkill: 14 })], (c) => { c.counters["kills.total"] = 23; });
    expect(earned(ctx)).not.toContain("overkill");
    expect(earned(ctx)).not.toContain("elite_slayer");
    expect(earned(ctx)).not.toContain("kills_25"); // 23 + this kill = 24
  });

  it("counters come from events: 25 kills trip kills_25 and the rat counter keeps its own tally", () => {
    const ctx = settleWith(exploring(), Array.from({ length: 25 }, () => kill()));
    const c = ctx.game.crawler!;
    expect(c.counters["kills.total"]).toBe(25);
    expect(c.counters["kills.sump_rat"]).toBe(25);
    expect(earned(ctx)).toEqual(expect.arrayContaining(["kills_25", "rat_catcher_10"]));
  });

  it("an achievement fires once, not again on the next step", () => {
    const first = settleWith(exploring(), [kill()]);
    const second = settleWith(first.world, [kill()]);
    expect(earned(second).filter((id) => id === "first_blood")).toHaveLength(1);
    expect(of(second.events as never, "achievementEarned").some((e) => e.achievementId === "first_blood")).toBe(false);
  });

  it("a box reward lands in the pack, unopened, and moves the mood", () => {
    const ctx = settleWith(exploring(), [kill({ tier: "elite" })]);
    expect(ctx.game.boxes.some((b) => b.source.includes("Above Your Pay Grade"))).toBe(true);
    expect(ctx.game.narrator.mood).toBe(2); // First Blood and Above Your Pay Grade, +1 each
  });

  it("a payout's own events count: boxes.earned reaches the counters", () => {
    const ctx = settleWith(exploring(), [kill({ tier: "elite" })]);
    expect(ctx.game.crawler!.counters["boxes.earned"]).toBeGreaterThanOrEqual(1);
  });

  it("a routine first pays nothing: just the remark, and the mood still moves", () => {
    const ctx = settleWith(exploring(), [kill()]);
    expect(ctx.game.crawler!.achievements).toContain("first_blood");
    expect(content.achievements.get("first_blood").reward).toBeUndefined();
    expect(ctx.game.boxes).toHaveLength(0);
    const said = ctx.events.find((e) => e.type === "narration" && e.key === "achievement.earned")!;
    expect((said as { text: string }).text).not.toMatch(/Reward:|You get|box/);
    expect(of(ctx.events as never, "achievementEarned")[0]!.reward).toBe("");
    expect(ctx.game.narrator.mood).toBe(1);
  });

  it("the routine firsts and the ones for collecting rewards are sarcasm only", () => {
    const free = ["first_blood", "first_spell", "first_safe_room", "first_craft", "first_level", "first_buy", "first_box", "first_flee",
      "rooms_20", "gambling_problem", "jackpot", "overachiever", "trophy_case"];
    for (const id of free) expect(content.achievements.get(id).reward, id).toBeUndefined();
    expect(content.achievements.get("first_death").reward).toEqual({ legacy: 5 }); // dying still pays the account
  });

  it("the System AI says something for each one (no speechless fallbacks)", () => {
    const ctx = settleWith(exploring(), [kill()]);
    const said = ctx.events.filter((e) => e.type === "narration" && e.key === "achievement.earned");
    expect(said.length).toBeGreaterThan(0);
    expect(said.every((e) => e.type === "narration" && !e.text.includes("speechless"))).toBe(true);
  });

  it("mood clamps to -10..+10", () => {
    expect(clampMood(99)).toBe(10);
    expect(clampMood(-99)).toBe(-10);
  });
});

describe("through the real reducer", () => {
  it("killing something in a fight earns First Blood in the same step", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    const c = world.game.crawler!;
    c.inventory = [{ uid: "w1", baseId: "t", kind: "gear", name: "Club", rarity: "common", slot: "mainHand", power: [9, 9, 9], damageType: "physical", stat: "STR", modifiers: [], weight: 1, value: 0, qty: 1, tags: [] }];
    c.equipment = { mainHand: "w1" };
    world.account.settings = { combatMode: "bands" };
    world.game.combat = {
      mode: "bands", enemies: [testEnemy({ hp: 1, maxHP: 1 })], round: 1, playerInitiative: 15, ap: 0, apMax: 3, turnBegun: false,
      fromRoom: world.game.floor!.currentRoom,
    };
    world.game.phase = "combat";
    forceDice(10, 10);
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(of(events, "kill")).toHaveLength(1);
    expect(w.game.crawler!.counters["kills.total"]).toBe(1);
    expect(w.game.crawler!.achievements).toContain("first_blood");
    expect(of(events, "achievementEarned").map((e) => e.achievementId)).toContain("first_blood");
    expect(w.game.boxes.some((b) => b.source.includes("First Blood"))).toBe(false); // sarcasm only
  });
});
