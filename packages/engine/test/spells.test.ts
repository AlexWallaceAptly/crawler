import { afterEach, describe, expect, it } from "vitest";
import { content, engine, gridWorld, lines, of, testEnemy } from "./helpers";
import { loadContent } from "../src/content/load";
import { rawContent } from "@crawler/content";
import { forceDice, resetRng, setRandomSource } from "../src/rng";
import { parseCommand } from "../src/parser";
import { itemFromRef } from "../src/gen/item";
import { generateCrawler } from "../src/gen/backstory";
import { springTrap } from "../src/explore";
import { StepContext } from "../src/step";
import { describeModifier } from "../src/rules/modifiers";
import { derive } from "../src/rules/derived";
import { SPELL_LEVEL_CAP, spellCastsToNext } from "../src/spells";
import { SPELL_SCHOOLS } from "../src/content/schemas";
import type { Enemy, ItemInstance, World } from "../src/state";

afterEach(() => resetRng());

/**
 * A bands fight. The crawler has INT 8: +4 on the roll, and +4 flat on a 2-AP spell
 * (+2 on a 1-AP one). Grease Fire is 3/5/7 fire, 3 MP, 2 AP.
 */
function bandsFight(spells: string[], enemies: Enemy[] = [testEnemy({ maxHP: 30, hp: 30 })]): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  const c = world.game.crawler!;
  c.baseStats = { STR: 10, DEX: 6, CON: 8, INT: 8, CHA: 8 };
  c.skills = {};
  c.statuses = [];
  c.inventory = [];
  c.equipment = {};
  c.spells = Object.fromEntries(spells.map((id) => [id, { level: 1, casts: 0, cooldown: 0 }]));
  c.hp = 30;
  c.mp = 20;
  world.account.settings = { combatMode: "bands" };
  world.game.combat = {
    mode: "bands", enemies, round: 1, playerInitiative: 15, ap: 0, apMax: 3, turnBegun: false,
    fromRoom: world.game.floor!.currentRoom,
  };
  world.game.phase = "combat";
  return world;
}

/** An exploring world with a known crawler. */
function exploring(spells: string[]): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  const c = world.game.crawler!;
  c.baseStats = { STR: 6, DEX: 6, CON: 8, INT: 8, CHA: 8 };
  c.spells = Object.fromEntries(spells.map((id) => [id, { level: 1, casts: 0, cooldown: 0 }]));
  c.mp = 20;
  c.statuses = [];
  return world;
}

function spellItem(base: "spell_tome" | "spell_scroll", spellId: string, level?: number): ItemInstance {
  const it = itemFromRef(content, base, 1, 1);
  const spell = content.spells.get(spellId);
  it.spellId = spellId;
  it.name = `${base === "spell_tome" ? "Tome" : "Scroll"} of ${spell.name}`;
  if (base === "spell_scroll") it.spellLevel = level ?? 1;
  return it;
}

describe("content", () => {
  it("every school has exactly one magic skill, and each perk says what it does", () => {
    for (const school of SPELL_SCHOOLS) {
      const skills = content.skills.all.filter((s) => s.school === school);
      expect(skills).toHaveLength(1);
      expect(skills[0]!.category).toBe("magic");
      expect(skills[0]!.perks.map((p) => p.rank)).toEqual([5, 10, 15]);
    }
    expect(content.skills.has("spellcasting")).toBe(false);
    expect(describeModifier({ to: "mpCost:protection", value: -1 }, content)).toBe("protection spells cost 1 less MP (minimum 1)");
    expect(describeModifier({ to: "damage:fire", value: 2 }, content)).toBe("+2 damage with fire spells");
  });

  it("fails validation on a magic perk nothing reads", () => {
    const raw = JSON.parse(JSON.stringify(rawContent)) as Record<string, unknown>;
    const skills = raw["skills.json"] as { id: string; perks: { modifiers: { to: string; value: number }[] }[] }[];
    skills.find((s) => s.id === "fire_magic")!.perks[0]!.modifiers = [{ to: "blorp:fire", value: 1 }];
    expect(() => loadContent(raw as never)).toThrow(/nothing reads the modifier "blorp:fire"/);
  });

  it("tomes and scrolls roll a spell from their floor or shallower; scrolls cast at the floor's level", () => {
    for (let i = 0; i < 200; i++) {
      const tome = itemFromRef(content, "spell_tome", 1, 1);
      expect(content.spells.get(tome.spellId!).floor).toBe(1);
      expect(tome.name).toMatch(/^Tome of /);
      expect(tome.spellLevel).toBeUndefined();
      const scroll = itemFromRef(content, "spell_scroll", 1, 3);
      expect(content.spells.get(scroll.spellId!).floor).toBeLessThanOrEqual(3);
      expect(scroll.spellLevel).toBe(3);
    }
  });

  it("a magic backstory starts with its spell, and the System says so", () => {
    const occupations = { ...content.backstory.occupations, all: [content.backstory.occupations.get("retired_magician")] };
    const rigged = { ...content, backstory: { ...content.backstory, occupations } };
    const c = generateCrawler(rigged);
    expect(c.spells).toEqual({ bait_and_switch: { level: 1, casts: 0, cooldown: 0 } });
    const plain = { ...content.backstory.occupations, all: [content.backstory.occupations.get("line_cook")] };
    const events = { ...content.backstory.events, all: [content.backstory.events.get("house_fire")] };
    expect(generateCrawler({ ...content, backstory: { ...content.backstory, occupations: plain, events } }).spells).toEqual({});
  });
});

describe("casting in a fight", () => {
  it("rolls 2d10 + INT/2 + the school's rank and deals the tier's power + INT's flat bonus", () => {
    const world = bandsFight(["grease_fire"]);
    setRandomSource(() => 0.99); // the burning rider's 40% doesn't land
    forceDice(5, 5); // 10 + 4 = 14: tier 2, 5 + 4 = 9
    const { world: w, events } = engine.step(world, { type: "cast", spell: "grease fire" });
    const c = w.game.crawler!;
    expect(w.game.combat!.enemies[0]!.hp).toBe(21);
    expect(lines(events)).toContain("Grease Fire hits the Test Rat");
    expect(lines(events)).toContain("9 damage");
    expect(c.mp).toBe(17);
    expect(w.game.combat!.ap).toBe(1);
    expect(c.skills.fire_magic).toEqual({ rank: 0, xp: 1 }); // the school trains
    expect(c.spells.grease_fire!.casts).toBe(1);
    expect(of(events, "narration").some((e) => e.key === "spell.firstCast")).toBe(true);
  });

  it("school ranks add to the roll", () => {
    const world = bandsFight(["grease_fire"]);
    world.game.crawler!.skills = { fire_magic: { rank: 3, xp: 0 } };
    setRandomSource(() => 0.99);
    forceDice(4, 4); // 8 + 4 + 3 = 15: tier 2 (11 without the rank: tier 1)
    const { events } = engine.step(world, { type: "cast", spell: "grease fire" });
    expect(lines(events)).toContain("Tier 2");
  });

  it("riders never land on tier 1 and always on tier 3", () => {
    const [one, two] = [bandsFight(["grease_fire"]), bandsFight(["grease_fire"])];
    setRandomSource(() => 0); // every chance would land
    forceDice(1, 1);
    let { world: w } = engine.step(one, { type: "cast", spell: "grease fire" });
    expect(w.game.combat!.enemies[0]!.statuses).toEqual([]);
    setRandomSource(() => 0.99); // no chance lands
    forceDice(9, 9); // 18 + 4 = 22: tier 3
    ({ world: w } = engine.step(two, { type: "cast", spell: "grease fire" }));
    expect(w.game.combat!.enemies[0]!.statuses.map((s) => s.id)).toEqual(["burning"]);
  });

  it("status spells always land; the tier sets how long", () => {
    forceDice(1, 1); // tier 1: 1 round
    let { world: w } = engine.step(bandsFight(["bait_and_switch"]), { type: "cast", spell: "bait and switch" });
    expect(w.game.combat!.enemies[0]!.statuses).toMatchObject([{ id: "confused", remaining: 1 }]);
    forceDice(5, 5); // tier 2: the spell's 2
    ({ world: w } = engine.step(bandsFight(["bait_and_switch"]), { type: "cast", spell: "bait and switch" }));
    expect(w.game.combat!.enemies[0]!.statuses).toMatchObject([{ id: "confused", remaining: 2 }]);
    forceDice(9, 9); // tier 3: one more
    ({ world: w } = engine.step(bandsFight(["bait_and_switch"]), { type: "cast", spell: "bait and switch" }));
    expect(w.game.combat!.enemies[0]!.statuses).toMatchObject([{ id: "confused", remaining: 3 }]);
  });

  it("is refused, at no cost, when MP is short, it's recharging, or you're out of AP", () => {
    let world = bandsFight(["grease_fire"]);
    world.game.crawler!.mp = 2;
    let { world: w, events } = engine.step(world, { type: "cast", spell: "grease fire" });
    expect(of(events, "error")[0]!.text).toContain("costs 3 MP and you have 2");
    expect(w.game.crawler!.mp).toBe(2);
    expect(w.game.combat!.ap).toBe(3);

    world = bandsFight(["grease_fire"]);
    world.game.crawler!.spells.grease_fire!.cooldown = 1;
    ({ world: w, events } = engine.step(world, { type: "cast", spell: "grease fire" }));
    expect(of(events, "error")[0]!.text).toContain("isn't ready: 1 more round");
    expect(w.game.crawler!.mp).toBe(20);

    world = bandsFight(["grease_fire"]);
    Object.assign(world.game.combat!, { ap: 1, turnBegun: true });
    ({ world: w, events } = engine.step(world, { type: "cast", spell: "grease fire" }));
    expect(of(events, "error")[0]!.text).toContain("takes 2 AP and you have 1");
    expect(w.game.crawler!.mp).toBe(20);
  });

  it("can't be cast while feared", () => {
    const world = bandsFight(["grease_fire"]);
    world.game.crawler!.statuses = [{ id: "feared", remaining: 2, stacks: 1 }];
    const { world: w, events } = engine.step(world, { type: "cast", spell: "grease fire" });
    expect(lines(events)).toContain("Fear scrambles the words");
    expect(w.game.crawler!.mp).toBe(20);
  });

  it("cooldowns count down each round and clear when the fight ends", () => {
    const world = bandsFight(["dumpster_fire"], [testEnemy({ maxHP: 99, hp: 99 })]);
    setRandomSource(() => 0.99);
    forceDice(5, 5);
    let { world: w } = engine.step(world, { type: "cast", spell: "dumpster fire" });
    expect(w.game.crawler!.spells.dumpster_fire!.cooldown).toBe(2);
    ({ world: w } = engine.step(w, { type: "wait" }));
    expect(w.game.combat!.round).toBe(2);
    expect(w.game.crawler!.spells.dumpster_fire!.cooldown).toBe(1);
    w.game.combat!.enemies[0]!.hp = 1;
    forceDice(5, 5);
    ({ world: w } = engine.step(w, { type: "attack" }));
    expect(w.game.phase).toBe("exploring");
    expect(w.game.crawler!.spells.dumpster_fire!.cooldown).toBe(0);
  });

  it("an area spell in bands mode hits everyone in the target's band", () => {
    const near = testEnemy({ uid: "n1", name: "Near Rat", range: "near", maxHP: 30, hp: 30 });
    const close = testEnemy({ uid: "c1", name: "Close Rat", range: "close", maxHP: 30, hp: 30 });
    const close2 = testEnemy({ uid: "c2", name: "Other Rat", range: "close", maxHP: 30, hp: 30 });
    const world = bandsFight(["dumpster_fire"], [close, near, close2]);
    setRandomSource(() => 0.99);
    forceDice(5, 5); // tier 2: 3 + 4 = 7 each
    const { world: w } = engine.step(world, { type: "cast", spell: "dumpster fire", at: "close rat" });
    expect(w.game.combat!.enemies.map((e) => e.hp)).toEqual([23, 30, 23]);
  });

  it("a confused enemy may swing at its friend instead of you", () => {
    const a = testEnemy({ uid: "a", name: "Dizzy Rat", statuses: [{ id: "confused", remaining: 2, stacks: 1 }] });
    const b = testEnemy({ uid: "b", name: "Other Rat" });
    const world = bandsFight([], [a, b]);
    setRandomSource(() => 0); // the 50% lands; it picks the Other Rat
    const { world: w, events } = engine.step(world, { type: "wait" });
    expect(lines(events)).toContain("The Dizzy Rat, confused, turns its Bite on the Other Rat");
    expect(w.game.combat!.enemies[1]!.hp).toBe(7); // Bite's tier 2 (2) + DEX 5 / 4 (1)
  });
});

describe("spell levels", () => {
  it("a spell levels every 10 × level casts", () => {
    expect([1, 2, 3].map(spellCastsToNext)).toEqual([10, 20, 30]);
    let w = bandsFight(["hot_take"], [testEnemy({ maxHP: 999, hp: 999 })]);
    for (let i = 0; i < 10; i++) {
      w.game.crawler!.mp = 20;
      Object.assign(w.game.combat!, { ap: 3, turnBegun: true });
      ({ world: w } = engine.step(w, { type: "cast", spell: "hot take" }));
    }
    expect(w.game.crawler!.spells.hot_take).toMatchObject({ level: 2, casts: 0 });
  });

  it("a duplicate tome adds a level; a maxed spell refuses the tome", () => {
    const world = exploring(["grease_fire"]);
    world.game.crawler!.inventory.push(spellItem("spell_tome", "grease_fire"));
    let { world: w, events } = engine.step(world, { type: "use", item: "tome of grease fire" });
    expect(w.game.crawler!.spells.grease_fire!.level).toBe(2);
    expect(w.game.crawler!.inventory.some((i) => i.spellId === "grease_fire")).toBe(false);
    expect(of(events, "narration").some((e) => e.key === "spell.levelUp")).toBe(true);

    w.game.crawler!.spells.grease_fire!.level = SPELL_LEVEL_CAP;
    w.game.crawler!.inventory.push(spellItem("spell_tome", "grease_fire"));
    ({ world: w, events } = engine.step(w, { type: "use", item: "tome of grease fire" }));
    expect(of(events, "error")[0]!.text).toContain("nothing left to teach");
    expect(w.game.crawler!.inventory.some((i) => i.spellId === "grease_fire")).toBe(true);
  });

  it("a new tome teaches the spell at level 1, but not mid-fight", () => {
    const world = exploring([]);
    world.game.crawler!.inventory.push(spellItem("spell_tome", "overdraft"));
    const { world: w } = engine.step(world, { type: "use", item: "tome of overdraft" });
    expect(w.game.crawler!.spells.overdraft).toEqual({ level: 1, casts: 0, cooldown: 0 });

    const fight = bandsFight([]);
    fight.game.crawler!.inventory.push(spellItem("spell_tome", "overdraft"));
    const { world: f, events } = engine.step(fight, { type: "use", item: "tome of overdraft" });
    expect(of(events, "error")[0]!.text).toContain("peace and quiet");
    expect(f.game.crawler!.spells.overdraft).toBeUndefined();
  });

  it("a scroll casts once for free, trains the school, and doesn't level anything", () => {
    const world = bandsFight([]);
    world.game.crawler!.inventory.push(spellItem("spell_scroll", "grease_fire", 1));
    setRandomSource(() => 0.99);
    forceDice(5, 5);
    const { world: w } = engine.step(world, { type: "use", item: "scroll of grease fire" });
    const c = w.game.crawler!;
    expect(w.game.combat!.enemies[0]!.hp).toBe(21);
    expect(c.mp).toBe(20);
    expect(c.inventory).toHaveLength(0);
    expect(c.spells).toEqual({});
    expect(c.skills.fire_magic!.xp).toBe(1);
  });
});

describe("spells on the board", () => {
  it("an area spell covers its shape and leaves its hazard", () => {
    const [a, b, c] = [0, 1, 2].map((i) => testEnemy({ uid: `g${i}`, name: `Rat ${"ABC"[i]}`, maxHP: 30, hp: 30 }));
    const world = gridWorld([
      "@.....",
      "......",
      "..ab..",
      "...c..",
      "......",
    ], [a!, b!, c!]);
    const cr = world.game.crawler!;
    cr.baseStats.INT = 8;
    cr.spells = { dumpster_fire: { level: 1, casts: 0, cooldown: 0 } };
    cr.mp = 20;
    setRandomSource(() => 0.99);
    forceDice(5, 5); // tier 2: 3 + 4 = 7
    const { world: w } = engine.step(world, { type: "cast", spell: "dumpster fire", at: "c3" });
    expect(w.game.combat!.enemies.map((e) => e.hp)).toEqual([23, 23, 30]);
    expect(w.game.combat!.arena!.hazards).toContainEqual(expect.objectContaining({ x: 2, y: 2, id: "fire" }));
  });

  it("standing in your own area hurts", () => {
    const e = testEnemy({ maxHP: 30, hp: 30 });
    const world = gridWorld([
      ".....",
      ".@a..",
      ".....",
    ], [e]);
    const cr = world.game.crawler!;
    cr.baseStats.INT = 8;
    cr.spells = { dumpster_fire: { level: 1, casts: 0, cooldown: 0 } };
    cr.mp = 20;
    setRandomSource(() => 0.99);
    forceDice(5, 5);
    const { world: w, events } = engine.step(world, { type: "cast", spell: "dumpster fire", at: "c2" });
    expect(w.game.crawler!.hp).toBe(27);
    expect(lines(events)).toContain("You're inside your own Dumpster Fire");
  });

  it("a fire spell lights the oil under its target", () => {
    const e = testEnemy({ maxHP: 30, hp: 30 });
    const world = gridWorld([
      "@....",
      ".....",
      "..a..",
    ], [e]);
    world.game.combat!.arena!.hazards.push({ x: 2, y: 2, id: "oil_slick" });
    const cr = world.game.crawler!;
    cr.spells = { grease_fire: { level: 1, casts: 0, cooldown: 0 } };
    cr.mp = 20;
    setRandomSource(() => 0.99);
    forceDice(5, 5);
    const { world: w } = engine.step(world, { type: "cast", spell: "grease fire" });
    expect(w.game.combat!.arena!.hazards.find((h) => h.x === 2 && h.y === 2)?.id).toBe("fire");
  });

  it("is refused out of range, and the buttons only offer tiles it reaches", () => {
    const e = testEnemy();
    const world = gridWorld([
      "@.....a",
    ], [e]);
    world.game.crawler!.spells = { hot_take: { level: 1, casts: 0, cooldown: 0 } };
    world.game.crawler!.mp = 20;
    const { events } = engine.step(world, { type: "cast", spell: "hot take", at: "g1" });
    expect(of(events, "error")[0]!.text).toContain("out of range for Hot Take");
    // Nothing in reach: the button is there, greyed out, and arms nothing.
    expect(engine.commands(world).find((c) => c.label.startsWith("Cast Hot Take"))).toMatchObject({ label: "Cast Hot Take (out of reach)", disabled: true });
    expect(engine.commands(world).find((c) => c.label.startsWith("Cast Hot Take"))!.targets).toBeUndefined();
    // Next to it, there is one, and it arms a tile pick on the enemy.
    world.game.combat!.arena!.crawler = { x: 5, y: 0 };
    const button = engine.commands(world).find((c) => c.label.startsWith("Cast Hot Take"));
    expect(button).toMatchObject({ label: "Cast Hot Take (2 MP)", input: "cast hot take at", targets: ["g1"], ap: 1 });
  });
});

describe("out of a fight", () => {
  it("Flashlight App turns up what's hidden in the room", () => {
    const world = exploring(["flashlight_app"]);
    const floor = world.game.floor!;
    const room = floor.rooms[floor.currentRoom]!;
    room.hidden = [itemFromRef(content, "duct_tape")];
    const { world: w } = engine.step(world, { type: "cast", spell: "flashlight app" });
    const r = w.game.floor!.rooms[floor.currentRoom]!;
    expect(r.hidden).toBeUndefined();
    expect(r.items!.some((i) => i.baseId === "duct_tape")).toBe(true);
    expect(w.game.crawler!.mp).toBe(17);
    expect(w.game.crawler!.skills.utility_magic!.xp).toBe(1);
  });

  it("Bad Feeling spots the next trap for you", () => {
    const world = exploring(["bad_feeling"]);
    let { world: w } = engine.step(world, { type: "cast", spell: "bad feeling" });
    expect(w.game.crawler!.statuses).toMatchObject([{ id: "trap_sense", remaining: 6 }]);
    const floor = w.game.floor!;
    const theme = content.floors.get(floor.theme);
    const room = floor.rooms.find((r) => r.id !== floor.currentRoom)!;
    room.trap = theme.trapTypes[0]!.id;
    const hp = w.game.crawler!.hp;
    const ctx = new StepContext(w, content);
    springTrap(ctx, room);
    expect(ctx.events.some((e) => e.type === "narration" && e.text.includes("Your bad feeling"))).toBe(true);
    expect(ctx.events.some((e) => e.type === "check")).toBe(false);
    expect(w.game.crawler!.hp).toBe(hp);
  });

  it("damage spells wait for a fight; heals refuse at full HP", () => {
    const world = exploring(["grease_fire", "patch_notes"]);
    world.game.crawler!.hp = derive(world.game.crawler!, content).maxHP;
    let { events } = engine.step(world, { type: "cast", spell: "grease fire" });
    expect(of(events, "error")[0]!.text).toContain("Nothing here is hostile");
    ({ events } = engine.step(world, { type: "cast", spell: "patch notes" }));
    expect(of(events, "error")[0]!.text).toContain("already at full HP");
  });
});

describe("parser", () => {
  it("reads cast, c and read", () => {
    const { world } = engine.newWorld();
    expect(parseCommand("cast grease fire at d4", world)).toEqual({ ok: true, action: { type: "cast", spell: "grease fire", at: "d4" } });
    expect(parseCommand("c hot take", world)).toEqual({ ok: true, action: { type: "cast", spell: "hot take" } });
    expect(parseCommand("cast molasses on the rat", world)).toEqual({ ok: true, action: { type: "cast", spell: "molasses", at: "the rat" } });
    expect(parseCommand("read tome of overdraft", world)).toEqual({ ok: true, action: { type: "use", item: "tome of overdraft" } });
    expect(parseCommand("read scroll of grease fire at c3", world)).toEqual({ ok: true, action: { type: "use", item: "scroll of grease fire", at: "c3" } });
  });
});
