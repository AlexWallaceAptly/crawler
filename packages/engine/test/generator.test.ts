/**
 * Milestone 5: the item generator (base + material + rarity + affixes), the effects
 * generated gear carries, drops, consumable potency, and the equipping numbers
 * (gear.ts) that tell a player what a weapon or a piece of armor does for them.
 */
import { afterEach, describe, expect, it } from "vitest";
import { content, engine, gridWorld, lines, testEnemy } from "./helpers";
import { forceDice, resetRng, setRandomSource } from "../src/rng";
import { affixFactor, gearFamily, generateItem, itemLevelFor, levelFactor, potencyFor, rollRarity, scalePower } from "../src/gen/item";
import { knownTarget } from "../src/rules/modifiers";
import { derive, modTotal } from "../src/rules/derived";
import { equip } from "../src/inventory";
import { gearChanges, profileOf, swingNumbers, verdictOf, weaponFit, withEquipped } from "../src/gear";
import { tierOdds } from "../src/rules/power";
import { StepContext } from "../src/step";
import { applyItemEffects, checkVictory } from "../src/combat";
import { itemFromRef } from "../src/gen/item";
import { RARITIES, STATS } from "../src/content/schemas";
import type { Crawler, ItemInstance, World } from "../src/state";

afterEach(() => resetRng());

function fresh(): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  return world;
}

/** A crawler with nothing on, so an item's effect is the only change. */
function bare(world: World): Crawler {
  const c = world.game.crawler!;
  c.equipment = {};
  c.statuses = [];
  return c;
}

describe("the generator", () => {
  it("1,000 generated items are all valid", () => {
    const rank = (r: string) => RARITIES.indexOf(r as never);
    for (let i = 0; i < 1000; i++) {
      const floor = 1 + (i % 3);
      const level = itemLevelFor(floor);
      const it = generateItem(content, level, { floor });
      const base = content.items.bases.get(it.baseId);
      const rule = content.items.rarities.get(it.rarity);
      expect(base.generate, it.baseId).toBe(true);
      expect(it.kind).toBe("gear");
      expect(it.name.length).toBeGreaterThan(0);
      expect(it.name).toContain(base.name);
      expect(it.itemLevel).toBe(level);
      expect(base.minLevel).toBeLessThanOrEqual(level);
      if (it.material) {
        const m = content.items.materials.get(it.material);
        expect(m.kind).toBe(base.material);
        expect(m.minLevel).toBeLessThanOrEqual(level);
        expect(it.name).toContain(m.name);
      }
      if (base.power) {
        const p = it.power!;
        expect(p[0]).toBeGreaterThanOrEqual(1);
        expect(p[1]).toBeGreaterThanOrEqual(p[0]);
        expect(p[2]).toBeGreaterThanOrEqual(p[1]);
      }
      if (base.armor) expect(it.armor).toBeGreaterThanOrEqual(1);
      // Affixes: as many as the rarity says (unless the pool ran dry), one per group, one suffix at most.
      const affixes = it.affixes ?? [];
      expect(affixes.length).toBeLessThanOrEqual(rule.affixes);
      const defs = affixes.map((a) => content.items.affixes.get(a.id));
      expect(new Set(defs.map((a) => a.group)).size).toBe(defs.length);
      expect(defs.filter((a) => a.kind === "suffix").length).toBeLessThanOrEqual(1);
      for (const a of defs) expect(a.minLevel).toBeLessThanOrEqual(level);
      for (const m of it.modifiers) expect(knownTarget(m.to, content) || !m.note, `${it.name}: ${m.to}`).toBe(true);
      if (it.onHit) expect(content.statusEffects.has(it.onHit.id)).toBe(true);
      expect(!!it.legendary).toBe(rule.legendaryPower && content.items.legendaryPowers.all.some((p) => p.slots.some((s) => s === "any" || s === gearFamily(base) || s === base.slot)));
      if (rank(it.rarity) >= rank("rare")) expect(it.flavor).toBeTruthy();
      expect(it.value).toBeGreaterThanOrEqual(0);
      expect(JSON.parse(JSON.stringify(it))).toEqual(it); // saves to localStorage as-is
    }
  });

  it("covers every slot, and a slot override sticks", () => {
    const slots = new Set(content.items.bases.all.filter((b) => b.generate).map((b) => b.slot));
    for (const s of ["mainHand", "offHand", "head", "eyes", "chest", "legs", "feet", "hands", "neck", "ring", "back", "belt"] as const) {
      expect(slots.has(s), s).toBe(true);
      for (let i = 0; i < 20; i++) expect(generateItem(content, 15, { slot: s }).slot).toBe(s);
    }
    expect(content.items.bases.all.filter((b) => b.generate).length).toBeGreaterThanOrEqual(50);
    expect(content.items.affixes.all.length).toBeGreaterThanOrEqual(60);
  });

  it("names read [prefixes] [material] base [of suffix]", () => {
    for (let i = 0; i < 200; i++) {
      const it = generateItem(content, 15, { rarity: "epic" });
      const base = content.items.bases.get(it.baseId);
      const material = it.material ? content.items.materials.get(it.material).name : "";
      const pre = (it.affixes ?? []).filter((a) => a.kind === "prefix").map((a) => a.name);
      const suf = (it.affixes ?? []).find((a) => a.kind === "suffix")?.name;
      expect(it.name).toBe([...pre, material, base.name, suf].filter(Boolean).join(" "));
    }
  });

  it("rarity follows the floor's weights: no legendaries on Floor 1, and a minimum is a minimum", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const r = rollRarity(content, 1);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    expect(counts.legendary ?? 0).toBe(0);
    expect(counts.common!).toBeGreaterThan(counts.uncommon!);
    for (let i = 0; i < 200; i++) expect(["rare", "epic", "legendary"]).toContain(rollRarity(content, 3, "rare"));
    expect(rollRarity(content, 1, "legendary")).toBe("legendary"); // weight 0 on Floor 1, but asked for
    expect(rollRarity(content, 9)).toBeDefined(); // deeper floors use the last row
  });

  it("power scales with material, rarity and level; armor only with material", () => {
    expect(scalePower([2, 3, 4], 1)).toEqual([2, 3, 4]);
    expect(scalePower([2, 3, 4], 1.5)).toEqual([3, 5, 6]);
    expect(scalePower([1, 1, 1], 0.4)).toEqual([1, 1, 1]);
    expect(levelFactor(5)).toBe(1);
    expect(levelFactor(15)).toBeCloseTo(1.4);
    expect(affixFactor(3)).toBe(1);
    setRandomSource(() => 0.5);
    const common = generateItem(content, 5, { slot: "chest", rarity: "common" });
    const epic = generateItem(content, 5, { slot: "chest", rarity: "epic" });
    resetRng();
    expect(common.baseId).toBe(epic.baseId);
    expect(epic.armor).toBe(common.armor); // rarity adds affixes, not armor
  });

  it("legendaries carry one unique power", () => {
    for (let i = 0; i < 50; i++) {
      const it = generateItem(content, 15, { rarity: "legendary", slot: "mainHand" });
      expect(it.legendary).toBeDefined();
      expect(content.items.legendaryPowers.get(it.legendary!.id).slots).toEqual(expect.arrayContaining(["weapon"]));
    }
  });
});

describe("equipping changes derived stats", () => {
  it("every generated piece moves stats, armor and max HP by exactly what it carries", () => {
    const world = fresh();
    for (let i = 0; i < 300; i++) {
      const c = bare(world);
      const it = generateItem(content, itemLevelFor(1 + (i % 3)));
      c.inventory = [it];
      const before = derive(c, content);
      equip(c, it);
      const after = derive(c, content);
      for (const s of STATS) expect(after.stats[s] - before.stats[s], `${it.name} ${s}`).toBe(modTotal(it.modifiers, `stat:${s}`));
      expect(after.armor - before.armor).toBe((it.armor ?? 0) + modTotal(it.modifiers, "damageReduction"));
      const con = after.stats.CON - before.stats.CON;
      expect(after.maxHP - before.maxHP).toBe(3 * con + modTotal(it.modifiers, "maxHP"));
      expect(after.carryLimit - before.carryLimit).toBe(4 * (after.stats.STR - before.stats.STR) + modTotal(it.modifiers, "carry"));
    }
  });

  it("`equip` says what changed", () => {
    const world = fresh();
    const c = bare(world);
    const vest = itemFromRef(content, "padded_jacket");
    c.inventory = [vest];
    const { events } = engine.input(world, "equip padded jacket");
    const said = events.filter((e) => e.type === "narration").map((e) => (e as { text: string }).text).join(" ");
    expect(said).toContain("Armor 0 → 1");
  });
});

describe("what gear tells you", () => {
  it("the swing numbers are the ones combat rolls with", () => {
    const world = fresh();
    const c = bare(world);
    c.baseStats = { STR: 6, DEX: 9, CON: 6, INT: 4, CHA: 4 };
    c.skills = { blades: { rank: 1, xp: 0 } };
    const knife = itemFromRef(content, "combat_knife");
    c.inventory = [knife];
    equip(c, knife);
    const sw = swingNumbers(c, content, profileOf(content, knife));
    expect(sw.stat).toBe("DEX");
    expect(sw.statBonus).toBe(4);
    expect(sw.rollBonus).toBe(5); // DEX 9 → +4, Blades rank 1
    expect(sw.flat).toBe(4); // floor(9 * 2 / 4)
    expect(sw.damage).toEqual([6, 7, 8]); // 2/3/4 + 4
    const odds = tierOdds(5);
    expect(sw.odds).toEqual(odds);
    expect(odds[0] + odds[1] + odds[2]).toBeCloseTo(1);
  });

  it("compares a weapon on the floor with the one in your hand, and calls it better or worse", () => {
    const world = fresh();
    const c = bare(world);
    c.baseStats = { STR: 4, DEX: 10, CON: 6, INT: 4, CHA: 4 };
    const club = itemFromRef(content, "club");
    const machete = itemFromRef(content, "machete");
    c.inventory = [club];
    equip(c, club);
    const changes = gearChanges(c, withEquipped(c, machete), content);
    expect(changes.find((ch) => ch.label === "Average hit")?.better).toBe(1); // DEX 10 beats STR 4
    expect(verdictOf(changes)).toBe("better");
    expect(weaponFit(c, content).stat).toBe("DEX");
    const view = engine.view(world);
    expect(view.character!.fighting.weapon).toBe("Club");
    expect(view.character!.fighting.fit).toContain("DEX");
  });

  it("inventory rows say better / worse, and the detail says what equipping would change", () => {
    const world = fresh();
    const c = bare(world);
    const jacket = itemFromRef(content, "padded_jacket");
    c.inventory = [jacket];
    const row = engine.view(world).inventory[0]!;
    expect(row.verdict).toBe("better");
    expect(row.summary).toBe("armor 1");
    expect(row.detail.some((d) => d.startsWith("If you equip it: Armor 0 → 1"))).toBe(true);
  });
});

describe("generated effects in a fight", () => {
  const swingWith = (mods: { to: string; value: number }[], dice: number[], enemy = testEnemy()) => {
    const world = gridWorld(["@a......"], [enemy]);
    const c = world.game.crawler!;
    c.inventory[0]!.modifiers = mods;
    forceDice(...dice);
    const r = engine.step(world, { type: "attack", target: "test rat" });
    resetRng();
    return r;
  };

  it("leech heals you for part of the damage", () => {
    const world = gridWorld(["@a......"], [testEnemy({ hp: 40, maxHP: 40 })]);
    const c = world.game.crawler!;
    c.inventory[0]!.modifiers = [{ to: "leech", value: 50 }];
    c.hp = 10;
    forceDice(5, 5);
    const r = engine.step(world, { type: "attack", target: "test rat" });
    resetRng();
    expect(r.world.game.crawler!.hp).toBeGreaterThan(10);
    expect(lines(r.events)).toContain("drinks");
  });

  it("a lower crit range crits on lower dice", () => {
    const r = swingWith([{ to: "critRange", value: 2 }], [9, 8], testEnemy({ hp: 99, maxHP: 99 }));
    expect(lines(r.events)).toContain("CRIT");
  });

  it("a kill hands AP back with Momentum", () => {
    const world = gridWorld(["@ab....."], [testEnemy({ hp: 1, maxHP: 1 }), testEnemy({ name: "Other Rat" })]);
    world.game.crawler!.inventory[0]!.modifiers = [{ to: "killAp", value: 1 }];
    forceDice(5, 5);
    const r = engine.step(world, { type: "attack", target: "test rat" });
    resetRng();
    expect(lines(r.events)).toContain("AP back");
  });

  it("thorns bite back at melee attackers", () => {
    const world = gridWorld(["@a......"], [testEnemy({ hp: 20, maxHP: 20, initiative: 99 })]);
    world.game.crawler!.inventory[0]!.modifiers = [{ to: "thorns", value: 3 }];
    world.game.combat!.playerInitiative = 1;
    forceDice(5, 5, 5, 5, 5, 5);
    const r = engine.step(world, { type: "wait" });
    resetRng();
    expect(lines(r.events)).toContain("bites back");
  });

  it("second wind fires once a fight", () => {
    const world = gridWorld(["@a......"], [testEnemy({ hp: 20, maxHP: 20, attacks: [{ name: "Maul", power: [9, 9, 9], damageType: "physical", stat: "STR", range: "close", ready: 0 }] })]);
    const c = world.game.crawler!;
    c.inventory[0]!.modifiers = [{ to: "secondWind", value: 25 }];
    c.hp = 12;
    world.game.combat!.playerInitiative = 1;
    forceDice(5, 5, 5, 5);
    const r = engine.step(world, { type: "wait" });
    resetRng();
    expect(lines(r.events)).toContain("Second wind");
    expect(r.world.game.combat?.used ?? []).toContain("secondWind");
  });
});

describe("drops and potency", () => {
  it("a killed elite can drop generated gear into the room", () => {
    const world = gridWorld(["@a......"], [testEnemy({ hp: 0, tier: "elite" })]);
    const ctx = new StepContext(world, content);
    const floor = world.game.floor!;
    const room = floor.rooms[floor.currentRoom]!;
    const before = (room.items ?? []).length;
    setRandomSource(() => 0.01); // every drop roll succeeds
    checkVictory(ctx);
    resetRng();
    expect((room.items ?? []).length).toBe(before + 1);
    expect(room.items!.some((i) => i.itemLevel !== undefined)).toBe(true);
  });

  it("scaling consumables get stronger a quarter per floor", () => {
    expect(potencyFor(1)).toBe(1);
    expect(potencyFor(3)).toBe(1.5);
    const world = fresh();
    const c = world.game.crawler!;
    c.hp = 1;
    world.game.floor!.floor = 3;
    const ctx = new StepContext(world, content);
    forceDice(1, 1);
    const out = applyItemEffects(ctx, content.items.consumables.get("healing_potion"), { area: [] });
    resetRng();
    expect(out[0]).toBe("+9 HP"); // (1+1+4) × 1.5
  });

  it("floors seed generated gear: treasure rooms show theirs", () => {
    let found = 0;
    for (let i = 0; i < 10; i++) {
      const world = fresh();
      for (const r of world.game.floor!.rooms) {
        found += [...(r.items ?? []), ...(r.hidden ?? [])].filter((it: ItemInstance) => it.itemLevel !== undefined).length;
        if (r.type === "treasure") expect((r.items ?? []).some((it) => it.itemLevel !== undefined)).toBe(true);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
