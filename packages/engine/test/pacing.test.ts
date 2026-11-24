import { describe, expect, it } from "vitest";
import { content, engine } from "./helpers";
import { actionMinutes, sleepStage, sleepStageAt } from "../src/rules/sleep";
import { derive } from "../src/rules/derived";
import { resetRng } from "../src/rng";

function freshRun() {
  resetRng();
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  return world;
}

describe("sleep deprivation", () => {
  it("stages come from pacing.json by hours awake", () => {
    expect(sleepStageAt(content, 0).id).toBe("rested");
    expect(sleepStageAt(content, 16).id).toBe("tired");
    expect(sleepStageAt(content, 30).id).toBe("exhausted");
    expect(sleepStageAt(content, 41).id).toBe("delirious");
  });

  it("every action that costs time ages the crawler, and the stage hits the numbers", () => {
    const w = freshRun();
    const c = w.game.crawler!;
    const base = derive(c, content);
    expect(c.awakeMin ?? 0).toBeGreaterThanOrEqual(0);
    c.awakeMin = 41 * 60;
    expect(sleepStage(c, content).id).toBe("delirious");
    const tired = derive(c, content);
    expect(tired.guard).toBeLessThan(base.guard);
    expect(actionMinutes(c, content, 20)).toBe(25);
    const before = c.awakeMin;
    const next = engine.step(w, { type: "search" }).world;
    expect(next.game.crawler!.awakeMin).toBeGreaterThan(before);
  });

  it("time is booked by reason through the one clock", () => {
    const w = freshRun();
    const out = engine.step(w, { type: "search" }).world;
    expect(out.game.timeSpent?.search).toBeGreaterThan(0);
    const total = Object.values(out.game.timeSpent ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBe(out.game.clock);
  });
});
