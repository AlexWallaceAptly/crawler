/**
 * The achievement engine (Milestone 7). Triggers are data (`achievements.json`): an event match,
 * a counter, a state check, or `all`/`any` of those. `settle` runs once at the end of a step:
 *
 *   1. fold the step's events into the counters (`countEvents`),
 *   2. check every achievement not yet earned against those events, the counters and the state,
 *   3. pay out (a box, XP, gold or legacy points), say the System AI's line, move its mood,
 *
 * and repeats on whatever the payouts themselves emitted (a box earned can trip a counter),
 * up to a few passes. Event clauses only look at the events of the batch being checked, so a
 * kill fires "kill" achievements once; counter and state clauses read the current numbers.
 *
 * Achievements are earned per crawler, except the ones whose trigger reads only account-level
 * states (`accountDeaths`, `codexLines`, `vesselsSeen`): those fire once per account, ever.
 * Once a run has been tallied (`game.ended.legacy`), nothing more is earned.
 */
import { ACCOUNT_TRIGGER_STATES, type Achievement, type Condition } from "./content/schemas";
import type { Content } from "./content/load";
import { addLegacy } from "./legacy";
import { countEvents } from "./counters";
import { addGold } from "./economy";
import type { GameEventBody } from "./events";
import { grantBox } from "./boxes";
import { moveMood } from "./mood";
import { render } from "./narrate/narrator";
import { matchWhere } from "./rules/conditions";
import { derive } from "./rules/derived";
import { gainXp } from "./progression";
import { carried } from "./inventory";
import type { AccountState, Crawler, GameState } from "./state";
import type { StepContext } from "./step";

const MAX_PASSES = 4;

/** What `{ state: "..." }` reads. All numbers. */
export function stateView(ctx: StepContext, c: Crawler): Record<string, number> {
  const d = derive(c, ctx.content);
  return {
    hp: c.hp,
    hpPct: Math.round((Math.max(0, c.hp) / d.maxHP) * 100),
    mp: c.mp,
    gold: c.gold,
    level: c.level,
    mood: ctx.game.narrator.mood,
    floor: ctx.game.floor?.floor ?? 0,
    turn: ctx.game.turn,
    clockDays: Math.floor(ctx.game.clock / (60 * 24)),
    inCombat: ctx.game.phase === "combat" ? 1 : 0,
    weightPct: d.carryLimit > 0 ? Math.round((carried(c) / d.carryLimit) * 100) : 0,
    statuses: c.statuses.length,
    spells: Object.keys(c.spells).length,
    recipes: c.recipes?.length ?? 0,
    achievements: c.achievements.length,
    accountDeaths: ctx.account.deaths,
    codexLines: codexLines(ctx.content, ctx.account),
    vesselsSeen: ctx.account.thread.vessels?.length ?? 0,
  };
}

/** Lore lines recorded in the thread Codex: each found shard that one of the lore entries lists. */
export function codexLines(content: Content, account: AccountState): number {
  const found = new Set(account.thread.shards);
  let n = 0;
  for (const e of content.codex.all) if (e.type === "lore") n += e.lines.filter((s) => found.has(s)).length;
  return n;
}

/** Does this trigger read only the account (so it's earned once per account, not per crawler)? */
export function accountScoped(cond: Condition): boolean {
  if ("state" in cond) return (ACCOUNT_TRIGGER_STATES as readonly string[]).includes(cond.state);
  if ("all" in cond) return cond.all.every(accountScoped);
  if ("any" in cond) return cond.any.every(accountScoped);
  return false;
}

interface Eval {
  ctx: StepContext;
  c: Crawler;
  events: readonly GameEventBody[];
  state: Record<string, number>;
  /** The first event that satisfied an event clause, for the text's `{overkill}`-style fields. */
  hit?: GameEventBody;
}

function holds(cond: Condition, ev: Eval): boolean {
  if ("event" in cond) {
    for (const e of ev.events) {
      if (e.type !== cond.event) continue;
      const view = { ...e, crawler: ev.c, floor: ev.state.floor, mood: ev.state.mood };
      if (matchWhere(cond.where, view)) {
        ev.hit ??= e;
        return true;
      }
    }
    return false;
  }
  if ("counter" in cond) return (ev.c.counters[cond.counter] ?? 0) >= cond.gte;
  if ("state" in cond) {
    const v = ev.state[cond.state];
    if (v === undefined) return false;
    return (cond.lte === undefined || v <= cond.lte) && (cond.gte === undefined || v >= cond.gte);
  }
  if ("all" in cond) return cond.all.every((x) => holds(x, ev));
  return cond.any.some((x) => holds(x, ev));
}

/** How a payout reads in the ticker. */
export function rewardText(a: Achievement, ctx: StepContext): string {
  if ("box" in a.reward) {
    const tier = ctx.content.boxes.tiers.find((t) => t.id === (a.reward as { box: string }).box)?.name ?? a.reward.box;
    const type = ctx.content.boxes.types.find((t) => t.id === (a.reward as { boxType: string }).boxType)?.name ?? "";
    return `a ${tier} ${type} box`.replace("  ", " ");
  }
  return rewardLabel(a);
}

function rewardLabel(a: Achievement): string {
  const r = a.reward;
  if ("box" in r) return `${r.box} ${r.boxType} box`;
  if ("xp" in r) return `${r.xp} XP`;
  if ("legacy" in r) return `${r.legacy} legacy points`;
  return `${r.gold} gold`;
}

/** Award one achievement: record it, say the line, move the mood, pay out. */
export function award(ctx: StepContext, a: Achievement, hit?: GameEventBody): void {
  const c = ctx.crawler;
  const firstTime = !c.achievements.includes(a.id);
  ctx.game.achieved[a.id] = (ctx.game.achieved[a.id] ?? 0) + 1;
  if (firstTime) c.achievements.push(a.id);
  if (!ctx.account.codex.achievements.includes(a.id)) ctx.account.codex.achievements.push(a.id);

  const view = { ...(hit ?? {}), crawler: c, name: a.name, mood: ctx.game.narrator.mood, count: ctx.game.achieved[a.id] };
  const text = render(a.text, view);
  const reward = rewardText(a, ctx);
  ctx.emit({ type: "achievementEarned", achievementId: a.id, name: a.name, text, tags: a.tags, reward });
  ctx.say("achievement.earned", { name: a.name, text, reward, group: a.group, tags: a.tags });
  if (a.mood !== 0) moveMood(ctx, a.mood, `achievement: ${a.name}`);

  const r = a.reward;
  if ("box" in r) grantBox(ctx, r.box, r.boxType, `achievement: ${a.name}`);
  else if ("xp" in r) gainXp(ctx, r.xp);
  else if ("legacy" in r) {
    // Straight to the account (a dead crawler can't open a box); counted in the run's tally too.
    addLegacy(ctx, r.legacy, `achievement: ${a.name}`);
    ctx.game.legacyBonus = (ctx.game.legacyBonus ?? 0) + r.legacy;
  } else addGold(ctx, r.gold, `achievement: ${a.name}`);
}

/** Check every achievement against a batch of events. Returns how many fired. */
export function evaluate(ctx: StepContext, events: readonly GameEventBody[]): number {
  const c = ctx.game.crawler;
  if (!c) return 0;
  let fired = 0;
  const state = stateView(ctx, c);
  for (const a of ctx.content.achievements.all) {
    if (!a.repeatable && c.achievements.includes(a.id)) continue;
    if (accountScoped(a.trigger) && ctx.account.codex.achievements.includes(a.id)) continue;
    const ev: Eval = { ctx, c, events, state };
    if (!holds(a.trigger, ev)) continue;
    award(ctx, a, ev.hit);
    fired += 1;
    Object.assign(state, stateView(ctx, c)); // a payout can change gold, level, mood
  }
  return fired;
}

/** End of a step: counters, then achievements, again on whatever the payouts emitted. */
export function settle(ctx: StepContext): void {
  if (!ctx.game.crawler || ctx.game.ended?.legacy) return;
  let from = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const batch = ctx.events.slice(from);
    from = ctx.events.length;
    if (batch.length === 0) break;
    countEvents(ctx.game.crawler, batch);
    evaluate(ctx, batch);
  }
}

/** The Achievements panel: every achievement, with progress for the counter ones. */
export function achievementList(ctx: { content: Content; game: GameState; account?: AccountState }): {
  id: string; name: string; group: string; earned: boolean; times: number; text: string; reward: string; progress?: { have: number; need: number };
}[] {
  const c = ctx.game.crawler;
  return ctx.content.achievements.all.map((a) => {
    const earned = (!!c && c.achievements.includes(a.id)) || (!!ctx.account && accountScoped(a.trigger) && ctx.account.codex.achievements.includes(a.id));
    const hide = a.secret && !earned;
    const t = a.trigger;
    const progress = c && "counter" in t && !earned ? { have: Math.min(c.counters[t.counter] ?? 0, t.gte), need: t.gte } : undefined;
    return {
      id: a.id,
      name: hide ? "???" : a.name,
      group: a.group,
      earned,
      times: ctx.game.achieved[a.id] ?? 0,
      text: hide ? "Secret. Figure it out." : earned ? render(a.text, { crawler: c, name: a.name }) : a.hint ?? "",
      reward: hide ? "?" : rewardLabel(a),
      ...(progress ? { progress } : {}),
    };
  });
}
