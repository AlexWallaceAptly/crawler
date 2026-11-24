/**
 * Death and the account (Milestone 8). A run ends three ways: the crawler dies, quits, or descends
 * past the last built floor. `endRun` marks it; `finishRun` runs at the very end of the step (after
 * the death's own achievements have fired) and pays the account:
 *
 *   legacy = 10 × deepest floor + 2 × achievements + 5 × bosses killed   (+ what legacy achievements paid)
 *
 * Quitting pays nothing for floors (or "accept, abandon" would print points). Then, while the
 * crawler lies there, the player can leave one non-legendary item for the next one (`bequeath`),
 * which turns up in a Floor 1 safe room, and spend legacy points on unlocks (`unlock`): backstory
 * rerolls, backstory pools and starting-kit choices (`kit`).
 */
import { clone } from "./clone";
import type { Content } from "./content/load";
import type { Unlock } from "./content/schemas";
import { bfsDistances } from "./gen/floor";
import { itemFromRef } from "./gen/item";
import { guideAdd } from "./guide";
import { addToPile, findItems } from "./inventory";
import { uid } from "./rng";
import { recordRun } from "./echo";
import type { AccountState, Crawler, FloorState, ItemInstance, LegacyTally, RunEnd, World } from "./state";
import type { StepContext } from "./step";

export const LEGACY = { perFloor: 10, perAchievement: 2, perBoss: 5 } as const;

// ---------------------------------------------------------------- the end of a run

/** Mark the run as over. The points are worked out by `finishRun`, after this step's achievements. */
export function endRun(ctx: StepContext, kind: RunEnd["kind"], cause: string, floor: number): void {
  ctx.game.ended = { kind, cause, floor };
}

/** Legacy points to the account, with an event the counters and the log can see. */
export function addLegacy(ctx: StepContext, amount: number, why: string): void {
  if (amount <= 0) return;
  ctx.account.legacyPoints += amount;
  ctx.account.legacyEarned = (ctx.account.legacyEarned ?? 0) + amount;
  ctx.emit({ type: "legacyEarned", amount, points: ctx.account.legacyPoints, why });
}

/** The run's legacy points, from the crawler as it ended. */
export function legacyTally(end: RunEnd, c: Crawler, bonus: number): LegacyTally {
  const deepest = end.kind === "descended" ? end.floor + 1 : end.floor;
  const floors = end.kind === "quit" ? 0 : LEGACY.perFloor * deepest;
  const achievementCount = c.achievements.length;
  const bossKills = c.counters["kills.boss"] ?? 0;
  const achievements = LEGACY.perAchievement * achievementCount;
  const bosses = LEGACY.perBoss * bossKills;
  return { deepest, floors, achievements, achievementCount, bosses, bossKills, bonus, total: floors + achievements + bosses + bonus };
}

const OUTCOME: Record<RunEnd["kind"], (end: RunEnd) => string> = {
  died: (e) => `died: ${e.cause}`,
  quit: () => "quit",
  descended: (e) => e.cause,
};

/** End of a step in which the run ended: pay the account, write the history line, and say what's next. */
export function finishRun(ctx: StepContext): void {
  const end = ctx.game.ended;
  const c = ctx.game.crawler;
  if (!end || end.legacy || !c) return;
  const tally = legacyTally(end, c, ctx.game.legacyBonus ?? 0);
  end.legacy = tally;
  addLegacy(ctx, tally.total - tally.bonus, "the run");
  recordRun(ctx, OUTCOME[end.kind](end), end.floor, tally.total);
  ctx.emit({ type: "runEnded", kind: end.kind, cause: end.cause, floor: end.floor, legacy: tally.total, points: ctx.account.legacyPoints });
  ctx.say("run.legacy", { ...tally, kind: end.kind, points: ctx.account.legacyPoints });
  ctx.info("Legacy points:", tallyLines(tally, ctx.account.legacyPoints));
  const candidates = bequestCandidates(c);
  if (candidates.length) {
    ctx.say("bequest.prompt");
    ctx.info("Leave one thing for the next crawler (`bequeath <item>`, or `bequeath nothing`):",
      candidates.slice(0, 8).map((it) => `  ${it.name}${it.rarity !== "common" ? ` (${it.rarity})` : ""}`));
  }
  const affordable = unlockViews(ctx.content, ctx.account).filter((u) => u.canBuy);
  ctx.info(affordable.length
    ? `${affordable.length} unlock${affordable.length === 1 ? "" : "s"} within reach: \`unlocks\` to look, \`unlock <name>\` to buy. Then \`new\`.`
    : "Nothing you can afford yet (`unlocks` to see the list). `new` when you're ready.");
}

export function tallyLines(t: LegacyTally, points: number): string[] {
  return [
    `  Floors reached ${t.deepest} × ${LEGACY.perFloor}  ${t.floors}${t.floors === 0 && t.deepest > 0 ? " (quitters don't get paid for floors)" : ""}`,
    `  Achievements ${t.achievementCount} × ${LEGACY.perAchievement}  ${t.achievements}`,
    `  Bosses killed ${t.bossKills} × ${LEGACY.perBoss}  ${t.bosses}`,
    ...(t.bonus ? [`  Paid by achievements  ${t.bonus}`] : []),
    `  This run: ${t.total}. On the account: ${points}.`,
  ];
}

// ---------------------------------------------------------------- the bequest

/** What a dead crawler can leave behind: anything that isn't legendary, most valuable first. */
export function bequestCandidates(c: Crawler): ItemInstance[] {
  return c.inventory.filter((it) => it.rarity !== "legendary").slice().sort((a, b) => b.value - a.value);
}

const NOTHING = new Set(["none", "nothing", "no", "nobody"]);

/** `bequeath <item>`: one item (one of a stack) for the next crawler's Floor 1. Replaces an earlier pick. */
export function bequeath(ctx: StepContext, what: string): void {
  const end = ctx.game.ended;
  const c = ctx.game.crawler;
  if (!end || !c) {
    ctx.error("Nobody's dead yet. Bequests are for the deceased.");
    return;
  }
  const q = what.trim().toLowerCase();
  if (NOTHING.has(q)) {
    if (ctx.account.bequest?.run === ctx.account.runs && ctx.account.bequest.from === c.name) ctx.account.bequest = null;
    delete end.bequeathed;
    ctx.say("bequest.cleared");
    return;
  }
  const n = /^\d+$/.test(q) ? Number(q) : NaN;
  const item = Number.isInteger(n) ? bequestCandidates(c)[n - 1] : findItems(c.inventory, q)[0];
  if (!item) {
    ctx.error(`${c.name} wasn't carrying anything like "${what}".`);
    return;
  }
  if (item.rarity === "legendary") {
    ctx.say("bequest.legendary", { item: item.name });
    return;
  }
  const kept: ItemInstance = { ...clone(item), qty: 1, plain: true, heirloom: { from: c.name, run: ctx.account.runs, cause: end.cause } };
  delete kept.searchDc;
  delete kept.sponsor;
  ctx.account.bequest = { item: kept, from: c.name, run: ctx.account.runs, cause: end.cause };
  end.bequeathed = item.name;
  ctx.emit({ type: "bequeathed", item: item.name });
  ctx.say("bequest.set", { item: item.name });
}

/**
 * Floor 1: the last crawler's bequest goes into a safe room, the second-nearest to the entrance
 * (the nearest has the tutorial kit), in plain sight. Once placed it's off the account: walk past
 * it, or leave the floor without it, and it's gone.
 */
export function placeBequest(ctx: StepContext, floor: FloorState): void {
  const b = ctx.account.bequest;
  if (!b || floor.floor !== 1) return;
  const fromStart = bfsDistances(floor.rooms, floor.startRoom);
  const safes = floor.rooms.filter((r) => r.type === "safe").sort((x, y) => fromStart[x.id]! - fromStart[y.id]!);
  const room = safes[1] ?? safes[0];
  if (!room) return;
  const item: ItemInstance = { ...b.item, uid: uid("it") };
  (room.items ??= []).push(item);
  floor.bequest = { room: room.id, name: item.name, from: b.from };
  ctx.account.bequest = null;
  const hops = fromStart[room.id] ?? 0;
  ctx.say("bequest.waiting", { item: item.name, from: b.from, cause: b.cause, hops });
  guideAdd(ctx.game, "bequest", "rooms", "A bequest",
    `${b.from} (run ${b.run}, ${b.cause === "quit" ? "who quit" : `killed by ${b.cause}`}) left you ${item.name}. It's in the safe room ${hops} room${hops === 1 ? "" : "s"} from the entrance. Take it before you leave the floor, or it's gone.`);
}

// ---------------------------------------------------------------- unlocks and kits

export interface UnlockView {
  id: string;
  name: string;
  kind: Unlock["kind"];
  cost: number;
  text: string;
  owned: boolean;
  repeatable: boolean;
  /** You have the points and it isn't already yours. */
  canBuy: boolean;
  /** Kits: what's in it. */
  items: string[];
}

export function unlockViews(content: Content, account: AccountState): UnlockView[] {
  return content.unlocks.all.map((u) => {
    const owned = account.unlocks.includes(u.id);
    return {
      id: u.id, name: u.name, kind: u.kind, cost: u.cost, text: u.text, owned, repeatable: u.repeatable,
      canBuy: (u.repeatable || !owned) && account.legacyPoints >= u.cost,
      items: u.items.map((it) => {
        const name = content.items.bases.byId[it.item]?.name ?? content.items.consumables.byId[it.item]?.name ?? it.item;
        return it.qty > 1 ? `${name} ×${it.qty}` : name;
      }),
    };
  });
}

/** The backstory pools this account rolls from. */
export function unlockedPools(content: Content, account: AccountState): string[] {
  return content.unlocks.all.filter((u) => u.pool && account.unlocks.includes(u.id)).map((u) => u.pool!);
}

function findUnlock(content: Content, what: string, among: Unlock[] = content.unlocks.all): Unlock | undefined {
  const q = what.trim().toLowerCase();
  if (/^\d+$/.test(q)) return among[Number(q) - 1];
  return among.find((u) => u.id === q || u.name.toLowerCase() === q)
    ?? among.find((u) => u.name.toLowerCase().startsWith(q))
    ?? among.find((u) => u.name.toLowerCase().includes(q) || u.id.includes(q.replace(/ /g, "_")));
}

/** `unlocks`: the list, with costs and what you own. Free, any time. */
export function showUnlocks(ctx: StepContext): void {
  const views = unlockViews(ctx.content, ctx.account);
  const kit = kitFor(ctx.content, ctx.account);
  ctx.info(`Unlocks (${ctx.account.legacyPoints} legacy point${ctx.account.legacyPoints === 1 ? "" : "s"}; buy between runs with \`unlock <name>\`):`, [
    ...views.map((u, i) => {
      const status = u.owned && !u.repeatable ? "owned" : `${u.cost} pts${u.canBuy ? "" : " (can't afford)"}`;
      const extra = u.kind === "reroll" ? ` · you have ${ctx.account.rerolls}` : u.kind === "kit" ? ` · ${u.items.join(", ")}` : "";
      return `  ${i + 1}. ${u.name} [${u.kind}] ${status}${extra}`;
    }),
    "",
    `Starting kit: ${kit ? kit.name : "none"}${ownedKits(ctx.content, ctx.account).length ? " (`kit <name>` or `kit none` to change)" : ""}.`,
  ]);
}

/** `unlock <name>`: spend legacy points. Between runs only (while dead, or making a crawler). */
export function buyUnlock(ctx: StepContext, what: string): void {
  const u = findUnlock(ctx.content, what);
  if (!u) {
    ctx.error(`No unlock called "${what}". \`unlocks\` lists them.`);
    return;
  }
  const a = ctx.account;
  if (!u.repeatable && a.unlocks.includes(u.id)) {
    ctx.say("unlock.owned", { name: u.name });
    return;
  }
  if (a.legacyPoints < u.cost) {
    ctx.say("unlock.broke", { name: u.name, cost: u.cost, points: a.legacyPoints, short: u.cost - a.legacyPoints });
    return;
  }
  a.legacyPoints -= u.cost;
  if (!a.unlocks.includes(u.id)) a.unlocks.push(u.id);
  if (u.kind === "reroll") a.rerolls += 1;
  if (u.kind === "kit" && (a.kit === undefined || !ownedKit(ctx.content, a, a.kit))) a.kit = u.id;
  ctx.emit({ type: "unlockBought", unlockId: u.id, name: u.name, cost: u.cost, points: a.legacyPoints });
  ctx.say("unlock.bought", { name: u.name, cost: u.cost, points: a.legacyPoints, kind: u.kind });
  if (u.kind === "pool" && ctx.game.phase === "creation") ctx.info("It applies to the next roll: `reroll` to try your luck with it.");
  if (u.kind === "kit") ctx.info(a.kit === u.id ? "Your next crawler starts with it." : "`kit " + u.name.toLowerCase() + "` to take it instead.");
}

function ownedKit(content: Content, account: AccountState, id: string): Unlock | undefined {
  const u = content.unlocks.byId[id];
  return u && u.kind === "kit" && account.unlocks.includes(u.id) ? u : undefined;
}

export function ownedKits(content: Content, account: AccountState): Unlock[] {
  return content.unlocks.all.filter((u) => u.kind === "kit" && account.unlocks.includes(u.id));
}

/** The kit the next crawler takes: the one picked, else the first owned; none if `kit none` or nothing's owned. */
export function kitFor(content: Content, account: AccountState): Unlock | undefined {
  if (account.kit === "none") return undefined;
  return (account.kit ? ownedKit(content, account, account.kit) : undefined) ?? ownedKits(content, account)[0];
}

/** `kit <name>` / `kit none`: which starting-kit unlock the next crawler takes. */
export function chooseKit(ctx: StepContext, what: string): void {
  const owned = ownedKits(ctx.content, ctx.account);
  const q = what.trim().toLowerCase();
  if (!q) {
    const kit = kitFor(ctx.content, ctx.account);
    ctx.info(`Starting kit: ${kit ? kit.name : "none"}.`, owned.length
      ? owned.map((u) => `  ${u.name}: ${u.items.map((i) => (i.qty > 1 ? `${i.item} ×${i.qty}` : i.item)).join(", ")}`)
      : ["  You don't own any. They're unlocks (`unlocks`)."]);
    return;
  }
  if (NOTHING.has(q)) {
    ctx.account.kit = "none";
    ctx.say("kit.chosen", { kit: "nothing" });
    return;
  }
  const u = findUnlock(ctx.content, q, owned);
  if (!u) {
    ctx.error(owned.length ? `You don't own a kit like "${what}". Yours: ${owned.map((k) => k.name).join(", ")}.` : "You don't own any starting kits. They're unlocks: `unlocks`.");
    return;
  }
  ctx.account.kit = u.id;
  ctx.say("kit.chosen", { kit: u.name });
}

/** On `accept`: the chosen kit's items join the pack. */
export function grantKit(ctx: StepContext): void {
  const kit = kitFor(ctx.content, ctx.account);
  if (!kit) return;
  const c = ctx.crawler;
  const names: string[] = [];
  for (const it of kit.items) {
    const item = itemFromRef(ctx.content, it.item, it.qty, 1);
    addToPile(c.inventory, item);
    names.push(it.qty > 1 && item.kind === "consumable" ? `${item.name} ×${it.qty}` : item.name);
  }
  ctx.say("kit.granted", { kit: kit.name, items: names.join(", ") });
}

// ---------------------------------------------------------------- the end-of-run screen

export interface RunEndView {
  kind: RunEnd["kind"];
  cause: string;
  floor: number;
  crawler: string;
  legacy: LegacyTally | null;
  lines: string[];
  points: number;
  bequeathed: string | null;
  /** What can be left (most valuable first), with what `bequeath` should be typed with. */
  candidates: { name: string; rarity: string; value: number; input: string }[];
  /** Something legendary was carried: it can't be left. */
  legendary: string[];
}

export function runEndView(world: World): RunEndView | null {
  const { game, account } = world;
  const end = game.ended;
  const c = game.crawler;
  if (!end || !c || game.phase !== "dead") return null;
  return {
    kind: end.kind,
    cause: end.cause,
    floor: end.floor,
    crawler: c.name,
    legacy: end.legacy ?? null,
    lines: end.legacy ? tallyLines(end.legacy, account.legacyPoints) : [],
    points: account.legacyPoints,
    bequeathed: end.bequeathed ?? null,
    candidates: bequestCandidates(c).map((it, i) => ({ name: it.name, rarity: it.rarity, value: it.value, input: `bequeath ${i + 1}` })),
    legendary: c.inventory.filter((it) => it.rarity === "legendary").map((it) => it.name),
  };
}
