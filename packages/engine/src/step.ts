import { clone } from "./clone";
import type { Action, ActionType } from "./actions";
import type { Content } from "./content/load";
import type { GameEvent, GameEventBody } from "./events";
import { generateCrawler, introContext } from "./gen/backstory";
import { narrate } from "./narrate/narrator";
import { LOG_LIMIT, type Crawler, type Phase, type World } from "./state";

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
  "accept / reroll      during crawler creation",
  "abandon              end this crawler's run (asks to confirm)",
  "new                  start the next crawler after death",
];

function startNewCrawler(ctx: StepContext): void {
  const crawler = generateCrawler(ctx.content);
  ctx.game.crawler = crawler;
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
      ctx.say("run.underConstruction");
    },
  },
  look: {
    phases: ["exploring", "combat"],
    run(ctx) {
      ctx.describe("A featureless gray void. Somewhere, a contractor is on lunch break.");
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

export function killCrawler(ctx: StepContext, cause: string): void {
  ctx.account.deaths += 1;
  ctx.say("died", { cause });
  ctx.emit({ type: "died", cause });
  ctx.setPhase("dead");
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
