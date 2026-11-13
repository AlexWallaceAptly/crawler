import { clone } from "./clone";
import type { Action, ActionType } from "./actions";
import type { Content } from "./content/load";
import type { GameEvent, GameEventBody } from "./events";
import { generateCrawler, introContext } from "./gen/backstory";
import { generateFloor } from "./gen/floor";
import { advanceTime, clearFloor, enterRoom, formatTimer, renderMap, TIME_COST } from "./explore";
import { narrate } from "./narrate/narrator";
import { derive } from "./rules/derived";
import { LOG_LIMIT, type Crawler, type FloorState, type Phase, type Room, type World } from "./state";

export interface StepResult {
  world: World;
  events: GameEvent[];
}

/** Mutable working context for one step. Handlers mutate `world` (a private clone). */
export class StepContext {
  readonly events: GameEventBody[] = [];
  constructor(public world: World, public readonly content: Content) {}

  get game() {
    return this.world.game;
  }
  get account() {
    return this.world.account;
  }
  /** The current crawler; throws if there is none (handlers check phase first). */
  get crawler(): Crawler {
    const c = this.world.game.crawler;
    if (!c) throw new Error("no crawler");
    return c;
  }

  emit(e: GameEventBody): void {
    this.events.push(e);
  }
  /** System AI line from a narration template. */
  say(key: string, data: object = {}): void {
    const ctx = { crawler: this.world.game.crawler, mood: this.world.game.narrator.mood, ...data };
    this.emit({ type: "narration", voice: "system", key, text: narrate(this.content, this.world.game.narrator, key, ctx) });
  }
  /** Plain narrator voice (room descriptions etc). */
  describe(text: string): void {
    this.emit({ type: "narration", voice: "narrator", text });
  }
  info(text: string, lines?: string[]): void {
    this.emit(lines ? { type: "info", text, lines } : { type: "info", text });
  }
  error(text: string): void {
    this.emit({ type: "error", text });
  }
  setPhase(to: Phase): void {
    const from = this.game.phase;
    if (from === to) return;
    this.game.phase = to;
    this.emit({ type: "phaseChanged", from, to });
  }
}

type Handler<A extends Action = Action> = {
  phases: Phase[] | "any";
  run: (ctx: StepContext, action: A) => void;
};
type Handlers = { [T in ActionType]: Handler<Extract<Action, { type: T }>> };

export const HELP_LINES = [
  "help                 this list",
  "look                 describe where you are",
  "n / e / s / w        move (also: go north, east, ...)",
  "map                  the floor so far",
  "search               search the room (15 min)",
  "rest                 catch your breath (1 hour, heals a little)",
  "sleep                safe rooms only (8 hours, full heal)",
  "descend              take a stairwell down, ending the floor",
  "accept / reroll      during crawler creation",
  "abandon              end this crawler's run (asks to confirm)",
  "new                  start the next crawler after death",
];

function startNewCrawler(ctx: StepContext): void {
  const crawler = generateCrawler(ctx.content);
  ctx.game.crawler = crawler;
  ctx.game.floor = null;
  ctx.game.turn = 0;
  ctx.game.clock = 0;
  ctx.setPhase("creation");
  ctx.emit({ type: "crawlerCreated", name: crawler.name });
  const intro = introContext(crawler, ctx.content);
  ctx.say("crawler.intro", intro);
  ctx.say("crawler.statJab", intro);
}

const handlers: Handlers = {
  newCrawler: {
    phases: ["dead"],
    run(ctx) {
      if (ctx.game.turn > 0 || ctx.account.runs > 0) ctx.say("run.newCrawler");
      startNewCrawler(ctx);
    },
  },
  reroll: {
    phases: ["creation"],
    run(ctx) {
      if (ctx.account.rerolls <= 0) {
        ctx.say("crawler.noRerolls");
        return;
      }
      ctx.account.rerolls -= 1;
      ctx.say("crawler.reroll");
      startNewCrawler(ctx);
    },
  },
  accept: {
    phases: ["creation"],
    run(ctx) {
      ctx.account.runs += 1;
      ctx.say("crawler.accepted");
      ctx.setPhase("exploring");
      const theme = ctx.content.floors.all.find((t) => t.floor === 1);
      if (!theme) throw new Error("no floor 1 theme in floors.json");
      ctx.game.floor = generateFloor(theme);
      enterRoom(ctx, ctx.game.floor.startRoom, "first");
    },
  },
  look: {
    phases: ["exploring", "combat"],
    run(ctx) {
      const floor = ctx.game.floor;
      if (!floor) {
        ctx.describe("A featureless gray void. Somewhere, a contractor is on lunch break.");
        return;
      }
      enterRoom(ctx, floor.currentRoom, "look");
    },
  },
  go: {
    phases: ["exploring"],
    run(ctx, action) {
      const { floor, room } = here(ctx);
      const dest = room.exits[action.dir];
      if (dest === undefined) {
        ctx.say("explore.blocked", { dir: action.dir });
        return;
      }
      advanceTime(ctx, TIME_COST.move);
      if (ctx.game.phase === "dead") return; // the floor ran out mid-step
      enterRoom(ctx, dest, floor.rooms[dest]!.visited ? "revisit" : "first");
    },
  },
  map: {
    phases: ["exploring"],
    run(ctx) {
      const { floor } = here(ctx);
      const theme = ctx.content.floors.get(floor.theme);
      const explored = floor.rooms.filter((r) => r.visited).length;
      ctx.info(
        `${theme.name} — ${explored}/${floor.rooms.length} rooms, collapse in ${formatTimer(floor.timeLeft)}`,
        [...renderMap(floor), "", "@ you   · visited   ? seen   S safe   > stairs"],
      );
    },
  },
  search: {
    phases: ["exploring"],
    run(ctx) {
      const { room } = here(ctx);
      advanceTime(ctx, TIME_COST.search);
      if (ctx.game.phase === "dead") return;
      room.searched = true;
      ctx.say("explore.searchNothing");
    },
  },
  rest: {
    phases: ["exploring"],
    run(ctx) {
      advanceTime(ctx, TIME_COST.rest);
      if (ctx.game.phase === "dead") return;
      const c = ctx.crawler;
      const d = derive(c, ctx.content);
      c.hp = Math.min(d.maxHP, c.hp + Math.ceil(d.maxHP * 0.25));
      c.mp = Math.min(d.maxMP, c.mp + Math.ceil(d.maxMP * 0.25));
      ctx.say("explore.rest");
    },
  },
  sleep: {
    phases: ["exploring"],
    run(ctx) {
      const { room } = here(ctx);
      if (room.type !== "safe") {
        ctx.say("explore.sleepRefused");
        return;
      }
      advanceTime(ctx, TIME_COST.sleep);
      if (ctx.game.phase === "dead") return; // slept straight through the collapse
      const c = ctx.crawler;
      const d = derive(c, ctx.content);
      c.hp = d.maxHP;
      c.mp = d.maxMP;
      ctx.say("explore.sleep");
    },
  },
  descend: {
    phases: ["exploring"],
    run(ctx) {
      const { room } = here(ctx);
      if (room.type !== "stairwell") {
        ctx.say("explore.descendRefused");
        return;
      }
      clearFloor(ctx);
    },
  },
  help: {
    phases: "any",
    run(ctx) {
      ctx.info("Commands:", HELP_LINES);
    },
  },
  abandon: {
    phases: ["creation", "exploring", "combat"],
    run(ctx, action) {
      if (!action.confirm) {
        ctx.say("abandon.confirm");
        return;
      }
      killCrawler(ctx, "quit");
    },
  },
};

export function killCrawler(ctx: StepContext, cause: string, key = "died"): void {
  ctx.account.deaths += 1;
  ctx.say(key, { cause });
  ctx.emit({ type: "died", cause });
  ctx.setPhase("dead");
}

/** Current floor and room; handlers that require them are gated to the exploring phase. */
function here(ctx: StepContext): { floor: FloorState; room: Room } {
  const floor = ctx.game.floor;
  if (!floor) throw new Error("exploring with no floor");
  return { floor, room: floor.rooms[floor.currentRoom]! };
}

export function isAllowed(world: World, type: ActionType): boolean {
  const h = handlers[type];
  return h.phases === "any" || h.phases.includes(world.game.phase);
}

/** Apply events to the world's log, assigning ids. Mutates `world`. */
export function commitEvents(world: World, bodies: GameEventBody[]): GameEvent[] {
  const events = bodies.map((b) => ({ ...b, id: world.game.nextEventId++ }) as GameEvent);
  world.game.log.push(...events);
  if (world.game.log.length > LOG_LIMIT) world.game.log.splice(0, world.game.log.length - LOG_LIMIT);
  return events;
}

/**
 * The reducer: step(world, action) -> { world, events }.
 * The input world is never mutated.
 */
export function step(world: World, action: Action, content: Content, echo?: string): StepResult {
  const draft = clone(world);
  const ctx = new StepContext(draft, content);
  if (echo) ctx.emit({ type: "command", text: echo });
  const handler = handlers[action.type] as Handler;
  if (handler.phases !== "any" && !handler.phases.includes(draft.game.phase)) {
    ctx.say("command.notNow", { verb: action.type });
  } else {
    handler.run(ctx, action);
    if (action.type !== "help") draft.game.turn += 1;
  }
  ctx.emit({ type: "stateChanged" });
  return { world: draft, events: commitEvents(draft, ctx.events) };
}
