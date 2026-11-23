import { describe, expect, it } from "vitest";
import {
  STAT_MAX, STAT_MIN, STATS, createEngine, type FormativeEvent, derive, generateCrawler, generateStats, loadDefaultContent, newAccount,
} from "../src";
import { FREE_REROLLS } from "../src/step";

const content = loadDefaultContent();
const engine = createEngine(content);

describe("generateStats", () => {
  it("keeps every stat within 3..12 for every occupation x event, cycling quirks", () => {
    // The full occupation x event x quirk cube is millions of combos at starter-table sizes,
    // so pair every occupation with every event and rotate through the quirks.
    const b = content.backstory;
    const quirks = b.quirks.all;
    const bad: string[] = [];
    let n = 0;
    for (const occ of b.occupations.all) {
      for (const ev of b.events.all) {
        const q = quirks[n++ % quirks.length]!;
        const s = generateStats(occ, ev, q);
        for (const k of STATS) {
          if (s[k] < STAT_MIN || s[k] > STAT_MAX) bad.push(`${occ.id}/${ev.id}/${q.id} ${k}=${s[k]}`);
        }
      }
    }
    expect(n).toBeGreaterThanOrEqual(quirks.length);
    expect(bad).toEqual([]);
  });

  it("pushes stats toward the occupation's weights", () => {
    const roofer = content.backstory.occupations.get("roofer");
    const debate = content.backstory.occupations.get("debate_coach");
    const neutralEvent: FormativeEvent = { id: "x", phrase: "x", plus: "CON", minus: "CHA", tags: [] };
    const neutralQuirk = content.backstory.quirks.get("cant_swim");
    let rooferStr = 0;
    let debateStr = 0;
    for (let i = 0; i < 500; i++) {
      rooferStr += generateStats(roofer, neutralEvent, neutralQuirk).STR;
      debateStr += generateStats(debate, neutralEvent, neutralQuirk).STR;
    }
    expect(rooferStr / 500).toBeGreaterThan(debateStr / 500 + 1);
  });
});

describe("generateCrawler", () => {
  it("builds a valid level-1 crawler with a starting kit", () => {
    for (let i = 0; i < 300; i++) {
      const c = generateCrawler(content);
      const d = derive(c, content);
      expect(c.level).toBe(1);
      expect(c.hp).toBe(d.maxHP);
      expect(c.mp).toBe(d.maxMP);
      expect(d.maxHP).toBe(10 + 3 * d.stats.CON + 2);
      expect(Object.keys(c.skills)).toHaveLength(1);
      expect(c.inventory.length).toBeGreaterThanOrEqual(3);
      // Every equipped uid points at an inventory item.
      for (const uid of Object.values(c.equipment)) expect(c.inventory.some((it) => it.uid === uid)).toBe(true);
      // Clothing is worn.
      const loc = content.backstory.locations.get(c.backstory.location);
      expect(Object.keys(c.equipment).length).toBeGreaterThanOrEqual(1);
      expect(c.inventory.filter((it) => loc.clothing.includes(it.baseId)).length).toBe(loc.clothing.length);
    }
  });
});

describe("engine: creation flow", () => {
  it("starts a new world in creation with a roast", () => {
    const { world, events } = engine.newWorld();
    expect(world.game.phase).toBe("creation");
    expect(world.game.crawler).not.toBeNull();
    const lines = events.filter((e) => e.type === "narration");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) if (l.type === "narration") expect(l.text).not.toContain("???");
    // The roast is 3-5+ sentences.
    const intro = lines[0]!;
    if (intro.type === "narration") expect(intro.text.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
  });

  it("accept moves to exploring", () => {
    const { world } = engine.newWorld();
    const r = engine.input(world, "accept");
    expect(r.world.game.phase).toBe("exploring");
    expect(r.world.account.runs).toBe(1);
  });

  it("every new crawler gets free rerolls, then the account's own, then none", () => {
    let { world } = engine.newWorld({ ...newAccount(), rerolls: 1 });
    expect(engine.commands(world).some((c) => c.label === `Reroll (${FREE_REROLLS + 1} left)`)).toBe(true);
    for (let i = 0; i < FREE_REROLLS; i++) {
      const before = world.game.crawler!;
      world = engine.input(world, "reroll").world;
      expect(world.game.crawler).not.toEqual(before);
      expect(world.game.phase).toBe("creation");
      expect(world.account.rerolls).toBe(1); // the free ones go first
    }
    world = engine.input(world, "reroll").world;
    expect(world.account.rerolls).toBe(0);
    const last = world.game.crawler!;
    const denied = engine.input(world, "reroll");
    expect(denied.world.game.crawler).toEqual(last);
    expect(denied.events.some((e) => e.type === "narration" && e.key === "crawler.noRerolls")).toBe(true);
    expect(engine.commands(world).some((c) => c.input === "reroll")).toBe(false);
  });

  it("the next crawler gets its free rerolls back", () => {
    let { world } = engine.newWorld();
    for (let i = 0; i < FREE_REROLLS; i++) world = engine.input(world, "reroll").world;
    expect(world.game.freeRerolls).toBe(0);
    world = engine.input(world, "accept").world;
    world.game.phase = "dead";
    world = engine.input(world, "new").world;
    expect(world.game.phase).toBe("creation");
    expect(world.game.freeRerolls).toBe(FREE_REROLLS);
  });

  it("never mutates the input world", () => {
    const { world } = engine.newWorld();
    const snapshot = JSON.stringify(world);
    engine.input(world, "accept");
    engine.input(world, "gibberish command");
    expect(JSON.stringify(world)).toBe(snapshot);
  });

  it("unknown commands produce a System AI line, not a state change", () => {
    const { world } = engine.newWorld();
    const r = engine.input(world, "dance wildly");
    expect(r.world.game.phase).toBe("creation");
    expect(r.events.some((e) => e.type === "narration" && e.text.includes("dance wildly"))).toBe(true);
  });

  it("abandon needs confirmation, then kills the crawler; new starts the next", () => {
    let w = engine.input(engine.newWorld().world, "accept").world;
    w = engine.input(w, "abandon").world;
    expect(w.game.phase).toBe("exploring");
    w = engine.input(w, "abandon confirm").world;
    expect(w.game.phase).toBe("dead");
    expect(w.account.deaths).toBe(1);
    w = engine.input(w, "new").world;
    expect(w.game.phase).toBe("creation");
  });

  it("round-trips through JSON (save/load)", () => {
    const { world } = engine.newWorld();
    const saved = JSON.parse(JSON.stringify(world.game));
    const account = JSON.parse(JSON.stringify(world.account));
    const restored = engine.restore(saved, account);
    expect(restored).toEqual(world);
    expect(engine.restore({ ...saved, version: -1 }, account)).toBeNull();
  });

  it("keeps the event log capped", () => {
    let { world } = engine.newWorld();
    for (let i = 0; i < 400; i++) world = engine.input(world, "help").world;
    expect(world.game.log.length).toBeLessThanOrEqual(300);
  });
});
