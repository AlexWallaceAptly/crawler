import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import { loadContent } from "../src/content/load";
import { assignMarks, generateEnemy, generateGroup } from "../src/gen/enemy";
import { resetRng, setRandomSource } from "../src/rng";
import { StepContext } from "../src/step";
import { startCombat } from "../src/combat";
import { rawContent } from "@crawler/content";

const content = loadContent(rawContent as never);
const engine = createEngine(content);

afterEach(() => resetRng());

describe("encounter packs (milestone 4b)", () => {
  it("ordinary fights are 2-4 bodies from at most two families: minions, sometimes led by one mob", () => {
    let led = 0;
    for (let i = 0; i < 1000; i++) {
      const pack = generateGroup(1, "pack", content);
      expect(pack.length).toBeGreaterThanOrEqual(2);
      expect(pack.length).toBeLessThanOrEqual(4);
      const mobs = pack.filter((e) => e.tier === "mob");
      expect(mobs.length).toBeLessThanOrEqual(1);
      expect(pack.every((e) => e.tier === "minion" || e.tier === "mob")).toBe(true);
      expect(new Set(pack.map((e) => e.familyId)).size).toBeLessThanOrEqual(2);
      if (mobs.length) led++;
    }
    expect(led).toBeGreaterThan(30);
    expect(led).toBeLessThan(400);
  });

  it("easy fights are 1-2 minions of one easy-pool family, a level down", () => {
    const enc = content.floors.all.find((t) => t.floor === 1)!.encounters;
    expect(enc.easyPool.length).toBeGreaterThan(0);
    let easyLevels = 0;
    let hardLevels = 0;
    const n = 500;
    for (let i = 0; i < n; i++) {
      const pack = generateGroup(1, i % 2 ? "pack" : "corridor", content, { easy: true });
      expect(pack.length).toBeGreaterThanOrEqual(enc.easyPack[0]);
      expect(pack.length).toBeLessThanOrEqual(enc.easyPack[1]);
      expect(pack.every((e) => e.tier === "minion" && enc.easyPool.includes(e.familyId))).toBe(true);
      expect(new Set(pack.map((e) => e.familyId)).size).toBe(1);
      easyLevels += pack[0]!.level;
      hardLevels += generateEnemy(content.enemies.get(pack[0]!.familyId), "minion", 1, content, enc.levelOffset).level;
    }
    expect(easyLevels / n).toBeLessThan(hardLevels / n);
  });

  it("hard fights only roll families from the hard pool; an elite is never easy", () => {
    const enc = content.floors.all.find((t) => t.floor === 1)!.encounters;
    for (let i = 0; i < 300; i++) {
      expect(generateGroup(1, "pack", content).every((e) => enc.hardPool.includes(e.familyId))).toBe(true);
      expect(generateGroup(1, "elite", content, { easy: true })[0]!.tier).toBe("elite");
    }
  });

  it("corridor packs are 2-3", () => {
    for (let i = 0; i < 500; i++) {
      const pack = generateGroup(1, "corridor", content);
      expect(pack.length).toBeGreaterThanOrEqual(2);
      expect(pack.length).toBeLessThanOrEqual(3);
    }
  });

  it("packs mix families some of the time", () => {
    let mixed = 0;
    for (let i = 0; i < 1000; i++) if (new Set(generateGroup(1, "pack", content).map((e) => e.familyId)).size === 2) mixed++;
    expect(mixed).toBeGreaterThan(150);
    expect(mixed).toBeLessThan(900);
  });

  it("elites come alone or with 1-2 minion escorts of their own family", () => {
    let alone = 0;
    for (let i = 0; i < 500; i++) {
      const g = generateGroup(1, "elite", content);
      expect(g.filter((e) => e.tier === "elite")).toHaveLength(1);
      expect(g.length).toBeLessThanOrEqual(3);
      expect(g.slice(1).every((e) => e.tier === "minion" && e.familyId === g[0]!.familyId)).toBe(true);
      if (g.length === 1) alone++;
    }
    expect(alone).toBeGreaterThan(150);
    expect(alone).toBeLessThan(350);
  });

  it("a minion is weaker than a mob of the same family at the same roll", () => {
    setRandomSource(() => 0.5);
    const family = content.enemies.get("gutter_crab");
    const minion = generateEnemy(family, "minion", 1, content);
    const mob = generateEnemy(family, "mob", 1, content);
    expect(minion.level).toBeLessThan(mob.level);
    expect(minion.maxHP).toBeLessThan(mob.maxHP);
    expect(minion.xp).toBeLessThan(mob.xp);
    expect(minion.speed).toBe(family.speed);
  });

  it("a fight is worth about what it was before packs (±35% XP)", () => {
    // Reference: 23.7 average XP per ordinary encounter with the Milestone 4 single-family groups.
    let xp = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) xp += generateGroup(1, "pack", content).reduce((s, e) => s + e.xp, 0);
    const avg = xp / n;
    expect(avg).toBeGreaterThan(23.7 * 0.65);
    expect(avg).toBeLessThan(23.7 * 1.35);
  });

  it("same-named enemies get letters and can be targeted by them", () => {
    const family = content.enemies.get("sump_rat");
    const rats = [0, 1, 2].map(() => generateEnemy(family, "minion", 1, content));
    for (const r of rats) r.name = "Sump Rat";
    assignMarks(rats);
    expect(rats.map((r) => r.name)).toEqual(["Sump Rat A", "Sump Rat B", "Sump Rat C"]);

    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    world.account.settings = { combatMode: "bands" };
    world.game.crawler!.hp = 500;
    const fresh = [0, 1].map(() => generateEnemy(family, "minion", 1, content));
    for (const r of fresh) { r.name = "Sump Rat"; r.hp = r.maxHP = 200; r.initiative = -100; }
    const ctx = new StepContext(world, content);
    startCombat(ctx, fresh);
    const names = ctx.game.combat!.enemies.map((e) => e.name).sort();
    expect(names).toEqual(["Sump Rat A", "Sump Rat B"]);
    const r = engine.input(ctx.world, "attack rat b");
    const line = r.events.find((e) => e.type === "combatLine" && e.actor === "you");
    expect(line && "text" in line ? line.text : "").toContain("Sump Rat B");
  });
});
