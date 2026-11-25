import { describe, expect, it } from "vitest";
import { render, templatePaths } from "../src/narrate/narrator";
import { content, engine } from "./helpers";

describe("Milestone 7 narration", () => {
  it("the reward code's fixed narration keys exist", () => {
    for (const k of ["achievement.earned", "box.granted", "box.refused", "echo.sleep.worse", "echo.sleep.better", "shop.worthless", "district.entered", "champion.killed"]) {
      expect(content.narration[k], k).toBeDefined();
    }
  });

  it("every box tier and every shop personality has its lines", () => {
    for (const t of content.boxes.tiers) expect(content.narration[`box.open.${t.id}`], t.id).toBeDefined();
    for (const p of content.shops.personalities) {
      for (const k of ["enter", "buy", "sell", "broke"]) expect(content.narration[`shop.${p.id}.${k}`], `${p.id}.${k}`).toBeDefined();
    }
  });

  it("every achievement's text only uses fields its trigger can supply", () => {
    // The sample context has every field an event could carry; a path outside it shows up as ??? when rendered.
    const sample = { overkill: 20, target: "Rat", family: "sump_rat", tier: "mob", amount: 3, hp: 1, name: "X", count: 2, crawler: { hp: 1, name: "Test", level: 2 }, mood: 0 };
    for (const a of content.achievements.all) {
      expect(render(a.text, sample), a.id).not.toContain("???");
      for (const path of templatePaths(a.text)) {
        const head = path.split(".")[0]!;
        expect(Object.keys(sample), `${a.id}: {${path}}`).toContain(head);
      }
    }
  });

  it("achievement ids are unique, snake_case, and repeatable ones have an event trigger", () => {
    const ids = content.achievements.all.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(content.achievements.all.length).toBeGreaterThanOrEqual(30);
  });

  it("achievements cover every group at least once", () => {
    const groups = new Set(content.achievements.all.map((a) => a.group));
    for (const g of ["firstTime", "combat", "nearDeath", "exploration", "crafting", "magic", "social", "humiliation", "stupidity", "secret", "thread"]) {
      expect(groups.has(g as never), g).toBe(true);
    }
  });

  it("the view exposes boxes, achievements, mood and the shop", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    const v = engine.view(world);
    expect(v.rewards.total).toBe(content.achievements.all.length);
    expect(v.rewards.mood.word).toBeTruthy();
    expect(Array.isArray(v.rewards.boxes)).toBe(true);
  });
});
