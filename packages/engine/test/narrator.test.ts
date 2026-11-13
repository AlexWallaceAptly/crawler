import { afterEach, describe, expect, it } from "vitest";
import { chooseVariant, render, resetRng, setRandomSource, type NarrationTemplate } from "../src";

afterEach(() => resetRng());

describe("render", () => {
  it("inserts paths", () => {
    expect(render("Level {crawler.level}.", { crawler: { level: 4 } })).toBe("Level 4.");
  });

  it("marks missing paths", () => {
    expect(render("Hi {nope.nada}", {})).toBe("Hi ???");
  });

  it("picks an option, including nested paths", () => {
    setRandomSource(() => 0.99);
    expect(render("{pick:a|b|hello {name}}", { name: "Dale" })).toBe("hello Dale");
    setRandomSource(() => 0);
    expect(render("{pick:a|b|hello {name}}", { name: "Dale" })).toBe("a");
  });
});

describe("chooseVariant", () => {
  const tpl: NarrationTemplate = {
    key: "t",
    variants: [
      { text: "plain one" },
      { text: "plain two" },
      { text: "nearly dead", when: { "crawler.hpPct": { lte: 10 } } },
    ],
  };

  it("prefers a matching conditional variant", () => {
    const r = chooseVariant(tpl, { crawler: { hpPct: 5 } }, { recent: [] });
    expect(r.text).toBe("nearly dead");
  });

  it("falls back to unconditional variants when no condition matches", () => {
    for (let i = 0; i < 20; i++) {
      const r = chooseVariant(tpl, { crawler: { hpPct: 50 } }, { recent: [] });
      expect(r.text).not.toBe("nearly dead");
    }
  });

  it("avoids recently used variants", () => {
    for (let i = 0; i < 20; i++) {
      const r = chooseVariant(tpl, { crawler: { hpPct: 50 } }, { recent: ["t#0"] });
      expect(r.text).toBe("plain two");
    }
  });
});
