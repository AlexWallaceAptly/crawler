/**
 * Show events (Milestone 6c): 2-4 per floor, scheduled at generation so a floor is the
 * same every time you ask, and fired from the single clock (advanceTime → runEvents).
 * Announced in advance into the Guide's event log; never a modal.
 */
import { emitDamageTaken } from "./counters";
import type { Content } from "./content/load";
import type { FloorTheme } from "./content/schemas";
import { chance, int, pick, random, shuffle, weightedKey } from "./rng";
import { derive } from "./rules/derived";
import type { FloorState, Room, ShowEvent, ShowEventType } from "./state";
import { guideAdd } from "./guide";
import { MINUTES_PER_DAY, bfsDistances } from "./gen/floor";
import { generateItem, itemLevelFor } from "./gen/item";
import { rollLoot } from "./gen/loot";
import { addToPile } from "./inventory";
import type { StepContext } from "./step";
import { killCrawler } from "./step";
import { enterRoom } from "./explore";

const ordinary = (floor: FloorState, r: Room) =>
  r.id !== floor.startRoom && r.type !== "safe" && r.type !== "stairwell" && !r.boss;

/**
 * A section that can close without cutting anything off: the rooms near a seed, so long as
 * every other room stays connected to the start (stairwells and safe rooms are never in it).
 */
function closableSection(floor: FloorState, radius: number, avoid: Set<number>): number[] | null {
  const candidates = shuffle(floor.rooms.filter((r) => ordinary(floor, r) && !avoid.has(r.id)));
  for (const seed of candidates.slice(0, 40)) {
    const d = bfsDistances(floor.rooms, seed.id);
    const region = floor.rooms.filter((r) => d[r.id]! >= 0 && d[r.id]! <= radius && ordinary(floor, r) && !avoid.has(r.id)).map((r) => r.id);
    const gone = new Set(region);
    const seen = new Set<number>([floor.startRoom]);
    const queue = [floor.startRoom];
    while (queue.length) {
      for (const next of Object.values(floor.rooms[queue.shift()!]!.exits)) {
        if (!gone.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    if (seen.size === floor.rooms.length - gone.size) return region;
  }
  return null;
}

export function scheduleEvents(floor: FloorState, theme: FloorTheme, content: Content): void {
  const cfg = content.pacing.events;
  const total = Math.round(theme.days * MINUTES_PER_DAY);
  const wanted = int(cfg.min, Math.max(cfg.min, cfg.max));
  const events: ShowEvent[] = [];
  const avoid = new Set<number>();
  const base = (type: ShowEventType): ShowEvent => ({
    id: `${type}${events.length + 1}`, type, announceAt: 0, startAt: 0, endAt: total,
    announced: false, started: false, ended: false, rooms: [],
  });
  const at = (from: number, to: number) => Math.round((from + (to - from) * random()) * total);

  const make = (type: ShowEventType): boolean => {
    const e = base(type);
    if (type === "reward") {
      const room = pick(floor.rooms.filter((r) => ordinary(floor, r) && !avoid.has(r.id)));
      e.rooms = [room.id];
      e.startAt = at(0.15, 0.7);
      e.announceAt = Math.max(0, e.startAt - cfg.rewardLeadMin);
      e.endAt = e.startAt + cfg.rewardLengthMin;
    } else if (type === "closing") {
      const region = closableSection(floor, cfg.closingRadius, avoid);
      if (!region) return false;
      e.rooms = region;
      for (const id of region) avoid.add(id);
      e.startAt = at(cfg.closingFromPct, cfg.closingToPct);
      e.announceAt = Math.max(0, e.startAt - cfg.closingLeadMin);
    } else if (type === "surge") {
      if (total < 2 * MINUTES_PER_DAY) return false;
      e.startAt = total - MINUTES_PER_DAY;
      e.announceAt = Math.max(0, e.startAt - cfg.surgeLeadMin);
    } else {
      e.startAt = e.announceAt = at(0.1, 0.85);
      e.effect = pick(cfg.announceEffects);
      if (e.effect === "hint") {
        const stair = floor.rooms.filter((r) => r.type === "stairwell" && !r.concealed && !r.boss);
        if (stair.length === 0) e.effect = "heal";
        else e.rooms = [pick(stair).id];
      }
    }
    events.push(e);
    return true;
  };

  make("reward");
  // Every floor gives a reason to leave early: a section that closes, or a last-day surge.
  if (!make(chance(0.5) ? "closing" : "surge") && !make("closing")) make("surge");
  const weights = (): Record<string, number> => {
    const w = { ...cfg.weights };
    if (events.some((e) => e.type === "surge")) delete w.surge;
    if (events.filter((e) => e.type === "closing").length >= 2) delete w.closing;
    return w;
  };
  for (let guard = 0; events.length < wanted && guard < 20; guard++) make(weightedKey<ShowEventType>(weights() as Record<ShowEventType, number>));
  events.sort((a, b) => a.announceAt - b.announceAt);
  floor.events = events;
}

const roomName = (floor: FloorState, id: number | undefined) => (id === undefined ? "somewhere" : floor.rooms[id]!.name);
const fill = (text: string, data: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ""));

function log(ctx: StepContext, e: ShowEvent, stage: string, data: Record<string, string | number> = {}): void {
  const floor = ctx.game.floor!;
  const key = `${e.type === "announcement" ? e.effect : e.type}.${stage}`;
  const text = fill(ctx.content.pacing.eventText[key] ?? "", { room: roomName(floor, e.rooms[0]), ...data });
  if (!text) return;
  guideAdd(ctx.game, `event.${floor.floor}.${e.id}.${stage}`, "events", `${e.type === "announcement" ? "Announcement" : e.type[0]!.toUpperCase() + e.type.slice(1)}: ${stage}`, text);
  ctx.info("The System AI has an announcement. (Guide: events)");
}

/** Fired from advanceTime: announce, start and end whatever's due. */
export function runEvents(ctx: StepContext): void {
  const floor = ctx.game.floor;
  if (!floor || ctx.game.phase === "dead") return;
  const elapsed = ctx.game.clock - floor.startClock;
  for (const e of floor.events) {
    if (!e.announced && elapsed >= e.announceAt) {
      e.announced = true;
      if (e.type !== "announcement") log(ctx, e, "announce");
    }
    if (!e.started && elapsed >= e.startAt) {
      e.started = true;
      startEvent(ctx, floor, e);
    }
    if (e.started && !e.ended && elapsed >= e.endAt && e.type === "reward") {
      e.ended = true;
      endReward(floor, e);
      log(ctx, e, "end");
    }
  }
}

function startEvent(ctx: StepContext, floor: FloorState, e: ShowEvent): void {
  const c = ctx.game.crawler;
  if (e.type === "reward") {
    const room = floor.rooms[e.rooms[0]!]!;
    const theme = ctx.content.floors.get(floor.theme);
    const table = theme.loot.rooms.treasure?.table;
    const drops = [generateItem(ctx.content, itemLevelFor(floor.floor) + 1, { floor: floor.floor })];
    if (table) drops.push(rollLoot(ctx.content.lootTables.get(table), ctx.content, floor.floor));
    room.items ??= [];
    e.items = [];
    for (const it of drops) {
      it.sponsor = true;
      it.plain = true;
      addToPile(room.items, it);
      e.items.push(it.uid);
    }
    room.marked = true;
    room.seen = true;
    log(ctx, e, "start");
  } else if (e.type === "closing") {
    for (const id of e.rooms) floor.rooms[id]!.closed = true;
    e.ended = true;
    log(ctx, e, "start");
  } else if (e.type === "surge") {
    floor.surge = true;
    e.ended = true;
    for (const r of floor.rooms) {
      if (!ordinary(floor, r) || r.closed || !chance(ctx.content.pacing.events.surgeExtraGroupsPct)) continue;
      r.rs.groups.push({ kind: "pack" });
      r.rs.cleared = false;
    }
    log(ctx, e, "start");
  } else {
    e.ended = true;
    const cfg = ctx.content.pacing.events;
    if (e.effect === "hint") floor.rooms[e.rooms[0]!]!.marked = true;
    else if (e.effect === "heal" && c) {
      const max = derive(c, ctx.content).maxHP;
      c.hp = Math.min(max, c.hp + Math.ceil(max * cfg.announceHealPct));
    } else if (e.effect === "debuff" && c) c.awakeMin = (c.awakeMin ?? 0) + cfg.announceDebuffMinutes;
    log(ctx, e, "announce", { pct: Math.round(cfg.announceHealPct * 100), minutes: cfg.announceDebuffMinutes });
  }
}

function endReward(floor: FloorState, e: ShowEvent): void {
  const room = floor.rooms[e.rooms[0]!]!;
  const mine = new Set(e.items ?? []);
  if (room.items) room.items = room.items.filter((it) => !(it.sponsor && mine.has(it.uid)));
  if (room.items && room.items.length === 0) delete room.items;
  room.marked = false;
}

/** The crawler is standing in a section that just closed: thrown out to the nearest open room, bruised. */
export function pushOutOfClosedRoom(ctx: StepContext): boolean {
  const floor = ctx.game.floor;
  if (!floor || ctx.game.phase !== "exploring") return false;
  const here = floor.rooms[floor.currentRoom]!;
  if (!here.closed) return false;
  const d = bfsDistances(floor.rooms, here.id);
  const exit = floor.rooms.filter((r) => !r.closed && d[r.id]! > 0).sort((a, b) => d[a.id]! - d[b.id]!)[0];
  if (!exit) return false;
  const c = ctx.crawler;
  const dmg = Math.max(1, Math.ceil(derive(c, ctx.content).maxHP * ctx.content.pacing.events.closingDamagePct));
  c.hp -= dmg;
  emitDamageTaken(ctx, dmg, "show", "a closing section");
  ctx.describe(fill(ctx.content.pacing.eventText["closing.pushed"] ?? "", { damage: dmg }));
  if (c.hp <= 0) { killCrawler(ctx, "a closing section"); return true; }
  enterRoom(ctx, exit.id, "revisit");
  return true;
}
