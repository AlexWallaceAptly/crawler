/**
 * Fire on the board. A flammable hazard (an oil slick) catches when open flame (an
 * `ignites` hazard) touches it, when something burning steps onto it, or when fire
 * hits something standing on it. Fire then runs through every touching flammable
 * tile at once: the whole slick goes up. Anyone standing on a tile that catches
 * gets the fire's `enter` effect. Grid fights only; bands have no tiles.
 */
import type { StepContext } from "../step";
import type { ArenaHazard, Enemy, Pos } from "../state";
import { coord, dist, hazardAt, same } from "./geometry";
import { triggerHazard } from "./units";

const BURNING = "burning";

type Mover = "crawler" | Enemy;

function flames(ctx: StepContext, h: ArenaHazard): boolean {
  return !!ctx.content.arenaFeatures.byId[h.id]?.ignites;
}

function flammable(ctx: StepContext, h: ArenaHazard) {
  return ctx.content.arenaFeatures.byId[h.id]?.flammable;
}

/** Light `seeds` (if they're flammable), then spread from every flame to every touching flammable tile. */
export function burn(ctx: StepContext, seeds: Pos[] = []): ArenaHazard[] {
  const a = ctx.game.combat?.arena;
  if (!a) return [];
  const lit: ArenaHazard[] = [];
  const light = (h: ArenaHazard) => {
    const f = flammable(ctx, h)!;
    const into = ctx.content.arenaFeatures.get(f.becomes);
    h.id = into.id;
    const rounds = f.rounds ?? into.rounds;
    if (rounds) h.rounds = rounds;
    else delete h.rounds;
    lit.push(h);
  };
  for (const p of seeds) {
    const h = hazardAt(a, p);
    if (h && flammable(ctx, h)) light(h);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const h of a.hazards) {
      if (!flammable(ctx, h)) continue;
      if (a.hazards.some((f) => f !== h && flames(ctx, f) && dist(f, h) <= 1)) {
        light(h);
        grew = true;
      }
    }
  }
  if (lit.length === 0) return lit;
  const where = lit.map((h) => coord(h));
  ctx.fight(lit.length === 1
    ? `The oil at ${where[0]} catches.`
    : `WHUMP. Fire runs along the slick: ${where.length > 6 ? `${where.slice(0, 6).join(", ")} and ${where.length - 6} more` : where.join(", ")}.`, "status");
  // Whoever's standing in it now is standing in fire.
  for (const h of lit) {
    if (ctx.game.phase !== "combat") break;
    if (same(a.crawler, h)) triggerHazard(ctx, "crawler", h, "enter");
    for (const e of ctx.game.combat!.enemies) if (e.hp > 0 && e.pos && same(e.pos, h)) triggerHazard(ctx, e, h, "enter");
  }
  return lit;
}

/**
 * Something on a flammable tile just took fire, or is burning: the tile catches.
 * `fire` is true when it was hit by fire damage.
 */
export function igniteUnder(ctx: StepContext, who: Mover, fire = false): void {
  const a = ctx.game.combat?.arena;
  if (!a) return;
  const at = who === "crawler" ? a.crawler : who.pos;
  if (!at) return;
  const h = hazardAt(a, at);
  if (!h || !flammable(ctx, h)) return;
  const statuses = who === "crawler" ? ctx.crawler.statuses : who.statuses;
  if (fire || statuses.some((s) => s.id === BURNING)) burn(ctx, [at]);
}
