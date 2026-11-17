import { afterEach, describe, expect, it } from "vitest";
import { forceDice, resetRng } from "../src/rng";
import { addPower, describePower, guardShift, powerRoll, stepPower, tierOf } from "../src/rules/power";
import { turnAp } from "../src/rules/ap";
import { content } from "./helpers";

afterEach(() => resetRng());

describe("power rolls", () => {
  it("tiers: 11 or less, 12 to 16, 17 and up", () => {
    expect([2, 11].map(tierOf)).toEqual([1, 1]);
    expect([12, 16].map(tierOf)).toEqual([2, 2]);
    expect([17, 30].map(tierOf)).toEqual([3, 3]);
  });

  it("adds the bonus to 2d10", () => {
    forceDice(4, 7);
    const r = powerRoll(3);
    expect(r).toMatchObject({ dice: [4, 7], natural: 11, total: 14, tier: 2, crit: false });
    expect(describePower(r)).toBe("2d10(4+7)+3 = 14");
  });

  it("a natural 19 or 20 is a crit and tier 3 whatever the total", () => {
    forceDice(10, 9);
    expect(powerRoll(-10)).toMatchObject({ total: 9, tier: 3, crit: true });
    forceDice(9, 9);
    expect(powerRoll(0)).toMatchObject({ tier: 3, crit: false });
  });

  it("edges and banes are worth 2 each, cancel out, and cap at two", () => {
    forceDice(5, 5);
    expect(powerRoll(0, 1, 0).total).toBe(12);
    forceDice(5, 5);
    expect(powerRoll(0, 0, 1).total).toBe(8);
    forceDice(5, 5);
    expect(powerRoll(0, 2, 1).total).toBe(12);
    forceDice(5, 5);
    const capped = powerRoll(0, 5, 0);
    expect(capped.total).toBe(14);
    expect(describePower(capped)).toBe("2d10(5+5), double edge = 14");
  });

  it("guard turns into banes for the attacker (or edges, when it's negative)", () => {
    expect(guardShift(4)).toEqual({ edges: 0, banes: 2 });
    expect(guardShift(2)).toEqual({ edges: 0, banes: 1 });
    expect(guardShift(1)).toEqual({ edges: 0, banes: 0 });
    expect(guardShift(-3)).toEqual({ edges: 1, banes: 0 });
  });

  it("crafting math: a flat bonus lifts every tier, a step lifts the good ones", () => {
    expect(addPower([2, 4, 6], 1)).toEqual([3, 5, 7]);
    expect(addPower([1, 1, 2], -3)).toEqual([1, 1, 1]);
    expect(stepPower([2, 4, 6], 1)).toEqual([2, 5, 8]);
  });

  it("every weapon and enemy attack in the content has non-decreasing tiers of at least 1", () => {
    const powers = [
      ...content.items.bases.all.flatMap((b) => (b.power ? [b.power] : [])),
      ...content.enemies.all.flatMap((e) => e.attacks.map((a) => a.power)),
    ];
    expect(powers.length).toBeGreaterThan(200);
    for (const p of powers) {
      expect(p[0]).toBeGreaterThanOrEqual(1);
      expect(p[0]).toBeLessThanOrEqual(p[1]);
      expect(p[1]).toBeLessThanOrEqual(p[2]);
    }
  });
});

describe("action points", () => {
  it("3 a turn, 4 hasted, 2 slowed, never below 1", () => {
    expect(turnAp([], content)).toBe(3);
    expect(turnAp([{ id: "hasted", remaining: 1, stacks: 1 }], content)).toBe(4);
    expect(turnAp([{ id: "slowed", remaining: 1, stacks: 1 }], content)).toBe(2);
    expect(turnAp([{ id: "slowed", remaining: 1, stacks: 1 }], content, 1)).toBe(1);
  });
});
