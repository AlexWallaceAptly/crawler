import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import { loadContent } from "../src/content/load";
import { StepContext } from "../src/step";
import { maybeEncounter, startCombat } from "../src/combat";
import { itemFromRef } from "../src/gen/item";
import { applyStatus } from "../src/rules/effects";
import { forceDice, resetRng, setRandomSource } from "../src/rng";
import { rawContent } from "@crawler/content";
import type { Enemy, StatusInstance, World } from "../src/state";
import type { GameEvent, GameEventType } from "../src/events";

const content = loadContent(rawContent as never);
const engine = createEngine(content);

const of = <T extends GameEventType>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

function testEnemy(over: Partial<Enemy> = {}): Enemy {
  return {
    uid: "e1", familyId: "sump_rat", name: "Test Rat", level: 4, tier: "mob",
    stats: { STR: 4, DEX: 5, CON: 4, INT: 1, CHA: 1 },
    maxHP: 10, hp: 10, armor: 0, defense: 12,
    attacks: [{ name: "Bite", dice: "1d4", damageType: "physical", stat: "DEX", range: "close", ready: 0 }],
    ai: ["attack"], preferRange: "close", talkable: false, range: "close",
    statuses: [], regen: 0, fleeBelow: 0, initiative: 5, xp: 10, speed: 4,
    ...over,
  };
}

/** Exploring world with a bare, known crawler and one scripted enemy in combat. */
function fightWorld(enemies: Enemy[] = [testEnemy()]): World {
  let { world } = engine.newWorld();
  ({ world } = engine.step(world, { type: "accept" }));
  const c = world.game.crawler!;
  c.baseStats = { STR: 10, DEX: 6, CON: 8, INT: 4, CHA: 8 };
  c.skills = {};
  c.statuses = [];
  c.inventory = [{
    uid: "w1", baseId: "test_club", kind: "gear", name: "Test Club", rarity: "common",
    slot: "mainHand", damage: "1d6", damageType: "physical", stat: "STR",
    modifiers: [], weight: 1, value: 0, qty: 1, tags: [],
  }];
  c.equipment = { mainHand: "w1" };
  c.hp = 34; // 10 + 3*8 + 2*1
  c.mp = 13;
  world.account.settings = { combatMode: "bands" };
  world.game.combat = {
    mode: "bands", enemies, round: 1, playerInitiative: 15, minorActionsUsed: 0, turnBegun: false,
    fromRoom: world.game.floor!.currentRoom,
  };
  world.game.phase = "combat";
  return world;
}

afterEach(() => resetRng());

describe("scripted fights", () => {
  it("a hit rolls d20 + stat + skill vs defense and deals dice + stat/2", () => {
    const world = fightWorld();
    forceDice(10, 4, /* enemy turn: */ 2);
    const { world: w, events } = engine.step(world, { type: "attack" });
    // hit: 10 + STR10 = 20 vs 12; damage 4 + 5 = 9
    expect(w.game.combat!.enemies[0]!.hp).toBe(1);
    expect(of(events, "combatLine").some((e) => e.text.includes("9 damage"))).toBe(true);
    expect(w.game.phase).toBe("combat");
  });

  it("natural 1 misses even with huge bonuses; natural 20 doubles the dice", () => {
    const w1 = fightWorld();
    forceDice(1, 3);
    const r1 = engine.step(w1, { type: "attack" });
    expect(r1.world.game.combat!.enemies[0]!.hp).toBe(10);

    const w2 = fightWorld();
    forceDice(20, 3, 4); // crit: 3 + 4 + 5 = 12 → dead, no enemy turn
    const r2 = engine.step(w2, { type: "attack" });
    expect(r2.world.game.phase).toBe("exploring");
    expect(of(r2.events, "combatEnded")[0]!.outcome).toBe("victory");
  });

  it("victory pays the corpse XP and returns to exploring", () => {
    const world = fightWorld([testEnemy({ hp: 1 })]);
    const before = world.game.crawler!.xp;
    forceDice(15, 6);
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(w.game.crawler!.xp).toBe(before + 10);
    expect(w.game.combat).toBeNull();
    expect(of(events, "combatEnded")[0]!.xp).toBe(10);
  });

  it("the enemy's turn comes back: a hit damages the crawler and can apply a status", () => {
    const world = fightWorld([testEnemy({
      attacks: [{ name: "Bite", dice: "1d4", damageType: "physical", stat: "DEX", range: "close", ready: 0,
        status: { id: "bleeding", chance: 1, duration: 2 } }],
    })]);
    setRandomSource(() => 0.0); // every chance() succeeds; dice come from forceDice
    forceDice(/* player nat 1, auto-miss */ 1, /* enemy d20 */ 18, /* bite 1d4 */ 4);
    const { world: w } = engine.step(world, { type: "attack" });
    expect(w.game.crawler!.statuses.some((s) => s.id === "bleeding")).toBe(true);
    expect(w.game.crawler!.hp).toBeLessThan(34);
  });

  it("an enemy that won initiative does not take a second turn in round one", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    world.game.crawler!.hp = 500;
    // pin the crawler: a random kit's defense or weapon dice would shift the forced dice
    world.game.crawler!.baseStats = { STR: 10, DEX: 6, CON: 8, INT: 4, CHA: 8 };
    world.game.crawler!.inventory = [];
    world.game.crawler!.equipment = {};
    world.game.crawler!.skills = {};
    world.account.settings = { combatMode: "bands" };
    const ctx = new StepContext(world, content);
    const enemy = testEnemy();
    enemy.hp = 100;
    enemy.maxHP = 100;
    forceDice(1, 20, 10, 2, 10, 1, 10, 2);
    startCombat(ctx, [enemy]);
    world = ctx.world;
    expect(ctx.events.filter((e) => e.type === "combatLine" && e.actor === "enemy" && e.text.includes("Bite"))).toHaveLength(1);
    const next = engine.step(world, { type: "attack" });
    world = next.world;
    const attacks = next.events.filter((e) => e.type === "combatLine" && e.actor === "enemy" && e.text.includes("Bite"));
    expect(attacks).toHaveLength(1); // one turn at round two's start; round one's turn was already logged above
    expect(world.game.combat!.round).toBe(2);
  });

  it("the crawler dies at 0 HP and it counts as a death", () => {
    const world = fightWorld([testEnemy({ name: "Executioner Rat" })]);
    world.game.crawler!.hp = 2;
    const deaths = world.account.deaths;
    forceDice(1, 19, 4);
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(w.game.phase).toBe("dead");
    expect(of(events, "died")[0]!.cause).toContain("Executioner Rat");
    expect(w.account.deaths).toBe(deaths + 1);
    expect(w.game.combat).toBeNull();
  });

  it("a collapsing floor clears the live combat state", () => {
    const world = fightWorld();
    world.game.floor!.timeLeft = 1;
    forceDice(1, 1); // player miss, enemy miss; round clock reaches zero
    const { world: w } = engine.step(world, { type: "attack" });
    expect(w.game.phase).toBe("dead");
    expect(w.game.combat).toBeNull();
  });

  it("flee: success leaves combat, failure gives every enemy a free swing", () => {
    const ok = fightWorld();
    forceDice(20, 1); // yours vs theirs
    const r1 = engine.step(ok, { type: "flee" });
    expect(r1.world.game.phase).toBe("exploring");
    expect(of(r1.events, "combatEnded")[0]!.outcome).toBe("fled");

    const bad = fightWorld();
    forceDice(1, 20, /* free bite */ 19, 4);
    const r2 = engine.step(bad, { type: "flee" });
    expect(r2.world.game.phase).toBe("combat");
    expect(r2.world.game.crawler!.hp).toBeLessThan(34);
  });

  it("stunned enemies lose their turn and the status expires at round end", () => {
    const stunned: StatusInstance = { id: "stunned", remaining: 1, stacks: 1 };
    const world = fightWorld([testEnemy({ statuses: [stunned] })]);
    forceDice(2, 1); // 2+10=12 hits defense 12 for 1+5 damage; the stunned rat then skips
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(w.game.combat!.enemies[0]!.hp).toBe(4);
    const lines = of(events, "combatLine").map((e) => e.text).join("\n");
    expect(lines).toContain("stunned");
  });

  it("status ticks hurt the player at the start of their action", () => {
    const world = fightWorld();
    world.game.crawler!.statuses = [{ id: "poisoned", remaining: 3, stacks: 1 }];
    forceDice(/* poison 1d3 */ 3, /* attack */ 1, /* enemy */ 2);
    const { world: w } = engine.step(world, { type: "attack" });
    expect(w.game.crawler!.hp).toBe(31);
  });

  it("talk pacifies talkable enemies for half XP", () => {
    const world = fightWorld([testEnemy({ talkable: true })]);
    const before = world.game.crawler!.xp;
    forceDice(19); // 19 + CHA8 = 27 vs DC 20
    const { world: w, events } = engine.step(world, { type: "talk" });
    expect(w.game.phase).toBe("exploring");
    expect(w.game.crawler!.xp).toBe(before + 5);
    expect(events.some((e) => e.type === "narration" && e.key === "combat.talkSuccess")).toBe(true);
  });

  it("melee closes one band, then spends the turn if still out of reach", () => {
    const world = fightWorld([testEnemy({
      range: "far",
      attacks: [{ name: "Long Bite", dice: "1d4", damageType: "physical", stat: "DEX", range: "far", ready: 0 }],
    })]);
    forceDice(); // no dice should be needed
    const { world: w } = engine.step(world, { type: "attack" });
    expect(w.game.combat!.enemies[0]!.range).toBe("near");
    expect(w.game.combat!.minorActionsUsed).toBe(0); // the turn ended and the next round's minor action is fresh
    expect(w.game.combat!.round).toBe(2);
  });

  it("slowed blocks repositioning and hasted grants a second minor move", () => {
    const slowed = fightWorld([testEnemy({ range: "far" })]);
    slowed.game.crawler!.statuses = [{ id: "slowed", remaining: 2, stacks: 1 }];
    const blocked = engine.step(slowed, { type: "advance" });
    expect(blocked.world.game.combat!.enemies[0]!.range).toBe("far");
    expect(blocked.world.game.combat!.minorActionsUsed).toBe(0);

    const hasted = fightWorld([testEnemy({ range: "far" })]);
    hasted.game.crawler!.statuses = [{ id: "hasted", remaining: 2, stacks: 1 }];
    const first = engine.step(hasted, { type: "advance" });
    const second = engine.step(first.world, { type: "retreat" });
    expect(second.world.game.combat!.enemies[0]!.range).toBe("far");
    expect(second.world.game.combat!.minorActionsUsed).toBe(2);
  });

  it("a newly applied one-round status gets its full first round", () => {
    const world = fightWorld();
    world.game.crawler!.statuses = [{ id: "bleeding", remaining: 1, stacks: 1, fresh: true }];
    forceDice(3, 1, 2, 1); // bleed tick, player miss, enemy attack and damage
    const { world: w } = engine.step(world, { type: "attack" });
    expect(w.game.crawler!.statuses).toEqual([{ id: "bleeding", remaining: 1, stacks: 1, fresh: false }]);
  });

  it("lair rooms always start an elite fight on first entry", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    world.game.crawler!.hp = 500; // the ambush round is live dice; don't let it flake the test
    const ctx = new StepContext(world, content);
    const room = world.game.floor!.rooms.find((r) => r.type === "lair")
      ?? { ...world.game.floor!.rooms[0]!, type: "lair" as const };
    const started = maybeEncounter(ctx, room, true);
    expect(started).toBe(true);
    expect(ctx.game.combat!.enemies.some((e) => e.tier === "elite")).toBe(true);
  });
});

describe("milestone 4b fixes", () => {
  it("fleeing goes back to the room you came from, not the one you were jumped in", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    world.account.settings = { combatMode: "bands" };
    world.game.crawler!.hp = 500;
    const floor = world.game.floor!;
    const start = floor.rooms[floor.currentRoom]!;
    const dir = (Object.keys(start.exits) as (keyof typeof start.exits)[])[0]!;
    const lair = floor.rooms[start.exits[dir]!]!;
    lair.type = "lair"; // guaranteed fight on first entry
    lair.visited = false;
    ({ world } = engine.step(world, { type: "go", dir }));
    expect(world.game.phase).toBe("combat");
    expect(world.game.combat!.fromRoom).toBe(start.id);
    world.game.crawler!.statuses = []; // the ambush round is live dice; don't let a poison tick eat the forced roll
    forceDice(20, 1);
    ({ world } = engine.step(world, { type: "flee" }));
    expect(world.game.phase).toBe("exploring");
    expect(world.game.floor!.currentRoom).toBe(start.id);
  });

  it("thrown items hit the enemy, not the thrower", () => {
    const world = fightWorld([testEnemy({ hp: 50, maxHP: 50 })]);
    world.game.crawler!.inventory.push(itemFromRef(content, "pepper_spray"));
    forceDice(1); // the rat's swing back misses
    const { world: w } = engine.step(world, { type: "use", item: "pepper spray" });
    expect(w.game.combat!.enemies[0]!.statuses.some((s) => s.id === "blinded")).toBe(true);
    expect(w.game.crawler!.statuses.some((s) => s.id === "blinded")).toBe(false);
    expect(w.game.crawler!.inventory.some((i) => i.baseId === "pepper_spray")).toBe(false);
  });

  it("thrown items refuse to fire with nothing to throw them at", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    world.game.crawler!.inventory.push(itemFromRef(content, "pepper_spray"));
    const { world: w, events } = engine.step(world, { type: "use", item: "pepper spray" });
    expect(of(events, "error")).toHaveLength(1);
    expect(w.game.crawler!.inventory.some((i) => i.baseId === "pepper_spray")).toBe(true);
  });

  it("mana restores MP, not HP", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    const c = world.game.crawler!;
    c.inventory.push(itemFromRef(content, "mana_potion"));
    c.mp = 0;
    const hp = c.hp;
    const { world: w } = engine.step(world, { type: "use", item: "mana potion" });
    expect(w.game.crawler!.mp).toBeGreaterThan(0);
    expect(w.game.crawler!.hp).toBe(hp);
  });

  it("a rejected attack doesn't tick statuses twice when you try again", () => {
    const world = fightWorld([
      testEnemy({ uid: "ghost", name: "Ghost Rat", statuses: [{ id: "invisible", remaining: 3, stacks: 1 }] }),
      testEnemy({ uid: "e2", name: "Plain Rat" }),
    ]);
    world.game.crawler!.statuses = [{ id: "poisoned", remaining: 3, stacks: 1 }];
    forceDice(3); // one poison tick
    const r1 = engine.step(world, { type: "attack", target: "ghost" });
    expect(of(r1.events, "error")).toHaveLength(1);
    expect(r1.world.game.crawler!.hp).toBe(31);
    forceDice(1, 1, 1); // retry: player miss, two rat misses — and no second poison roll
    const r2 = engine.step(r1.world, { type: "attack", target: "plain" });
    expect(r2.world.game.crawler!.hp).toBe(31);
  });

  it("set combat is free and sticks to the account", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    const turn = world.game.turn;
    const r = engine.input(world, "set combat grid");
    expect(r.world.account.settings?.combatMode).toBe("grid");
    expect(r.world.game.turn).toBe(turn);
    const back = engine.input(r.world, "set combat bands");
    expect(back.world.account.settings?.combatMode).toBe("bands");
  });

  it("the combat mode is locked when the fight starts", () => {
    const world = fightWorld();
    const r = engine.input(world, "set combat grid");
    expect(r.world.game.combat!.mode).toBe("bands");
  });

  it("saves from before Milestone 4b are discarded, the account survives", () => {
    const { world } = engine.newWorld();
    expect(engine.restore({ ...world.game, version: 3 }, world.account)).toBeNull();
    expect(engine.restoreAccount(world.account)).not.toBeNull();
  });
});

describe("status stacking rules", () => {
  const def = (id: string) => content.statusEffects.get(id);

  it("stack: adds stacks up to maxStacks", () => {
    const list: StatusInstance[] = [];
    applyStatus(list, def("bleeding"));
    applyStatus(list, def("bleeding"));
    applyStatus(list, def("bleeding"));
    applyStatus(list, def("bleeding"));
    expect(list[0]!.stacks).toBe(3); // maxStacks 3
  });

  it("extend: adds duration", () => {
    const list: StatusInstance[] = [];
    applyStatus(list, def("poisoned"));
    const first = list[0]!.remaining;
    applyStatus(list, def("poisoned"));
    expect(list[0]!.remaining).toBe(first + def("poisoned").defaultDuration);
  });

  it("refresh: resets duration, never stacks", () => {
    const list: StatusInstance[] = [];
    applyStatus(list, def("burning"), 1);
    applyStatus(list, def("burning"), 2);
    expect(list).toHaveLength(1);
    expect(list[0]!.remaining).toBe(2);
    expect(list[0]!.stacks).toBe(1);
  });
});
