/**
 * Moving things around the arena: speeds, walking a path (hazards fire on every
 * tile you step into), standing in something nasty, keeping the per-enemy range
 * band in sync with tile distance, and the one positional rule (the pack bonus).
 */
import { damageCrawler, damageEnemy } from "../combat";
import type { Content } from "../content/load";
import { rollDice } from "../rules/dice";
import { collectModifiers, modTotal } from "../rules/derived";
import { applyStatus, hasFlag } from "../rules/effects";
import { chance } from "../rng";
import type { StepContext } from "../step";
import type { ArenaHazard, ArenaState, Crawler, Enemy, Pos } from "../state";
import { bandOf, coord, dist, hazardAt, same, stepCost } from "./geometry";
import { igniteUnder } from "./fire";

/** Tiles the crawler gets per AP spent moving. Slow and haste change your AP, not this. */
export const CRAWLER_SPEED = 4;

export function speedOf(c: Crawler, content: Content): number {
  return Math.max(1, CRAWLER_SPEED + modTotal(collectModifiers(c, content), "speed"));
}

export function crawlerSpeed(ctx: StepContext): number {
  return speedOf(ctx.crawler, ctx.content);
}

/** Tiles an enemy gets per AP spent moving. */
export function enemySpeed(ctx: StepContext, e: Enemy): number {
  if (hasFlag(e.statuses, ctx.content, "noMove")) return 0;
  return e.speed;
}

export function arenaOf(ctx: StepContext): ArenaState {
  const a = ctx.game.combat?.arena;
  if (!a) throw new Error("grid action without an arena");
  return a;
}

/** Re-derive every enemy's band from its tile distance to the crawler. */
export function syncBands(ctx: StepContext): void {
  const combat = ctx.game.combat;
  const a = combat?.arena;
  if (!combat || !a) return;
  for (const e of combat.enemies) if (e.pos) e.range = bandOf(dist(e.pos, a.crawler));
}

type Mover = "crawler" | Enemy;

function stillStanding(ctx: StepContext, who: Mover): boolean {
  if (ctx.game.phase !== "combat") return false;
  return who === "crawler" ? ctx.crawler.hp > 0 : who.hp > 0;
}

/**
 * Walk `path` tile by tile, paying movement from `budget`. Each tile entered fires
 * its hazard. Stops early on death, a stun, or when the budget runs out.
 * Returns movement spent.
 */
export function walk(ctx: StepContext, who: Mover, path: Pos[], budget: number): number {
  const a = arenaOf(ctx);
  let spent = 0;
  for (const p of path) {
    const cost = stepCost(a, ctx.content, p);
    if (spent + cost > budget) break;
    spent += cost;
    if (who === "crawler") a.crawler = { ...p };
    else who.pos = { ...p };
    const h = hazardAt(a, p);
    if (h) triggerHazard(ctx, who, h, "enter");
    if (!stillStanding(ctx, who)) break;
    igniteUnder(ctx, who); // burning feet on oil
    if (!stillStanding(ctx, who)) break;
    const statuses = who === "crawler" ? ctx.crawler.statuses : who.statuses;
    if (hasFlag(statuses, ctx.content, "skipTurn")) break;
  }
  syncBands(ctx);
  return spent;
}

/** Start-of-turn: whoever is standing in a hazard with a `stay` effect gets it. */
export function standInHazard(ctx: StepContext, who: Mover): void {
  const a = arenaOf(ctx);
  const at = who === "crawler" ? a.crawler : who.pos;
  if (!at) return;
  const h = hazardAt(a, at);
  if (h) triggerHazard(ctx, who, h, "stay");
  if (ctx.game.phase === "combat") igniteUnder(ctx, who);
}

export function triggerHazard(ctx: StepContext, who: Mover, h: ArenaHazard, when: "enter" | "stay"): void {
  const def = ctx.content.arenaFeatures.byId[h.id];
  const eff = def?.[when];
  if (!def || !eff) return;
  const a = arenaOf(ctx);
  if (def.consumedOnTrigger) a.hazards.splice(a.hazards.indexOf(h), 1);
  const verb = when === "enter" ? "steps into" : "is standing in";
  if (who === "crawler") {
    const dmg = eff.dice ? rollDice(eff.dice).total : 0;
    if (dmg > 0) {
      const taken = damageCrawler(ctx, dmg, eff.damageType, `a ${def.name.toLowerCase()}`);
      if (ctx.game.phase !== "combat") return;
      ctx.fight(`You ${when === "enter" ? "step into" : "are standing in"} the ${def.name.toLowerCase()}: ${taken} ${eff.damageType} damage. You: ${ctx.crawler.hp} HP.`, "status");
    } else {
      ctx.fight(`You ${when === "enter" ? "step into" : "are standing in"} the ${def.name.toLowerCase()}.`, "status");
    }
    if (eff.status && chance(eff.status.chance)) {
      const s = ctx.content.statusEffects.get(eff.status.id);
      if (applyStatus(ctx.crawler.statuses, s, eff.status.duration) !== "ignored") ctx.fight(`You are ${s.name.toLowerCase()}.`, "status");
    }
    return;
  }
  const dmg = eff.dice ? rollDice(eff.dice).total : 0;
  if (dmg > 0) damageEnemy(ctx, who, dmg, `The ${who.name} ${verb} the ${def.name.toLowerCase()}`);
  else ctx.fight(`The ${who.name} ${verb} the ${def.name.toLowerCase()}.`, "status");
  if (who.hp > 0 && eff.status && chance(eff.status.chance)) {
    const s = ctx.content.statusEffects.get(eff.status.id);
    if (applyStatus(who.statuses, s, eff.status.duration) !== "ignored") ctx.fight(`The ${who.name} is ${s.name.toLowerCase()}.`, "status");
  }
}

/**
 * The one positional rule: an enemy swinging at you in melee gets an edge (+2 on
 * its power roll) for each OTHER enemy also standing next to you, up to two.
 * Backing into a corner or a doorway matters; being surrounded hurts.
 */
export function packBonus(ctx: StepContext, e: Enemy): number {
  const combat = ctx.game.combat;
  const a = combat?.arena;
  if (!combat || !a || !e.pos || dist(e.pos, a.crawler) > 1) return 0;
  const others = combat.enemies.filter((o) => o !== e && o.hp > 0 && o.pos && dist(o.pos, a.crawler) <= 1).length;
  return Math.min(2, others);
}

/** Burn down placed hazards at the end of a round. */
export function ageHazards(ctx: StepContext): void {
  const a = ctx.game.combat?.arena;
  if (!a) return;
  for (let i = a.hazards.length - 1; i >= 0; i--) {
    const h = a.hazards[i]!;
    if (h.rounds === undefined) continue;
    h.rounds -= 1;
    if (h.rounds <= 0) {
      a.hazards.splice(i, 1);
      ctx.fight(`The ${ctx.content.arenaFeatures.byId[h.id]?.name.toLowerCase() ?? h.id} at ${coord(h)} is gone.`, "status");
    }
  }
}

export function where(p: Pos | undefined): string {
  return p ? coord(p) : "?";
}

export { same };
