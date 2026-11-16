import { afterEach, describe, expect, it } from "vitest";
import { forceDice, resetRng, setRandomSource } from "../src/rng";
import { itemFromRef } from "../src/gen/item";
import { effectiveTags } from "../src/inventory";
import { matchCombination, specificity } from "../src/craft";
import { stepDice } from "../src/rules/dice";
import { arenaOf, content, engine, gridWorld, lines, of, testEnemy } from "./helpers";
import type { ItemInstance, World } from "../src/state";

afterEach(() => resetRng());

/** A crawler standing at a workbench (the first safe room) holding exactly `ids`, the first one equipped. */
function atBench(ids: string[]): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  const floor = world.game.floor!;
  const safe = floor.rooms.find((r) => r.type === "safe")!;
  floor.currentRoom = safe.id;
  delete safe.items;
  const c = world.game.crawler!;
  c.inventory = ids.map((id) => itemFromRef(content, id));
  c.equipment = {};
  if (c.inventory[0]?.slot === "mainHand") c.equipment.mainHand = c.inventory[0].uid;
  c.recipes = [];
  return world;
}

const has = (w: World, id: string) => w.game.crawler!.inventory.find((i) => i.baseId === id);
const said = (events: { type: string; key?: string }[], key: string) => events.some((e) => e.type === "narration" && e.key === key);

describe("combine", () => {
  it("bat + tacks + tape = a nail bat, upgraded in place and still in your hands", () => {
    const world = atBench(["baseball_bat", "thumbtacks", "duct_tape"]);
    const t = world.game.floor!.timeLeft;
    const { world: w, events } = engine.input(world, "combine bat tacks tape");
    const bat = has(w, "baseball_bat")!;
    expect(bat.name).toBe("Nail-Studded Aluminum Baseball Bat");
    expect(bat.damage).toBe("1d8+1");
    expect(bat.onHit).toEqual({ id: "bleeding", chance: 0.3, duration: 2 });
    expect(bat.crafted).toEqual(["nail_bat"]);
    expect(w.game.crawler!.equipment.mainHand).toBe(bat.uid);
    expect(has(w, "thumbtacks")).toBeUndefined();
    expect(has(w, "duct_tape")).toBeUndefined();
    expect(w.game.crawler!.recipes).toEqual(["nail_bat"]);
    expect(of(events, "recipeLearned")[0]!.name).toBe("Nail Bat");
    expect(w.game.floor!.timeLeft).toBe(t - 20);
  });

  it("any blunt + any sharp + any binding works: crowbar, nails, rope", () => {
    const world = atBench(["crowbar", "box_of_nails", "nylon_rope"]);
    const { world: w } = engine.input(world, "combine crowbar, nails, rope");
    expect(has(w, "crowbar")!.name).toBe("Nail-Studded Crowbar");
  });

  it("multi-word names work without commas", () => {
    const world = atBench(["lead_pipe", "thumbtacks", "duct_tape"]);
    const { world: w } = engine.input(world, "combine lead pipe box of thumbtacks roll of duct tape");
    expect(has(w, "lead_pipe")!.name).toBe("Nail-Studded Length of Lead Pipe");
  });

  it("the more specific recipe wins: barbed wire on a bat is a barbed bat", () => {
    const world = atBench(["baseball_bat", "barbed_wire_coil"]);
    forceDice(15); // the DEX check
    const { world: w } = engine.input(world, "combine bat, barbed wire");
    expect(has(w, "baseball_bat")!.name).toBe("Barbed Aluminum Baseball Bat");
  });

  it("every named thing has to be used: an extra item means no match (5 minutes, nothing lost)", () => {
    const world = atBench(["baseball_bat", "thumbtacks", "duct_tape", "disposable_lighter"]);
    const t = world.game.floor!.timeLeft;
    const { world: w, events } = engine.input(world, "combine bat tacks tape lighter");
    expect(said(events, "craft.noMatch")).toBe(true);
    expect(w.game.crawler!.inventory).toHaveLength(4);
    expect(w.game.floor!.timeLeft).toBe(t - 5);
  });

  it("an ambiguous name resolves to whichever item makes a recipe work", () => {
    const world = atBench(["baseball_bat", "thumbtacks", "sealed_bandage", "duct_tape"]);
    const { world: w } = engine.input(world, "combine bat tacks tape");
    expect(has(w, "baseball_bat")!.crafted).toEqual(["nail_bat"]);
    expect(has(w, "sealed_bandage")).toBeDefined();
    expect(has(w, "duct_tape")).toBeUndefined();
  });

  it("tools aren't used up: the hammer survives hammering", () => {
    const world = atBench(["baseball_bat", "box_of_nails", "claw_hammer"]);
    const { world: w } = engine.input(world, "combine hammer nails bat");
    expect(has(w, "baseball_bat")!.damage).toBe("1d8+2");
    expect(has(w, "claw_hammer")).toBeDefined();
    expect(has(w, "box_of_nails")).toBeUndefined();
  });

  it("item recipes make a new item and equip it if the hand is free", () => {
    const world = atBench(["broken_glass", "electrical_tape"]);
    const { world: w } = engine.input(world, "combine glass and tape");
    const shiv = has(w, "glass_shiv")!;
    expect(shiv).toBeDefined();
    expect(w.game.crawler!.equipment.mainHand).toBe(shiv.uid);
    expect(shiv.onHit?.id).toBe("bleeding");
  });

  it("stacks can cover a qty: two tacks from one box make a caltrop pouch", () => {
    const world = atBench(["tube_sock"]);
    world.game.crawler!.inventory.push(itemFromRef(content, "thumbtacks", 3));
    const { world: w } = engine.input(world, "combine sock tacks");
    expect(has(w, "caltrop_pouch")).toBeDefined();
    expect(has(w, "thumbtacks")!.qty).toBe(1);
  });

  it("no workbench, no crafting (nothing used, no time)", () => {
    const world = atBench(["baseball_bat", "thumbtacks", "duct_tape"]);
    const floor = world.game.floor!;
    floor.currentRoom = floor.rooms.find((r) => r.type === "corridor" && !r.workbench)!.id;
    const t = floor.timeLeft;
    const { world: w, events } = engine.input(world, "combine bat tacks tape");
    expect(said(events, "craft.noBench")).toBe(true);
    expect(w.game.crawler!.inventory).toHaveLength(3);
    expect(w.game.floor!.timeLeft).toBe(t);
  });

  it("not in the middle of a fight", () => {
    const world = gridWorld(["@.a"], [testEnemy()]);
    const { events } = engine.input(world, "combine bat tacks tape");
    expect(said(events, "command.notNow")).toBe(true);
  });

  it("a failed check ruins a part but you still learn the recipe", () => {
    const world = atBench(["baseball_bat", "barbed_wire_coil"]);
    forceDice(2); // DEX check fails (not a crit failure: no mishap)
    const { world: w, events } = engine.input(world, "combine bat barbed wire");
    expect(has(w, "barbed_wire_coil")).toBeUndefined();
    expect(has(w, "baseball_bat")!.crafted).toBeUndefined();
    expect(w.game.crawler!.recipes).toEqual(["barbed_bat"]);
    expect(said(events, "craft.botch")).toBe(true);
  });

  it("each upgrade applies once per item", () => {
    const world = atBench(["baseball_bat", "thumbtacks", "duct_tape"]);
    let w = engine.input(world, "combine bat tacks tape").world;
    w.game.crawler!.inventory.push(itemFromRef(content, "thumbtacks"), itemFromRef(content, "duct_tape"));
    const r = engine.input(w, "combine bat tacks tape");
    expect(said(r.events, "craft.noMatch")).toBe(true);
    w = r.world;
    expect(has(w, "baseball_bat")!.crafted).toEqual(["nail_bat"]);
  });

  it("names you aren't carrying are an error, not a wasted five minutes", () => {
    const world = atBench(["baseball_bat"]);
    const t = world.game.floor!.timeLeft;
    const { world: w, events } = engine.input(world, "combine bat unicorn");
    expect(of(events, "error")).toHaveLength(1);
    expect(w.game.floor!.timeLeft).toBe(t);
  });
});

describe("the recipe book", () => {
  it("hints only at recipes you're carrying every part for", () => {
    const world = atBench(["baseball_bat", "thumbtacks"]);
    const before = engine.view(world).recipeBook!.hints;
    expect(before.some((h) => h.includes("Something blunt, something pointy"))).toBe(false);
    world.game.crawler!.inventory.push(itemFromRef(content, "duct_tape"));
    expect(engine.view(world).recipeBook!.hints.some((h) => h.includes("Something blunt, something pointy"))).toBe(true);
  });

  it("picking up the last part gets a nudge from the System AI, once", () => {
    const world = atBench(["baseball_bat", "thumbtacks"]);
    const room = world.game.floor!.rooms[world.game.floor!.currentRoom]!;
    room.items = [itemFromRef(content, "duct_tape")];
    const r = engine.input(world, "take duct tape");
    expect(said(r.events, "craft.idea")).toBe(true);
    r.world.game.floor!.rooms[r.world.game.floor!.currentRoom]!.items = [itemFromRef(content, "friction_tape")];
    const again = engine.input(r.world, "take friction tape");
    expect(again.events.filter((e) => e.type === "narration" && e.key === "craft.idea" && e.text.includes("blunt, something pointy"))).toHaveLength(0);
  });

  it("`craft nail bat` uses a known recipe and picks the parts itself", () => {
    const world = atBench(["baseball_bat", "thumbtacks", "duct_tape", "thumbtacks", "friction_tape", "tire_iron"]);
    let w = engine.input(world, "combine bat tacks duct tape").world;
    const cmds = engine.commands(w).map((c) => c.input);
    expect(cmds).toContain("craft nail bat");
    w = engine.input(w, "craft nail bat").world;
    expect(has(w, "tire_iron")!.name).toBe("Nail-Studded Tire Iron");
    expect(engine.input(w, "recipes").events.some((e) => e.type === "info" && e.text === "Recipe book:")).toBe(true);
  });
});

describe("crafted gear in a fight", () => {
  it("a nail bat's bleed lands on hit", () => {
    const world = gridWorld(["@a"], [testEnemy({ hp: 30, maxHP: 30 })]);
    const club = world.game.crawler!.inventory[0]!;
    club.onHit = { id: "bleeding", chance: 1, duration: 2 };
    setRandomSource(() => 0);
    forceDice(10, 2, 1);
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(w.game.combat!.enemies[0]!.statuses.some((s) => s.id === "bleeding")).toBe(true);
    expect(lines(events)).toContain("is bleeding");
    expect(arenaOf(w)).toBeDefined();
  });
});

describe("recipe content", () => {
  const everything: ItemInstance[] = [
    ...content.items.bases.all.map((b) => itemFromRef(content, b.id)),
    ...content.items.consumables.all.map((c) => itemFromRef(content, c.id)),
  ];

  it("every recipe input can be filled by some item in the content", () => {
    for (const r of content.recipes.all) {
      for (const input of r.inputs) {
        const ok = everything.some((it) =>
          (!input.id || it.baseId === input.id) &&
          (!input.tags || input.tags.some((t) => effectiveTags(it).includes(t))) &&
          (!input.base || it.kind === "gear"));
        expect(ok, `${r.id}: ${JSON.stringify(input)}`).toBe(true);
      }
    }
  });

  it("the tutorial kit in the first safe room makes a nail bat", () => {
    const kit = content.floors.get("undercroft").loot.firstSafe.map((f) => itemFromRef(content, f.item, f.qty));
    const m = matchCombination(content, kit, "pipe tacks tape");
    expect(m?.recipe.id).toBe("nail_bat");
  });

  it("specificity: an exact id beats a tag", () => {
    expect(specificity(content.recipes.get("glue_trap"))).toBeGreaterThan(specificity(content.recipes.get("sock_flail")));
  });

  it("die steps climb the ladder", () => {
    expect(stepDice("1d6", 1)).toBe("1d8");
    expect(stepDice("2d4+1", 2)).toBe("2d8+1");
    expect(stepDice("1d12", 1)).toBe("1d12");
  });
});
