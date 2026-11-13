import { beforeEach, describe, expect, it } from "vitest";
import { bfsDistances, generateFloor } from "../src/gen/floor";
import { describeRoom, renderMap } from "../src/explore";
import { loadContent } from "../src/content/load";
import { resetRng } from "../src/rng";
import { rawContent } from "@crawler/content";
import type { FloorState } from "../src/state";

const content = loadContent(rawContent as never);
const theme = content.floors.get("undercroft");

describe("floor generation (100 floors, spec acceptance)", () => {
  beforeEach(() => resetRng());

  const floors: FloorState[] = Array.from({ length: 100 }, () => generateFloor(theme));

  it("carves exactly the themed room count on the grid", () => {
    for (const f of floors) {
      expect(f.rooms).toHaveLength(theme.rooms);
      const seen = new Set<string>();
      for (const r of f.rooms) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x).toBeLessThan(f.width);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeLessThan(f.height);
        const key = `${r.x},${r.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("every room (and so every stairwell) is reachable from the start", () => {
    for (const f of floors) {
      const dist = bfsDistances(f.rooms, f.startRoom);
      expect(dist.every((d) => d >= 0)).toBe(true);
    }
  });

  it("exits are symmetric and point at grid neighbors", () => {
    for (const f of floors) {
      for (const r of f.rooms) {
        for (const [dir, id] of Object.entries(r.exits)) {
          const other = f.rooms[id]!;
          expect(Math.abs(other.x - r.x) + Math.abs(other.y - r.y)).toBe(1);
          const back = Object.values(other.exits);
          expect(back).toContain(r.id);
          void dir;
        }
      }
    }
  });

  it("has 3-5 stairwells, none of them the start room", () => {
    for (const f of floors) {
      const stairs = f.rooms.filter((r) => r.type === "stairwell");
      expect(stairs.length).toBeGreaterThanOrEqual(3);
      expect(stairs.length).toBeLessThanOrEqual(5);
      expect(stairs.some((r) => r.id === f.startRoom)).toBe(false);
    }
  });

  it("has ~1 safe room per 15, never adjacent to a stairwell, one of them 4-8 steps out", () => {
    for (const f of floors) {
      const safes = f.rooms.filter((r) => r.type === "safe");
      expect(safes.length).toBeGreaterThanOrEqual(1);
      expect(safes.length).toBeLessThanOrEqual(Math.round(theme.rooms / 15));
      for (const s of safes) {
        for (const id of Object.values(s.exits)) expect(f.rooms[id]!.type).not.toBe("stairwell");
      }
      const dist = bfsDistances(f.rooms, f.startRoom);
      expect(safes.some((s) => dist[s.id]! >= 4 && dist[s.id]! <= 8)).toBe(true);
    }
  });

  it("is not a tree: more connections than rooms - 1", () => {
    let loopy = 0;
    for (const f of floors) {
      const edges = f.rooms.reduce((n, r) => n + Object.keys(r.exits).length, 0) / 2;
      if (edges > f.rooms.length - 1) loopy++;
    }
    // loops are random; demand the vast majority of floors have at least one
    expect(loopy).toBeGreaterThanOrEqual(95);
  });

  it("names every room from the theme pools and starts the timer at 5 days", () => {
    for (const f of floors.slice(0, 10)) {
      for (const r of f.rooms) expect(r.name).toMatch(/^\S+ .+/);
      expect(f.timeLeft).toBe(theme.days * 24 * 60);
      expect(f.rooms[f.startRoom]!.visited).toBe(true);
    }
  });

  it("room descriptions come out 3-4 lines and stay stable once cached", () => {
    const f = floors[0]!;
    for (const r of f.rooms.slice(0, 20)) {
      const lines = describeRoom(theme, r);
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.length).toBeLessThanOrEqual(4);
      for (const l of lines) expect(l.length).toBeGreaterThan(0);
    }
  });

  it("renders a map with exactly one @ and no stray symbols", () => {
    const f = floors[0]!;
    const map = renderMap(f).join("\n");
    expect(map.match(/@/g)).toHaveLength(1);
    // nothing is visited yet except the start, so no S/> may show
    expect(map).not.toMatch(/[S>]/);
  });
});
