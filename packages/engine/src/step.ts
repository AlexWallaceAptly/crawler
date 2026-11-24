import { afterAction, assess, listen, searchPass } from "./roomwork";
import { openBoxes, showAchievements, showBoxes } from "./rewardActions";
import { buyItem, sellItem, showShop } from "./shop";
import { settle } from "./achievements";
import { eatMeal, seedGuide, showGuide } from "./guideActions";
import { int } from "./rng";
import { actionMinutes, sleepStage } from "./rules/sleep";
import { clone } from "./clone";
import type { Action, ActionType } from "./actions";
import type { Content } from "./content/load";
import type { GameEvent, GameEventBody } from "./events";
import { generateCrawler, introContext } from "./gen/backstory";
import {
  clearFloor, enterFloor, enterRoom, formatTimer, openStairwell, renderMap, tickTravelStatuses, timePassed, timeCosts, noteSleepStage, activeHazards, tickHazards, disarmHazards,
} from "./explore";
import {
  aliveEnemies, beginTurn, checkVictory, combatSummary, findEnemy, isGrid, maybeEncounter, playerAttack, playerFlee, playerStep,
  playerTalk, playerUseItem, playerWait,
} from "./combat";
import { gridAdvance, gridMove, gridRetreat } from "./grid/play";
import { addToPile, dropItem, equipItem, findItems, takeItems, unequipItem } from "./inventory";
import { gridDash, isThrowable, playerDefend, playerShove, playerThrow, takeInArena } from "./maneuvers";
import { combine, craftKnown, nudge, showRecipes } from "./craft";
import { renderArena } from "./grid/view";
import { narrate } from "./narrate/narrator";
import { answerUrge, echoNarration, feedEcho, lapseUrge, pendingShard, pushTemper, recordRun, revealRoomShard, showCodex, showEcho, wakeEcho } from "./echo";
import { craftModule, moduleAction } from "./modules";
import { noticeHints, playerDecline, useAgainstBoss } from "./boss";
import { derive } from "./rules/derived";
import { isStat, raiseStat, trainSkill } from "./progression";
import { castSpell, findKnownSpell, readTome, scrollsIn } from "./spells";
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
  /** Echo, from a narration template (`echo.*`); templates see `{echo.act}`, `{echo.side}`, `{echo.vessel}`. */
  echoSay(key: string, data: object = {}): void {
    if (!this.world.game.echo) return;
    const ctx = { crawler: this.world.game.crawler, mood: this.world.game.narrator.mood, echo: echoNarration(this.world.game, this.content), ...data };
    this.emit({ type: "narration", voice: "echo", key, text: narrate(this.content, this.world.game.narrator, key, ctx) });
  }
  /** Echo, verbatim (shard reactions come straight from the workbook). */
  echoLine(text: string): void {
    this.emit({ type: "narration", voice: "echo", text });
  }
  /** Plain narrator voice (room descriptions etc). */
  describe(text: string): void {
    this.emit({ type: "narration", voice: "narrator", text });
  }
  /** Narrator voice from a narration template. Returns the line it said. */
  describeKey(key: string, data: object = {}): string {
    const ctx = { crawler: this.world.game.crawler, mood: this.world.game.narrator.mood, ...data };
    const text = narrate(this.content, this.world.game.narrator, key, ctx);
    this.describe(text);
    return text;
  }
  /** One line of combat play-by-play (battle log). */
  fight(text: string, actor: "you" | "enemy" | "status"): void {
    this.emit({ type: "combatLine", text, actor });
  }
  info(text: string, lines?: string[]): void {
    this.emit(lines ? { type: "info", text, lines } : { type: "info", text });
  }
  error(text: string): void {
    this.emit({ type: "error", text });
  }
  /** Re-reads the phase after a mutating call; TS can't see mutations through narrowing. */
  dead(): boolean {
    return this.game.phase === "dead";
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
  "search               one search pass (20 min); more passes reach deeper",
  "listen <dir>         10 min: how dangerous is the room next door, and is there a hazard?",
  "assess [dir]         30 min: hazards, who is waiting and how much is hidden, here or next door",
  "disarm               switch off this room's hazards (skill check)",
  "meal                 safe rooms: eat something for a small bonus until you sleep",
  "guide                the run's Game Guide (events, scout reports, rules)",
  "boxes / open [n|all] loot boxes: list them; open one in a safe room (only there)",
  "achievements         what you've earned, and what you haven't",
  "shop / buy x / sell x   safe rooms: the shopkeeper's shelf; buy and sell (no time passes). `sell junk all`, `buy tape 2`",
  "rest                 catch your breath (30 min, heals a little)",
  "sleep                6-8 hours: full heal in a safe room, half as good anywhere else",
  "descend              take a stairwell down, ending the floor",
  "attack [name]        in combat. A turn is 3 AP: attack 2, move 1, flee 2, talk 2; `wait` ends the turn",
  "advance / retreat    1 AP: close in or back off (also: flee / talk / wait)",
  "move c4 / move ne 2  grid fights: walk to a tile, or steps in a direction (n ne e se s sw w nw). 1 AP per 4 tiles",
  "shove [name]         1 AP: push something a tile (into the caltrops, ideally) or a band",
  "throw <item> at <x>  1 AP: thrown junk; on the board, at a tile or enemy within 3",
  "dash c4 / defend     1 AP each: run twice as far (ends turn) / brace: everything hits you softer until your turn",
  "combine a b c        at a workbench (safe rooms, workshops): put junk together (names, or kinds: combine blunt sharp bind)",
  "craft <recipe>       make something from your recipe book; `recipes` shows it",
  "use <item>           drink, eat or read something from your pack (tomes teach spells; scrolls cast once)",
  "cast <spell> [at x]  cast a spell you know (MP and AP; most 2 AP). Aim at an enemy or a tile; `c` for short",
  "raise <stat>         spend a stat point from leveling up (raise str, raise dex 2); free, not mid-fight",
  "take <item> / take all   pick things up (weight limit applies); drop <item>",
  "equip <item> / unequip   wield or wear gear (mid-fight: 1 AP, or a tile of movement on the board)",
  "decline / no thanks  boss fights: politely refuse what you're offered (1 AP)",
  "let echo / hush      Echo asked to do something: let it (Fed) or don't (Calm)",
  "feed <junk>          give Echo a piece of salvage (Fed)",
  "echo / codex         how Echo is doing / what the account remembers (free)",
  "shout / bind <x> / coat / break <dir>   Echo's modules, once built (`craft glow` at a bench)",
  "accept / reroll      during crawler creation",
  "abandon              end this crawler's run (asks to confirm)",
  "set combat grid|bands  how the next fight plays (tactical grid or range bands)",
  "new                  start the next crawler after death",
];

/** Rerolls every new crawler gets for free, before the account's unlocked ones. */
export const FREE_REROLLS = 3;

/** Rerolls you could spend right now on the crawler being created. */
export function rerollsLeft(world: World): number {
  return (world.game.freeRerolls ?? FREE_REROLLS) + world.account.rerolls;
}

function startNewCrawler(ctx: StepContext): void {
  const crawler = generateCrawler(ctx.content);
  ctx.game.crawler = crawler;
  ctx.game.floor = null;
  ctx.game.echo = null;
  ctx.game.turn = 0;
  ctx.game.clock = 0;
  ctx.game.timeSpent = {};
  seedGuide(ctx.game, ctx.content);
  ctx.setPhase("creation");
  ctx.emit({ type: "crawlerCreated", name: crawler.name });
  const intro = introContext(crawler, ctx.content);
  ctx.say("crawler.intro", intro);
  ctx.say("crawler.statJab", intro);
  const starter = Object.keys(crawler.spells).map((id) => ctx.content.spells.byId[id]).find(Boolean);
  if (starter) {
    // The job's spell wins over the past's (gen/backstory.ts); say which one it came from.
    const fromJob = ctx.content.backstory.occupations.byId[crawler.backstory.occupation]?.spell === starter.id;
    ctx.say("crawler.starterSpell", {
      ...intro, spell: starter.name, command: `cast ${starter.name.toLowerCase()}`,
      because: fromJob ? `you're a ${intro.occupation}` : `you once ${intro.event}`,
      because2: fromJob ? `work as a ${intro.occupation}` : `once ${intro.event}`,
    });
  }
}

const handlers: Handlers = {
  newCrawler: {
    phases: ["dead"],
    run(ctx) {
      if (ctx.game.turn > 0 || ctx.account.runs > 0) ctx.say("run.newCrawler");
      ctx.game.freeRerolls = FREE_REROLLS;
      startNewCrawler(ctx);
    },
  },
  reroll: {
    phases: ["creation"],
    run(ctx) {
      // The crawler's free rerolls go first; the account's unlocked ones after.
      const free = ctx.game.freeRerolls ?? FREE_REROLLS;
      if (free > 0) ctx.game.freeRerolls = free - 1;
      else if (ctx.account.rerolls > 0) ctx.account.rerolls -= 1;
      else {
        ctx.say("crawler.noRerolls");
        return;
      }
      ctx.say("crawler.reroll");
      startNewCrawler(ctx);
      const left = rerollsLeft(ctx.world);
      ctx.info(left > 0 ? `Rerolls left: ${left}.` : "That was your last reroll. This one's yours.");
    },
  },
  accept: {
    phases: ["creation"],
    run(ctx) {
      ctx.account.runs += 1;
      ctx.say("crawler.accepted");
      const theme = ctx.content.floors.all.find((t) => t.floor === 1);
      if (!theme) throw new Error("no floor 1 theme in floors.json");
      wakeEcho(ctx);
      enterFloor(ctx, theme);
    },
  },
  look: {
    phases: ["exploring", "combat"],
    run(ctx) {
      if (ctx.game.phase === "combat") {
        const board = ctx.game.combat && isGrid(ctx)
          ? [...renderArena(ctx.game.combat, ctx.content), "", "@ you   + door   capitals are elites", ""]
          : [];
        ctx.info("You're a little busy:", [...board, ...combatSummary(ctx)]);
        return;
      }
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
      const { room } = here(ctx);
      const dest = room.exits[action.dir];
      if (dest === undefined) {
        ctx.say("explore.blocked", { dir: action.dir });
        return;
      }
      if (here(ctx).floor.rooms[dest]!.closed) {
        ctx.describe("That way is sealed. Whatever was in there is staying in there.");
        return;
      }
      travel(ctx, dest);
    },
  },
  attack: {
    phases: ["combat"],
    run(ctx, action) {
      const target = action.target ? findEnemy(ctx, action.target) : aliveEnemies(ctx)[0];
      if (!target) {
        ctx.error(action.target ? `Nothing here called "${action.target}".` : "Nothing left to hit.");
        return;
      }
      playerAttack(ctx, target);
    },
  },
  flee: {
    phases: ["combat"],
    run(ctx) {
      playerFlee(ctx);
    },
  },
  advance: {
    phases: ["combat"],
    run(ctx) {
      if (!isGrid(ctx)) return playerStep(ctx, -1);
      if (beginTurn(ctx)) gridAdvance(ctx);
    },
  },
  retreat: {
    phases: ["combat"],
    run(ctx) {
      if (!isGrid(ctx)) return playerStep(ctx, 1);
      if (beginTurn(ctx)) gridRetreat(ctx);
    },
  },
  move: {
    phases: ["combat"],
    run(ctx, action) {
      if (!isGrid(ctx)) {
        ctx.error("No board in this fight: use advance or retreat. (`set combat grid` for the next one.)");
        return;
      }
      if (beginTurn(ctx)) gridMove(ctx, action.to);
    },
  },
  talk: {
    phases: ["combat"],
    run(ctx) {
      playerTalk(ctx);
    },
  },
  use: {
    phases: ["exploring", "combat"],
    run(ctx, action) {
      const c = ctx.crawler;
      const name = action.item.toLowerCase();
      const item = findItems(c.inventory.filter((i) => i.kind === "consumable"), name)[0];
      if (!item) {
        ctx.error(`You don't have anything like "${action.item}".`);
        return;
      }
      // Tomes teach their spell; scrolls cast theirs.
      const spell = item.spellId ? ctx.content.spells.byId[item.spellId] : undefined;
      if (spell) {
        if (item.spellLevel === undefined) readTome(ctx, item);
        else castSpell(ctx, spell, action.at, item);
        return;
      }
      // A boss's counter (a stamped ticket, a tagged umbrella) does its job instead of anything else.
      if (ctx.game.phase === "combat" && useAgainstBoss(ctx, item)) return;
      // On the board, using something you'd throw means throwing it at the nearest target.
      const def = ctx.content.items.consumables.byId[item.baseId];
      if (isGrid(ctx) && def && isThrowable(def) && (def.hazard || def.effects.some((e) => e.target === "target" || e.target === "all_enemies"))) {
        playerThrow(ctx, item);
        return;
      }
      playerUseItem(ctx, item);
    },
  },
  cast: {
    phases: ["exploring", "combat"],
    run(ctx, action) {
      const c = ctx.crawler;
      const spell = findKnownSpell(c, ctx.content, action.spell);
      if (spell) return castSpell(ctx, spell, action.at);
      // Not a spell you know: a scroll of it will do.
      const scroll = findItems(scrollsIn(c), action.spell)[0];
      const fromScroll = scroll?.spellId ? ctx.content.spells.byId[scroll.spellId] : undefined;
      if (scroll && fromScroll) return castSpell(ctx, fromScroll, action.at, scroll);
      const known = Object.keys(c.spells).map((id) => ctx.content.spells.byId[id]?.name).filter(Boolean);
      ctx.error(known.length
        ? `You don't know a spell called "${action.spell}". You know: ${known.join(", ")}.`
        : "You don't know any spells. Tomes teach them; scrolls cast them once.");
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
        [...renderMap(floor), "", "@ you   · visited   ? seen   S safe   > stairs   ! boss"],
      );
    },
  },
  search: {
    phases: ["exploring"],
    run(ctx) {
      searchPass(ctx, here(ctx).room);
    },
  },
  listen: {
    phases: ["exploring"],
    run(ctx, action) {
      listen(ctx, action.dir);
    },
  },
  assess: {
    phases: ["exploring"],
    run(ctx, action) {
      assess(ctx, action.dir);
    },
  },
  disarm: {
    phases: ["exploring"],
    run(ctx) {
      disarmHazards(ctx, here(ctx).room);
    },
  },
  meal: {
    phases: ["exploring"],
    run(ctx) {
      eatMeal(ctx, here(ctx).room);
    },
  },
  boxes: {
    phases: ["exploring", "combat"],
    run(ctx) {
      showBoxes(ctx, ctx.game.floor!.rooms[ctx.game.floor!.currentRoom]!);
    },
  },
  open: {
    phases: ["exploring"],
    run(ctx, action) {
      openBoxes(ctx, here(ctx).room, action.which);
    },
  },
  shop: {
    phases: ["exploring"],
    run(ctx) {
      showShop(ctx, here(ctx).room);
    },
  },
  buy: {
    phases: ["exploring"],
    run(ctx, action) {
      buyItem(ctx, here(ctx).room, action.item, action.qty);
    },
  },
  sell: {
    phases: ["exploring"],
    run(ctx, action) {
      sellItem(ctx, here(ctx).room, action.item, action.qty);
    },
  },
  achievements: {
    phases: ["exploring", "combat"],
    run(ctx) {
      showAchievements(ctx);
    },
  },
  guide: {
    phases: "any",
    run(ctx, action) {
      showGuide(ctx, !!action.quiet);
    },
  },
  rest: {
    phases: ["exploring"],
    run(ctx) {
      if (!timePassed(ctx, timeCosts(ctx).rest, "rest")) return;
      const c = ctx.crawler;
      const d = derive(c, ctx.content);
      const { hpPct, mpPct } = ctx.content.pacing.rest;
      c.hp = Math.min(d.maxHP, c.hp + Math.ceil(d.maxHP * hpPct));
      c.mp = Math.min(d.maxMP, c.mp + Math.ceil(d.maxMP * mpPct));
      // An hour of pressure and swearing: every status runs down by 2 rounds' worth.
      for (const s of c.statuses) s.remaining -= 2;
      c.statuses = c.statuses.filter((s) => s.remaining > 0);
      ctx.say("explore.rest");
      pushTemper(ctx, "rest");
    },
  },
  sleep: {
    phases: ["exploring"],
    run(ctx) {
      const { room } = here(ctx);
      const { sleepMin, sleepMax } = timeCosts(ctx);
      const rules = ctx.content.pacing.sleep;
      const safe = room.type === "safe";
      const stageBefore = sleepStage(ctx.crawler, ctx.content).id;
      if (!timePassed(ctx, int(sleepMin, sleepMax), "sleep")) return; // slept straight through the collapse
      const c = ctx.crawler;
      const d = derive(c, ctx.content);
      c.wellFed = false; // a meal lasts until the next sleep
      if (safe) {
        c.hp = d.maxHP;
        c.mp = d.maxMP;
        c.statuses = [];
        c.awakeMin = 0;
      } else {
        // Sleeping rough: half the restoring, and only back to the Tired line.
        c.hp = Math.min(d.maxHP, c.hp + Math.ceil((d.maxHP - c.hp) * rules.outsideSafeRestorePct));
        c.mp = Math.min(d.maxMP, c.mp + Math.ceil((d.maxMP - c.mp) * rules.outsideSafeRestorePct));
        c.awakeMin = Math.min(c.awakeMin ?? 0, rules.outsideSafeAwakeHours * 60);
      }
      noteSleepStage(ctx, stageBefore);
      ctx.say("explore.sleep");
      pushTemper(ctx, "rest");
    },
  },
  descend: {
    phases: ["exploring"],
    run(ctx) {
      const { floor, room } = here(ctx);
      if (!openStairwell(floor, room)) {
        ctx.say("explore.descendRefused");
        return;
      }
      clearFloor(ctx);
    },
  },
  take: {
    phases: ["exploring", "combat"],
    run(ctx, action) {
      if (ctx.game.phase !== "combat") takeItems(ctx, action.item);
      else if (beginTurn(ctx)) takeInArena(ctx, action.item);
      if (ctx.game.crawler && ctx.game.phase !== "dead") noticeHints(ctx);
      if (ctx.game.phase === "exploring") nudge(ctx);
    },
  },
  combine: {
    phases: ["exploring"],
    run(ctx, action) {
      combine(ctx, action.items);
    },
  },
  craft: {
    phases: ["exploring"],
    run(ctx, action) {
      if (craftModule(ctx, action.recipe)) return;
      craftKnown(ctx, action.recipe);
    },
  },
  recipes: {
    phases: "any",
    run(ctx) {
      if (!ctx.game.crawler) return ctx.error("No crawler, no recipes.");
      showRecipes(ctx);
    },
  },
  raise: {
    phases: ["exploring", "combat"],
    run(ctx, action) {
      if (!isStat(action.stat)) return ctx.error("Raise which stat? STR, DEX, CON, INT or CHA.");
      raiseStat(ctx, action.stat, action.times);
    },
  },
  shove: {
    phases: ["combat"],
    run(ctx, action) {
      const target = action.target ? findEnemy(ctx, action.target) : aliveEnemies(ctx)[0];
      if (!target) {
        ctx.error(action.target ? `Nothing here called "${action.target}".` : "Nothing left to shove.");
        return;
      }
      playerShove(ctx, target);
    },
  },
  throw: {
    phases: ["exploring", "combat"],
    run(ctx, action) {
      const item = findItems(ctx.crawler.inventory.filter((i) => i.kind === "consumable"), action.item)[0];
      if (!item) {
        ctx.error(`You don't have anything like "${action.item}" to throw.`);
        return;
      }
      playerThrow(ctx, item, action.at);
    },
  },
  dash: {
    phases: ["combat"],
    run(ctx, action) {
      if (beginTurn(ctx)) gridDash(ctx, action.to);
    },
  },
  defend: {
    phases: ["combat"],
    run(ctx) {
      if (beginTurn(ctx)) playerDefend(ctx);
    },
  },
  drop: {
    phases: ["exploring"],
    run(ctx, action) {
      dropItem(ctx, action.item);
    },
  },
  equip: {
    phases: ["exploring", "combat"],
    run(ctx, action) {
      if (ctx.game.phase === "combat" && !beginTurn(ctx)) return;
      equipItem(ctx, action.item);
    },
  },
  unequip: {
    phases: ["exploring"],
    run(ctx, action) {
      unequipItem(ctx, action.item);
    },
  },
  wait: {
    phases: ["combat"],
    run(ctx) {
      playerWait(ctx);
    },
  },
  set: {
    phases: "any",
    run(ctx, action) {
      ctx.account.settings = { ...ctx.account.settings, combatMode: action.value };
      ctx.say("settings.changed", { setting: "combat", value: action.value });
    },
  },
  help: {
    phases: "any",
    run(ctx) {
      ctx.info("Commands:", HELP_LINES);
    },
  },
  decline: {
    phases: ["combat"],
    run(ctx) {
      playerDecline(ctx);
    },
  },
  allowEcho: {
    phases: ["exploring", "combat"],
    run(ctx) {
      answerUrge(ctx, true);
      if (ctx.game.phase === "combat") checkVictory(ctx);
    },
  },
  refuseEcho: {
    phases: ["exploring", "combat"],
    run(ctx) {
      answerUrge(ctx, false);
    },
  },
  feed: {
    phases: ["exploring"],
    run(ctx, action) {
      feedEcho(ctx, action.item);
    },
  },
  codex: {
    phases: "any",
    run(ctx) {
      showCodex(ctx);
    },
  },
  echo: {
    phases: "any",
    run(ctx) {
      showEcho(ctx);
    },
  },
  module: {
    phases: ["exploring", "combat"],
    run(ctx, action) {
      moduleAction(ctx, action.verb, action.arg);
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

/**
 * Walk into a neighboring room: time, travel regen and statuses, the room block,
 * first-visit traps, then the encounter roll. Shared by `go` and fleeing out a side door.
 */
export function travel(ctx: StepContext, dest: number): void {
  const floor = ctx.game.floor!;
  const cameFrom = floor.currentRoom;
  lapseUrge(ctx); // whatever Echo wanted in that room, it's moot now
  if (!timePassed(ctx, timeCosts(ctx).move, "travel")) return; // the floor ran out mid-step
  const target = floor.rooms[dest]!;
  const firstVisit = !target.visited;
  // out-of-combat regen per room moved (spec: Derived values)
  const c = ctx.crawler;
  const d = derive(c, ctx.content);
  c.hp = Math.min(d.maxHP, c.hp + d.hpRegen);
  c.mp = Math.min(d.maxMP, c.mp + d.mpRegen);
  tickTravelStatuses(ctx);
  if (ctx.dead()) return;
  if (target.closed) { // the section closed while you were walking
    ctx.describe("The way closes in front of you. You lost the time anyway.");
    return;
  }
  enterRoom(ctx, dest, firstVisit ? "first" : "revisit");
  if (activeHazards(target).length > 0) {
    tickHazards(ctx, target, "enter");
    if (ctx.dead()) return;
  }
  maybeEncounter(ctx, target, firstVisit, cameFrom);
}

/** Actions that don't advance the turn counter (no game effect). */
const FREE_ACTIONS = new Set<ActionType>(["help", "set", "recipes", "codex", "echo", "guide", "boxes", "achievements", "shop", "buy", "sell"]);

export function killCrawler(ctx: StepContext, cause: string, key = "died"): void {
  ctx.game.combat = null;
  ctx.account.deaths += 1;
  ctx.say(key, { cause });
  ctx.echoSay(cause === "quit" ? "echo.quit" : "echo.died");
  ctx.emit({ type: "died", cause });
  recordRun(ctx, cause === "quit" ? "quit" : `died: ${cause}`);
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
    afterAction(ctx);
    if (!FREE_ACTIONS.has(action.type)) draft.game.turn += 1;
  }
  settle(ctx);
  ctx.emit({ type: "stateChanged" });
  return { world: draft, events: commitEvents(draft, ctx.events) };
}
