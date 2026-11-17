import { describe, expect, it } from "vitest";
import { rawContent } from "@crawler/content";
import { ContentError, loadContent, loadDefaultContent, templatePaths, type RawContent } from "../src";

const raw = rawContent as RawContent;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("shipped content", () => {
  it("passes validation", () => {
    expect(() => loadDefaultContent()).not.toThrow();
  });

  it("has narration templates whose pick syntax is balanced", () => {
    const c = loadDefaultContent();
    for (const tpl of Object.values(c.narration)) {
      for (const v of tpl.variants) {
        const opens = (v.text.match(/\{/g) ?? []).length;
        const closes = (v.text.match(/\}/g) ?? []).length;
        expect(opens, `${tpl.key}: ${v.text}`).toBe(closes);
        for (const p of templatePaths(v.text)) expect(p, tpl.key).toMatch(/^[A-Za-z][\w.]*$/);
      }
    }
  });
});

describe("loadContent failures are loud and readable", () => {
  it("reports file, entry id and field for schema errors", () => {
    const bad = clone(raw);
    (bad["items/bases.json"] as { power?: unknown }[])[0]!.power = [6, 4, 2];
    try {
      loadContent(bad);
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ContentError);
      expect((e as Error).message).toContain(`items/bases.json[0 "chef_knife"].power`);
      expect((e as Error).message).toContain("tiers");
    }
  });

  it("rejects unknown keys (typos)", () => {
    const bad = clone(raw);
    (bad["skills.json"] as Record<string, unknown>[])[0]!["catgeory"] = "weapon";
    expect(() => loadContent(bad)).toThrow(/catgeory/);
  });

  it("reports broken cross-references", () => {
    const bad = clone(raw);
    (bad["backstory/occupations.json"] as { skill: string }[])[0]!.skill = "juggling";
    expect(() => loadContent(bad)).toThrow(/unknown skill "juggling"/);
  });

  it("reports duplicate ids", () => {
    const bad = clone(raw);
    const skills = bad["skills.json"] as unknown[];
    skills.push(clone(skills[0]));
    expect(() => loadContent(bad)).toThrow(/duplicate id "blades"/);
  });

  it("collects problems across files instead of stopping at the first", () => {
    const bad = clone(raw);
    (bad["items/bases.json"] as { value: unknown }[])[0]!.value = "free";
    (bad["statusEffects.json"] as { kind: unknown }[])[0]!.kind = "vibe";
    try {
      loadContent(bad);
      expect.fail("should throw");
    } catch (e) {
      expect((e as ContentError).problems.length).toBeGreaterThanOrEqual(2);
    }
  });
});
