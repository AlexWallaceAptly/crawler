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
    maxHP: 10, hp: 10, armor: 0, guard: 0,
    attacks: [{ name: "Bite", power: [1, 2, 3], damageType: "physical", stat: "DEX", range: "close", ready: 0 }],
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
    slot: "mainHand", power: [2, 4, 6], damageType: "physical", stat: "STR",
    modifiers: [], weight: 1, value: 0, qty: 1, tags: [],
  }];
  c.equipment = { mainHand: "w1" };
  c.hp = 34; // 10 + 3*8 + 2*1
  c.mp = 13;
  world.account.settings = { combatMode: "bands" };
  world.game.combat = {
    mode: "bands", enemies, round: 1, playerInitiative: 15, ap: 0, apMax: 3, turnBegun: false,
    fromRoom: world.game.floor!.currentRoom,
  };
  world.game.phase = "combat";
  return world;
}

afterEach(() => resetRng());

describe("scripted fights", () => {
  // The fixture crawler: STR 10 (+5 on the roll, +5 damage at 2 AP), Test Club 2/4/6.
  // The Test Rat: DEX 5 (+2 on the roll, +1 damage), Bite 1/2/3, 3 AP a turn.
  it("a swing rolls 2d10 + stat/2 + skill and deals the tier's damage + stat/2", () => {
    const world = fightWorld();
    forceDice(5, 5); // 10 + 5 = 15: tier 2, 4 + 5 = 9
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(w.game.combat!.enemies[0]!.hp).toBe(1);
    const text = of(events, "combatLine").map((e) => e.text).join("\n");
    expect(text).toContain("Tier 2");
    expect(text).toContain("9 damage");
    // 2 of 3 AP spent: the turn is still yours
    expect(w.game.combat!.ap).toBe(1);
    expect(w.game.combat!.round).toBe(1);
  });

  it("nothing misses: the worst possible roll still does tier 1 damage", () => {
    const world = fightWorld();
    forceDice(1, 1); // 2 + 5 = 7: tier 1, 2 + 5 = 7
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(w.game.combat!.enemies[0]!.hp).toBe(3);
    expect(of(events, "combatLine").some((e) => e.text.includes("Tier 1"))).toBe(true);
  });

  it("armor soaks damage but never all of it", () => {
    const world = fightWorld([testEnemy({ armor: 50 })]);
    forceDice(1, 1);
    const { world: w } = engine.step(world, { type: "attack" });
    expect(w.game.combat!.enemies[0]!.hp).toBe(9);
  });

  it("17+ is tier 3; a natural 19 is a crit that hands 1 AP back", () => {
    const w1 = fightWorld();
    forceDice(6, 6); // 12 + 5 = 17: tier 3, 6 + 5 = 11 → dead
    const r1 = engine.step(w1, { type: "attack" });
    expect(r1.world.game.phase).toBe("exploring");
    expect(of(r1.events, "combatEnded")[0]!.outcome).toBe("victory");

    const w2 = fightWorld([testEnemy({ hp: 50, maxHP: 50 })]);
    forceDice(10, 9);
    const r2 = engine.step(w2, { type: "attack" });
    expect(r2.world.game.combat!.enemies[0]!.hp).toBe(39);
    expect(r2.world.game.combat!.ap).toBe(2); // 3 - 2 + 1
    expect(of(r2.events, "combatLine").some((e) => e.text.includes("CRIT"))).toBe(true);
  });

  it("the turn ends itself when the AP runs out", () => {
    const world = fightWorld([testEnemy({ hp: 50, maxHP: 50 })]);
    forceDice(5, 5);
    const r1 = engine.step(world, { type: "attack" }); // 2 AP
    expect(r1.world.game.combat!.round).toBe(1);
    forceDice(/* rat's bite */ 5, 5);
    const r2 = engine.step(r1.world, { type: "defend" }); // the last AP
    expect(r2.world.game.combat!.round).toBe(2);
    expect(of(r2.events, "combatLine").some((e) => e.actor === "enemy" && e.text.includes("Bite"))).toBe(true);
  });

  it("an action you can't pay for is refused and costs nothing", () => {
    const world = fightWorld([testEnemy({ hp: 50, maxHP: 50 })]);
    forceDice(5, 5);
    const r1 = engine.step(world, { type: "attack" });
    const r2 = engine.step(r1.world, { type: "attack" }); // 1 AP left, a swing is 2
    expect(of(r2.events, "error")).toHaveLength(1);
    expect(r2.world.game.combat!.ap).toBe(1);
    expect(r2.world.game.combat!.enemies[0]!.hp).toBe(41);
  });

  it("a light weapon swings for 1 AP with a quarter of the stat; an unwieldy one costs 2 and ends the turn", () => {
    const light = fightWorld([testEnemy({ hp: 50, maxHP: 50 })]);
    Object.assign(light.game.crawler!.inventory[0]!, { power: [1, 2, 3], apCost: 1 });
    forceDice(5, 5); // tier 2: 2 + floor(10/4) = 4
    const r1 = engine.step(light, { type: "attack" });
    expect(r1.world.game.combat!.enemies[0]!.hp).toBe(46);
    expect(r1.world.game.combat!.ap).toBe(2);

    const heavy = fightWorld([testEnemy({ hp: 50, maxHP: 50 })]);
    Object.assign(heavy.game.crawler!.inventory[0]!, { power: [4, 7, 10], apCost: 2, unwieldy: true });
    forceDice(5, 5, /* rat */ 5, 5); // tier 2: 7 + floor(30/4) = 14 (it hits like a 3-AP swing), and the turn is over
    const r2 = engine.step(heavy, { type: "attack" });
    expect(r2.world.game.combat!.enemies[0]!.hp).toBe(36);
    expect(r2.world.game.combat!.round).toBe(2);
  });

  it("victory pays the corpse XP and returns to exploring", () => {
    const world = fightWorld([testEnemy({ hp: 1 })]);
    const before = world.game.crawler!.xp;
    forceDice(1, 1);
    const { world: w, events } = engine.step(world, { type: "attack" });
    expect(w.game.crawler!.xp).toBe(before + 10);
    expect(w.game.combat).toBeNull();
    expect(of(events, "combatEnded")[0]!.xp).toBe(10);
  });

  it("the enemy's turn comes back: it always hurts, and a tier 2 hit rolls its status", () => {
    const world = fightWorld([testEnemy({
      attacks: [{ name: "Bite", power: [1, 2, 3], damageType: "physical", stat: "DEX", range: "close", ready: 0,
        status: { id: "bleeding", chance: 1, duration: 2 } }],
    })]);
    setRandomSource(() => 0.0); // every chance() succeeds; dice come from forceDice
    forceDice(6, 6); // 12 + 2 = 14: tier 2, 2 + 1 = 3
    const { world: w, events } = engine.step(world, { type: "wait" });
    expect(w.game.crawler!.statuses.some((s) => s.id === "bleeding")).toBe(true);
    expect(w.game.crawler!.hp).toBe(31);
    // 3 AP buys one 2-AP bite, not two
    expect(of(events, "combatLine").filter((e) => e.actor === "enemy" && e.text.includes("Bite"))).toHaveLength(1);
  });

  it("status riders: never on tier 1, always on tier 3", () => {
    const biter = () => testEnemy({
      attacks: [{ name: "Bite", power: [1, 2, 3], damageType: "physical", stat: "DEX", range: "close", ready: 0,
        status: { id: "bleeding", chance: 0, duration: 2 } }],
    });
    const weak = fightWorld([biter()]);
    forceDice(1, 1);
    const r1 = engine.step(weak, { type: "wait" });
    expect(r1.world.game.crawler!.hp).toBe(32); // tier 1 still does 1 + 1
    expect(r1.world.game.crawler!.statuses).toHaveLength(0);

    const strong = fightWorld([biter()]);
    forceDice(8, 8); // 16 + 2 = 18: tier 3, whatever the chance says
    const r2 = engine.step(strong, { type: "wait" });
    expect(r2.world.game.crawler!.statuses.some((s) => s.id === "bleeding")).toBe(true);
  });

  it("an elite has 4 AP: two swings when it's already next to you", () => {
    const world = fightWorld([testEnemy({ tier: "elite" })]);
    forceDice(5, 5, 5, 5);
    const { events } = engine.step(world, { type: "wait" });
    expect(of(events, "combatLine").filter((e) => e.actor === "enemy" && e.text.includes("Bite"))).toHaveLength(2);
  });

  it("bracing is a double bane on whatever swings at you", () => {
    const world = fightWorld([testEnemy({ hp: 50, maxHP: 50 })]);
    forceDice(5, 5, /* rat: 14 + 2 - 4 = 12, still tier 2 */ 7, 7);
    const r1 = engine.step(world, { type: "attack" });
    const r2 = engine.step(r1.world, { type: "defend" });
    expect(of(r2.events, "combatLine").some((e) => e.text.includes("double bane"))).toBe(true);
    expect(r2.world.game.crawler!.hp).toBe(31);
  });

  it("bands: enemies at close range together each get an edge for the other", () => {
    const world = fightWorld([testEnemy(), testEnemy({ uid: "e2", name: "Other Rat" })]);
    forceDice(5, 5, 5, 5); // 10 + 2 + an edge = 14
    const { events } = engine.step(world, { type: "wait" });
    const text = of(events, "combatLine").map((e) => e.text).join("\n");
    expect((text.match(/, edge = 14 \(1 ganging up\)/g) ?? []).length).toBe(2);
  });

  it("an enemy that won initiative does not take a second turn in round one", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    world.game.crawler!.hp = 500;
    // pin the crawler: a random kit would shift the forced dice
    world.game.crawler!.baseStats = { STR: 10, DEX: 6, CON: 8, INT: 4, CHA: 8 };
    world.game.crawler!.inventory = [];
    world.game.crawler!.equipment = {};
    world.game.crawler!.skills = {};
    world.account.settings = { combatMode: "bands" };
    const ctx = new StepContext(world, content);
    const enemy = testEnemy();
    enemy.hp = 100;
    enemy.maxHP = 100;
    forceDice(/* your initiative */ 1, /* its */ 20, /* ambush bite */ 5, 5, /* round two's bite */ 5, 5);
    startCombat(ctx, [enemy]);
    world = ctx.world;
    expect(ctx.events.filter((e) => e.type === "combatLine" && e.actor === "enemy" && e.text.includes("Bite"))).toHaveLength(1);
    const next = engine.step(world, { type: "wait" });
    world = next.world;
    const attacks = next.events.filter((e) => e.type === "combatLine" && e.actor === "enemy" && e.text.includes("Bite"));
    expect(attacks).toHaveLength(1); // one turn at round two's start; round one's turn was already logged above
    expect(world.game.combat!.round).toBe(2);
  });

  it("the crawler dies at 0 HP and it counts as a death", () => {
    const world = fightWorld([testEnemy({ name: "Executioner Rat" })]);
    world.game.crawler!.hp = 2;
    const deaths = world.account.deaths;
    forceDice(5, 5);
    const { world: w, events } = engine.step(world, { type: "wait" });
    expect(w.game.phase).toBe("dead");
    expect(of(events, "died")[0]!.cause).toContain("Executioner Rat");
    expect(w.account.deaths).toBe(deaths + 1);
    expect(w.game.combat).toBeNull();
  });

  it("a collapsing floor clears the live combat state", () => {
    const world = fightWorld();
    world.game.floor!.timeLeft = 1;
    forceDice(5, 5); // the rat's bite; then the round clock reaches zero
    const { world: w } = engine.step(world, { type: "wait" });
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
    forceDice(1, 20, /* free bite */ 5, 5);
    const r2 = engine.step(bad, { type: "flee" });
    expect(r2.world.game.phase).toBe("combat");
    expect(r2.world.game.crawler!.hp).toBe(31);
    expect(r2.world.game.combat!.round).toBe(2); // a failed flee is the end of your turn
  });

  it("stunned enemies lose their turn and the status expires at round end", () => {
    const stunned: StatusInstance = { id: "stunned", remaining: 1, stacks: 1 };
    const world = fightWorld([testEnemy({ statuses: [stunned] })]);
    forceDice(1, 1); // tier 1: 7 damage; then the stunned rat skips
    const r1 = engine.step(world, { type: "attack" });
    const { world: w, events } = engine.step(r1.world, { type: "wait" });
    expect(w.game.combat!.enemies[0]!.hp).toBe(3);
    const lines = of(events, "combatLine").map((e) => e.text).join("\n");
    expect(lines).toContain("stunned");
    expect(w.game.combat!.enemies[0]!.statuses).toHaveLength(0);
  });

  it("status ticks hurt the player at the start of their turn, once", () => {
    const world = fightWorld([testEnemy({ hp: 50, maxHP: 50 })]);
    world.game.crawler!.statuses = [{ id: "poisoned", remaining: 3, stacks: 1 }];
    forceDice(/* poison 1d3 */ 3, /* attack */ 1, 1);
    const r1 = engine.step(world, { type: "attack" });
    expect(r1.world.game.crawler!.hp).toBe(31);
    const r2 = engine.step(r1.world, { type: "attack" }); // same turn (refused: 1 AP left): no second tick
    expect(r2.world.game.crawler!.hp).toBe(31);
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

  it("bands: a swing at something a band away pays 1 AP to close; two bands away spends the turn closing in", () => {
    const near = fightWorld([testEnemy({ range: "near", hp: 50, maxHP: 50 })]);
    forceDice(5, 5, /* rat's bite back */ 5, 5);
    const r1 = engine.step(near, { type: "attack" });
    expect(r1.world.game.combat!.enemies[0]!.range).toBe("close");
    expect(r1.world.game.combat!.enemies[0]!.hp).toBe(41);
    expect(r1.world.game.combat!.round).toBe(2); // 1 + 2 AP: the whole turn

    // two bands is 2 AP of walking: you close in, and the swing waits for next turn
    const far = fightWorld([testEnemy({ range: "far", hp: 50, maxHP: 50 })]);
    const r2 = engine.step(far, { type: "attack" });
    expect(of(r2.events, "error")).toHaveLength(0);
    expect(r2.world.game.combat!.enemies[0]!.range).toBe("close");
    expect(r2.world.game.combat!.enemies[0]!.hp).toBe(50);
    expect(r2.world.game.combat!.ap).toBe(1);
  });

  it("slowed is a 2-AP turn and hasted a 4-AP one", () => {
    const slowed = fightWorld([testEnemy({ range: "far" })]);
    slowed.game.crawler!.statuses = [{ id: "slowed", remaining: 2, stacks: 1 }];
    expect(engine.view(slowed).combat!.ap).toEqual({ current: 2, max: 2 });
    const stepped = engine.step(slowed, { type: "advance" });
    expect(stepped.world.game.combat!.enemies[0]!.range).toBe("near");
    expect(stepped.world.game.combat!.ap).toBe(1);

    const hasted = fightWorld([testEnemy({ range: "far" })]);
    hasted.game.crawler!.statuses = [{ id: "hasted", remaining: 2, stacks: 1 }];
    const first = engine.step(hasted, { type: "advance" });
    const second = engine.step(first.world, { type: "retreat" });
    expect(second.world.game.combat!.enemies[0]!.range).toBe("far");
    expect(second.world.game.combat!.ap).toBe(2);
    expect(second.world.game.combat!.apMax).toBe(4);
  });

  it("a newly applied one-round status gets its full first round", () => {
    const world = fightWorld();
    world.game.crawler!.statuses = [{ id: "bleeding", remaining: 1, stacks: 1, fresh: true }];
    forceDice(3, 5, 5); // bleed tick, then the rat's bite
    const { world: w } = engine.step(world, { type: "wait" });
    expect(w.game.crawler!.statuses).toEqual([{ id: "bleeding", remaining: 1, stacks: 1, fresh: false }]);
  });

  it("the floor's first fights are small packs from the easy pool, even in a lair", () => {
    const enc = content.floors.all.find((t) => t.floor === 1)!.encounters;
    for (let n = 0; n < 20; n++) {
      let { world } = engine.newWorld();
      ({ world } = engine.step(world, { type: "accept" }));
      world.game.crawler!.hp = 500;
      const ctx = new StepContext(world, content);
      const room = { ...world.game.floor!.rooms[0]!, type: "lair" as const };
      expect(maybeEncounter(ctx, room, true)).toBe(true);
      const foes = ctx.game.combat!.enemies;
      expect(foes.length).toBeLessThanOrEqual(enc.easyPack[1]);
      expect(foes.every((e) => e.tier === "minion" && enc.easyPool.includes(e.familyId))).toBe(true);
      expect(ctx.game.floor!.fights).toBe(1);
    }
  });

  it("after the easy fights, lair rooms start an elite fight on first entry", () => {
    let { world } = engine.newWorld();
    ({ world } = engine.step(world, { type: "accept" }));
    world.game.crawler!.hp = 500; // the ambush round is live dice; don't let it flake the test
    world.game.floor!.fights = 3;
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
    forceDice(1, 1); // retry: the swing's 2d10 — and no second poison roll
    const r2 = engine.step(r1.world, { type: "attack", target: "plain" });
    expect(r2.world.game.crawler!.hp).toBe(31);
    expect(r2.world.game.combat!.ap).toBe(1);
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

  it("saves from before the AP and power-roll rework are discarded, the account survives", () => {
    const { world } = engine.newWorld();
    expect(engine.restore({ ...world.game, version: 4 }, world.account)).toBeNull();
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
