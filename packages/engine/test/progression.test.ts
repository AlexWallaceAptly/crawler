import { afterEach, describe, expect, it } from "vitest";
import { forceDice, resetRng, setRandomSource } from "../src/rng";
import { itemFromRef } from "../src/gen/item";
import { profileOf, swingNumbers } from "../src/gear";
import { collectModifiers } from "../src/rules/derived";
import { skillRank, skillXpToNext, xpToNext } from "../src/progression";
import { content, engine, of, testEnemy } from "./helpers";
import type { Enemy, ItemInstance, World } from "../src/state";

afterEach(() => resetRng());

const knife = (over: Partial<ItemInstance> = {}): ItemInstance => ({
  uid: "w1", baseId: "test_knife", kind: "gear", name: "Test Knife", rarity: "common",
  slot: "mainHand", power: [2, 4, 6], damageType: "physical", stat: "DEX", weaponType: "blades", apCost: 1,
  modifiers: [], weight: 1, value: 0, qty: 1, tags: [], ...over,
});

/** A bands fight with the fixture crawler holding `weapon` (a 1-AP knife by default). */
function fightWorld(enemies: Enemy[] = [testEnemy({ hp: 99, maxHP: 99 })], weapon = knife()): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  const c = world.game.crawler!;
  c.baseStats = { STR: 10, DEX: 6, CON: 8, INT: 4, CHA: 8 };
  c.skills = {};
  c.statuses = [];
  c.xp = 0;
  c.level = 1;
  c.inventory = [weapon];
  c.equipment = { mainHand: weapon.uid };
  c.hp = 34;
  world.account.settings = { combatMode: "bands" };
  world.game.combat = {
    mode: "bands", enemies, round: 1, playerInitiative: 15, ap: 0, apMax: 3, turnBegun: false,
    fromRoom: world.game.floor!.currentRoom,
  };
  world.game.phase = "combat";
  return world;
}

function exploring(): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  return world;
}

describe("the curves", () => {
  it("levels: 25 XP for level 2, then a little more each time", () => {
    expect([1, 2, 3, 4, 5].map(xpToNext)).toEqual([25, 47, 67, 87, 106]);
  });

  it("skills: 3 uses to rank 1, 42 to rank 5, 609 to rank 15", () => {
    const total = (to: number) => Array.from({ length: to }, (_, r) => skillXpToNext(r)).reduce((a, b) => a + b, 0);
    expect([0, 1, 2, 3, 4].map(skillXpToNext)).toEqual([3, 5, 8, 11, 15]);
    expect(total(5)).toBe(42);
    expect(total(10)).toBe(212);
    expect(total(15)).toBe(609);
  });
});

describe("leveling up", () => {
  it("a win that crosses the line: level 2, a full heal, 3 points, and the VICTORY line first", () => {
    const world = fightWorld([testEnemy({ hp: 1, xp: 30 })]);
    world.game.crawler!.hp = 5;
    forceDice(1, 1);
    const { world: w, events } = engine.step(world, { type: "attack" });
    const c = w.game.crawler!;
    expect(c.level).toBe(2);
    expect(c.xp).toBe(5);
    expect(c.unspentStatPoints).toBe(3);
    expect(c.hp).toBe(10 + 3 * 8 + 2 * 2); // full, at the new level's max
    const ended = of(events, "combatEnded")[0]!;
    expect(ended).toMatchObject({ xp: 30, level: 2, xpNow: 5, xpNext: 47 });
    const up = of(events, "levelUp")[0]!;
    expect(up).toMatchObject({ level: 2, statPoints: 3, unspent: 3 });
    expect(events.indexOf(ended)).toBeLessThan(events.indexOf(up));
    expect(events.some((e) => e.type === "narration" && e.key === "progress.levelUp")).toBe(true);
  });

  it("a big win can pay for two levels at once", () => {
    const world = fightWorld([testEnemy({ hp: 1, xp: 100 })]);
    forceDice(1, 1);
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(w.game.crawler!.level).toBe(3);
    expect(w.game.crawler!.xp).toBe(100 - 25 - 47);
    expect(w.game.crawler!.unspentStatPoints).toBe(6);
    expect(of(events, "levelUp").map((e) => e.level)).toEqual([2, 3]);
  });

  it("an old save's banked XP turns into levels on load, quietly", () => {
    const world = exploring();
    world.game.crawler!.xp = 140; // 25 + 47 + 67 = 139
    const restored = engine.restore(JSON.parse(JSON.stringify(world.game)), JSON.parse(JSON.stringify(world.account)))!;
    expect(restored.game.crawler!.level).toBe(4);
    expect(restored.game.crawler!.xp).toBe(1);
    expect(restored.game.crawler!.unspentStatPoints).toBe(9);
  });

  it("Quick Learner's 10% finally counts", () => {
    const world = fightWorld([testEnemy({ hp: 1, xp: 20 })]);
    world.game.crawler!.backstory.quirk = "quick_learner";
    forceDice(1, 1);
    const { world: w } = engine.step(world, { type: "attack" });
    expect(w.game.crawler!.xp).toBe(22);
  });

  it("`raise str` spends a point; more CON is more HP right away; not mid-fight, not without points", () => {
    let world = exploring();
    const c = world.game.crawler!;
    c.unspentStatPoints = 3;
    const str = c.baseStats.STR;
    const con = c.baseStats.CON;
    const hp = c.hp;
    ({ world } = engine.input(world, "raise str"));
    expect(world.game.crawler!.baseStats.STR).toBe(str + 1);
    expect(world.game.crawler!.unspentStatPoints).toBe(2);
    ({ world } = engine.input(world, "raise constitution 2"));
    expect(world.game.crawler!.baseStats.CON).toBe(con + 2);
    expect(world.game.crawler!.hp).toBe(hp + 6);
    expect(world.game.crawler!.unspentStatPoints).toBe(0);
    const none = engine.input(world, "raise dex");
    expect(of(none.events, "error")).toHaveLength(1);

    const fight = fightWorld();
    fight.game.crawler!.unspentStatPoints = 1;
    const r = engine.input(fight, "raise str");
    expect(of(r.events, "error")).toHaveLength(1);
    expect(r.world.game.crawler!.unspentStatPoints).toBe(1);
  });
});

describe("skills from use", () => {
  it("three swings with a blade teach Blades; a crit counts double", () => {
    let world = fightWorld();
    forceDice(5, 5, 5, 5, 5, 5);
    for (let i = 0; i < 3; i++) ({ world } = engine.step(world, { type: "attack" }));
    expect(world.game.crawler!.skills["blades"]).toEqual({ rank: 1, xp: 0 });

    const crit = fightWorld();
    forceDice(10, 10);
    const r = engine.step(crit, { type: "attack" });
    expect(r.world.game.crawler!.skills["blades"]).toEqual({ rank: 0, xp: 2 });
  });

  it("a rank-up says so, and every 5th rank names its perk", () => {
    const world = fightWorld();
    world.game.crawler!.skills["blades"] = { rank: 4, xp: 14 }; // 15 to rank 5
    forceDice(5, 5);
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(w.game.crawler!.skills["blades"]).toEqual({ rank: 5, xp: 0 });
    expect(of(events, "skillUp")[0]).toMatchObject({ skillId: "blades", rank: 5, perkName: "Decapitation", nextPerk: { rank: 10 } });
    expect(events.some((e) => e.type === "narration" && e.key === "progress.milestone")).toBe(true);
  });

  it("the fight's summary lists what each skill got", () => {
    const world = fightWorld([testEnemy({ hp: 1 })]);
    forceDice(1, 1);
    const { events } = engine.step(world, { type: "attack" });
    expect(of(events, "combatEnded")[0]!.skills).toEqual([{ id: "blades", name: "Blades", gained: 1, rank: 0, xp: 1, next: 3 }]);
  });

  it("trained ranks stop at 15; gear can push the rank rolls use past it", () => {
    const world = fightWorld(undefined, knife({ modifiers: [{ to: "skill:blades", value: 2 }] }));
    const c = world.game.crawler!;
    c.skills["blades"] = { rank: 15, xp: 0 };
    forceDice(5, 5);
    const { world: w } = engine.step(world, { type: "attack" });
    expect(w.game.crawler!.skills["blades"]).toEqual({ rank: 15, xp: 0 });
    expect(skillRank(c, "blades", collectModifiers(c, content))).toBe(17);
    expect(swingNumbers(c, content, profileOf(content, c.inventory[0], c)).skillRank).toBe(17);
  });

  it("out of a fight, a gain is a quiet line: a search that finds something trains Perception", () => {
    let world = exploring();
    const floor = world.game.floor!;
    const room = floor.rooms[floor.currentRoom]!;
    room.hidden = [itemFromRef(content, "duct_tape")];
    world.game.crawler!.skills = {};
    const r = engine.input(world, "search");
    world = r.world;
    expect(world.game.crawler!.skills["perception"]).toEqual({ rank: 0, xp: 1 });
    expect(of(r.events, "skillXp")[0]).toMatchObject({ skillId: "perception", gained: 1, xp: 1, next: 3 });
  });
});

describe("milestone perks", () => {
  it("Decapitation: a blade hit can end a non-boss outright, and it still pays XP", () => {
    const world = fightWorld([testEnemy({ hp: 50, maxHP: 50, xp: 10 })]);
    world.game.crawler!.skills["blades"] = { rank: 5, xp: 0 };
    setRandomSource(() => 0); // every chance() lands
    forceDice(5, 5);
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(w.game.combat).toBeNull();
    expect(of(events, "combatLine").some((e) => /DECAPITATION/.test(e.text))).toBe(true);
    expect(of(events, "combatEnded")[0]!.xp).toBe(10);
  });

  it("bosses keep their heads", () => {
    const world = fightWorld([testEnemy({ hp: 50, maxHP: 50, tier: "boss" })]);
    world.game.crawler!.skills["blades"] = { rank: 5, xp: 0 };
    setRandomSource(() => 0);
    forceDice(5, 5);
    const { world: w } = engine.step(world, { type: "attack" });
    expect(w.game.combat!.enemies[0]!.hp).toBeGreaterThan(0);
  });

  it("Reach: a Polearms 5 crawler hits something at near range without stepping in", () => {
    const pole = knife({ name: "Test Pole", weaponType: "polearm", stat: "STR", apCost: 2, range: "close" });
    const world = fightWorld([testEnemy({ hp: 50, maxHP: 50, range: "near" })], pole);
    const c = world.game.crawler!;
    expect(profileOf(content, pole, c).reach).toBe("close");
    c.skills["polearms"] = { rank: 5, xp: 0 };
    expect(profileOf(content, pole, c).reach).toBe("near");
    forceDice(5, 5);
    const { world: w } = engine.step(world, { type: "attack" });
    expect(w.game.combat!.enemies[0]!.hp).toBeLessThan(50);
    expect(w.game.combat!.enemies[0]!.range).toBe("near");
  });

  it("Unarmed 5 and 10 harden your fists; Improvised 10 makes great hits bigger", () => {
    const world = fightWorld();
    const c = world.game.crawler!;
    c.inventory = [];
    c.equipment = {};
    c.skills["unarmed"] = { rank: 5, xp: 0 };
    expect(profileOf(content, undefined, c).power).toEqual([2, 4, 6]);
    c.skills["unarmed"] = { rank: 10, xp: 0 };
    expect(profileOf(content, undefined, c).power).toEqual([3, 5, 7]);

    const brick = knife({ weaponType: "improvised", stat: "STR", apCost: 2, power: [2, 4, 6] });
    c.inventory = [brick];
    c.equipment = { mainHand: brick.uid };
    const before = swingNumbers(c, content, profileOf(content, brick, c)).damage;
    c.skills["improvised"] = { rank: 10, xp: 0 };
    const after = swingNumbers(c, content, profileOf(content, brick, c));
    expect(after.rollBonus).toBe(swingNumbers({ ...c, skills: { improvised: { rank: 10, xp: 0 } } }, content, profileOf(content, brick, c)).rollBonus);
    expect(after.damage[2]).toBe(Math.round(before[2] * 1.5));
  });
});

describe("skill potions and stat items", () => {
  it("a Muscle Memory Shot is a rank in the skill of the weapon in your hand", () => {
    let world = exploring();
    const c = world.game.crawler!;
    const k = knife();
    c.inventory.push(k, itemFromRef(content, "muscle_memory_shot"));
    c.equipment.mainHand = k.uid;
    c.skills = {};
    const r = engine.input(world, "use muscle memory shot");
    world = r.world;
    expect(world.game.crawler!.skills["blades"]!.rank).toBe(1);
    expect(of(r.events, "skillUp")[0]).toMatchObject({ skillId: "blades", rank: 1 });
  });

  it("Unlabeled Growth Hormone is +1 STR for good; the timed tonics stay timed", () => {
    let world = exploring();
    const c = world.game.crawler!;
    const str = c.baseStats.STR;
    c.inventory.push(itemFromRef(content, "bootleg_hgh"), itemFromRef(content, "strength_tonic"));
    ({ world } = engine.input(world, "use unlabeled growth hormone"));
    expect(world.game.crawler!.baseStats.STR).toBe(str + 1);
    ({ world } = engine.input(world, "use bodybuilder tonic"));
    expect(world.game.crawler!.baseStats.STR).toBe(str + 1);
  });
});
