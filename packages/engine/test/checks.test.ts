import { afterEach, describe, expect, it } from "vitest";
import { DC_TIERS, dcFor, forceDice, judge, pendingForcedDice, resetRng, resolveCheck, resolveOpposed } from "../src";

afterEach(() => resetRng());

describe("dcFor", () => {
  it("is tier + 2 * (floor - 1)", () => {
    expect(dcFor("trivial", 1)).toBe(10);
    expect(dcFor("medium", 1)).toBe(20);
    expect(dcFor("medium", 3)).toBe(24);
    expect(dcFor("absurd", 10)).toBe(53);
    for (const [tier, base] of Object.entries(DC_TIERS)) {
      expect(dcFor(tier as keyof typeof DC_TIERS, 5)).toBe(base + 8);
    }
  });

  it("treats floors below 1 as floor 1", () => {
    expect(dcFor("easy", 0)).toBe(15);
  });
});

describe("resolveCheck", () => {
  const check = (natural: number, modifier: number, dc: number) => {
    forceDice(natural);
    const r = resolveCheck({ label: "test", modifier, dc });
    expect(pendingForcedDice()).toBe(0);
    return r;
  };

  it("succeeds when total meets or beats DC", () => {
    expect(check(10, 5, 15).success).toBe(true);
    expect(check(10, 4, 15).success).toBe(false);
  });

  it("natural 20 always succeeds", () => {
    const r = check(20, -50, 99);
    expect(r.success).toBe(true);
    expect(r.outcome).toBe("success");
  });

  it("natural 1 always fails", () => {
    const r = check(1, 100, 10);
    expect(r.success).toBe(false);
    expect(r.outcome).toBe("failure");
  });

  it("beat DC by 10+ is a critical success", () => {
    expect(check(15, 5, 10).outcome).toBe("critSuccess"); // margin 10
    expect(check(14, 5, 10).outcome).toBe("success"); // margin 9
  });

  it("miss DC by 10+ is a critical failure", () => {
    expect(check(5, 0, 15).outcome).toBe("critFailure"); // margin -10
    expect(check(6, 0, 15).outcome).toBe("failure"); // margin -9
  });

  it("natural 1 that also misses by 10+ is a critical failure", () => {
    expect(check(1, 0, 20).outcome).toBe("critFailure");
  });

  it("natural 20 that also beats by 10+ is a critical success", () => {
    expect(check(20, 0, 10).outcome).toBe("critSuccess");
  });

  it("reports total and margin", () => {
    const r = check(12, 7, 15);
    expect(r.total).toBe(19);
    expect(r.margin).toBe(4);
  });
});

describe("judge", () => {
  it("matches resolveCheck rules without rolling", () => {
    expect(judge(20, 0, 50)).toMatchObject({ success: true });
    expect(judge(1, 50, 10)).toMatchObject({ success: false });
  });
});

describe("resolveOpposed", () => {
  it("higher total wins", () => {
    forceDice(15, 10);
    expect(resolveOpposed({ label: "sneak", modifier: 2 }, { label: "spot", modifier: 2 }).winner).toBe("attacker");
  });

  it("ties go to the defender", () => {
    forceDice(10, 12);
    const r = resolveOpposed({ label: "sneak", modifier: 5 }, { label: "spot", modifier: 3 });
    expect(r.attacker.total).toBe(r.defender.total);
    expect(r.winner).toBe("defender");
  });
});
