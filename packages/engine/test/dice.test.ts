import { afterEach, describe, expect, it } from "vitest";
import {
  addToDice, diceAverage, diceRange, forceDice, formatDice, isDice, multiplyDice, parseDice, resetRng, rollDice,
} from "../src";

afterEach(() => resetRng());

describe("parseDice", () => {
  it.each([
    ["d20", { terms: [{ count: 1, sides: 20, sign: 1 }], modifier: 0 }],
    ["2d6+1", { terms: [{ count: 2, sides: 6, sign: 1 }], modifier: 1 }],
    ["1d8 + 1d4 - 2", { terms: [{ count: 1, sides: 8, sign: 1 }, { count: 1, sides: 4, sign: 1 }], modifier: -2 }],
    ["3D4", { terms: [{ count: 3, sides: 4, sign: 1 }], modifier: 0 }],
    ["5", { terms: [], modifier: 5 }],
    ["-1d4+3", { terms: [{ count: 1, sides: 4, sign: -1 }], modifier: 3 }],
  ])("parses %s", (expr, expected) => {
    const p = parseDice(expr);
    expect(p.terms).toEqual(expected.terms);
    expect(p.modifier).toBe(expected.modifier);
  });

  it.each(["", "2d", "d", "2x6", "1d6+", "+1d6", "0d6", "1d0", "1d6++2", "abc"])("rejects %j", (expr) => {
    expect(isDice(expr)).toBe(false);
  });
});

describe("rollDice", () => {
  it.each(["d20", "1d4", "2d6+1", "3d8-2", "1d8+1d4+3", "4d10"])("stays within range for %s over 2000 rolls", (expr) => {
    const { min, max } = diceRange(expr);
    let seenMin = Infinity;
    let seenMax = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const r = rollDice(expr);
      expect(r.total).toBeGreaterThanOrEqual(min);
      expect(r.total).toBeLessThanOrEqual(max);
      seenMin = Math.min(seenMin, r.total);
      seenMax = Math.max(seenMax, r.total);
    }
    // With 2000 rolls we should hit the extremes of small dice pools.
    if (parseDice(expr).terms.reduce((n, t) => n + t.count, 0) <= 2) {
      expect(seenMin).toBe(min);
      expect(seenMax).toBe(max);
    }
  });

  it("uses forced dice in order", () => {
    forceDice(3, 5);
    const r = rollDice("2d6+1");
    expect(r.rolls.map((d) => d.value)).toEqual([3, 5]);
    expect(r.total).toBe(9);
  });

  it("subtracts negative dice terms", () => {
    forceDice(6, 2);
    expect(rollDice("1d6-1d4").total).toBe(4);
  });

  it("rejects forced values that don't fit the die", () => {
    forceDice(7);
    expect(() => rollDice("1d6")).toThrow();
  });
});

describe("dice helpers", () => {
  it("computes range and average", () => {
    expect(diceRange("2d6+1")).toEqual({ min: 3, max: 13 });
    expect(diceAverage("2d6+1")).toBe(8);
    expect(diceRange("1d6-1d4")).toEqual({ min: -3, max: 5 });
  });

  it("formats and transforms", () => {
    expect(formatDice(parseDice("2d6 + 1"))).toBe("2d6+1");
    expect(addToDice("1d8", 3)).toBe("1d8+3");
    expect(addToDice("1d8+2", -2)).toBe("1d8");
    expect(multiplyDice("2d6+1", 2)).toBe("4d6+1");
  });
});
