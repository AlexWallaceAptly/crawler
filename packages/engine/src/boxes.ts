/**
 * Loot boxes (Milestone 7). Achievements, bosses and floors hand them out; they open only in a
 * safe room, so the crawler is always carrying unopened promises.
 *
 *   openBox: n = a roll in the tier's range; each roll picks item | gold | consumable | tome |
 *   oddity from the tier's pool weights times the box type's multipliers. Items are generated at
 *   item level `floor * 5 + 2` with the tier's minimum rarity.
 */
import type { Content } from "./content/load";
import type { BoxTier, BoxType, PoolWeights, Slot } from "./content/schemas";
import { addGold } from "./economy";
import { generateItem, itemFromRef } from "./gen/item";
import { oddityFor } from "./gen/loot";
import { addToPile, howManyFit } from "./inventory";
import { int, pick, random, weightedPick } from "./rng";
import type { Box, ItemInstance, Room } from "./state";
import type { StepContext } from "./step";

export function boxItemLevel(floor: number): number {
  return floor * 5 + 2;
}

export function boxName(content: Content, box: Pick<Box, "tier" | "boxType">): string {
  const tier = content.boxes.tiers.find((t) => t.id === box.tier);
  const type = content.boxes.types.find((t) => t.id === box.boxType);
  return `${tier?.name ?? box.tier} ${type?.name ?? box.boxType} box`;
}

/** Hand the crawler an unopened box. */
export function grantBox(ctx: StepContext, tier: Box["tier"], boxType: Box["boxType"], source: string): Box {
  const box: Box = { id: `box${ctx.game.nextBoxId++}`, tier, boxType, floor: ctx.game.floor?.floor ?? 1, source };
  ctx.game.boxes.push(box);
  ctx.emit({ type: "boxEarned", boxId: box.id, tier, boxType, source });
  ctx.say("box.granted", { box: boxName(ctx.content, box), tier, source });
  return box;
}

const POOLS: (keyof PoolWeights)[] = ["item", "gold", "consumable", "tome", "oddity"];

function pickPool(tier: BoxTier, type: BoxType): keyof PoolWeights {
  const weighted = POOLS.map((p) => ({ p, w: tier.pools[p] * type.mult[p] })).filter((x) => x.w > 0);
  if (weighted.length === 0) return "gold";
  return weightedPick(weighted, (x) => x.w).p;
}

function consumablePool(content: Content): string[] {
  return content.items.consumables.all
    .filter((c) => c.generate && (c.type === "potion" || c.type === "food" || c.type === "explosive"))
    .map((c) => c.id);
}

/** What one roll produces. Gold comes back as a number; everything else as an item. */
function rollOne(ctx: StepContext, box: Box, tier: BoxTier, type: BoxType, pool: keyof PoolWeights, forceLegendary: boolean): ItemInstance | number | undefined {
  const content = ctx.content;
  const level = boxItemLevel(box.floor);
  switch (pool) {
    case "gold": {
      const base = int(tier.gold[0], tier.gold[1]);
      return Math.round(base * (1 + (box.floor - 1) * 0.5));
    }
    case "item": {
      const slot: Slot | undefined = type.slots ? pick(type.slots) : undefined;
      return generateItem(content, level, {
        floor: box.floor, narrator: ctx.game.narrator,
        ...(slot ? { slot } : {}),
        ...(forceLegendary ? { rarity: "legendary" as const } : { minRarity: tier.minRarity }),
      });
    }
    case "consumable": {
      const ids = consumablePool(content);
      return ids.length ? itemFromRef(content, pick(ids), int(1, 2), box.floor) : undefined;
    }
    case "tome":
      return itemFromRef(content, random() < 0.6 ? "spell_tome" : "spell_scroll", 1, box.floor);
    case "oddity":
      return oddityFor(content, box.floor);
  }
}

export interface OpenResult {
  items: ItemInstance[];
  gold: number;
}

/** Roll a box's contents without touching the crawler (tests and the sim use this too). */
export function rollBox(ctx: StepContext, box: Box): OpenResult {
  const tier = ctx.content.boxes.tiers.find((t) => t.id === box.tier)!;
  const type = ctx.content.boxes.types.find((t) => t.id === box.boxType)!;
  const rolls = int(tier.rolls[0], tier.rolls[1]);
  const out: OpenResult = { items: [], gold: 0 };
  let sawTomeOrOddity = false;
  let legendaryPending = tier.guarantee === "legendary";
  const take = (r: ItemInstance | number | undefined, pool: keyof PoolWeights) => {
    if (r === undefined) return;
    if (typeof r === "number") { out.gold += r; return; }
    if (pool === "tome" || pool === "oddity") sawTomeOrOddity = true;
    out.items.push(r);
  };
  for (let i = 0; i < rolls; i++) {
    const pool = pickPool(tier, type);
    const force = legendaryPending && pool === "item";
    if (force) legendaryPending = false;
    take(rollOne(ctx, box, tier, type, pool, force), pool);
  }
  // The legendary box always holds one legendary piece, whatever the dice said.
  if (legendaryPending) take(rollOne(ctx, box, tier, { ...type, slots: type.slots as Slot[] }, "item", true), "item");
  if (random() < tier.tomeChance * (type.mult.tome > 0 ? 1 : 0.25)) take(rollOne(ctx, box, tier, type, "tome", false), "tome");
  if (random() < tier.oddityChance * (type.mult.oddity > 0 ? 1 : 0.25)) take(rollOne(ctx, box, tier, type, "oddity", false), "oddity");
  if (tier.guarantee === "tomeOrOddity" && !sawTomeOrOddity) {
    take(rollOne(ctx, box, tier, type, random() < 0.5 ? "tome" : "oddity", false) ?? rollOne(ctx, box, tier, type, "tome", false), "tome");
  }
  return out;
}

/**
 * Open one box. Only in a safe room, never mid-fight. Anything that doesn't fit the carry
 * limit stays on the floor of the room.
 */
export function openBox(ctx: StepContext, box: Box, room: Room): boolean {
  if (room.type !== "safe") {
    ctx.say("box.refused", { box: boxName(ctx.content, box) });
    return false;
  }
  const result = rollBox(ctx, box);
  ctx.game.boxes.splice(ctx.game.boxes.indexOf(box), 1);
  const names: string[] = [];
  for (const item of result.items) {
    const fit = howManyFit(ctx, item);
    if (fit >= item.qty) addToPile(ctx.crawler.inventory, item);
    else {
      room.items ??= [];
      addToPile(room.items, item);
      names.push(`${item.name} (on the floor, too heavy)`);
      continue;
    }
    names.push(item.qty > 1 ? `${item.name} ×${item.qty}` : item.name);
  }
  if (result.gold > 0) {
    addGold(ctx, result.gold, "box");
    names.push(`${result.gold} gold`);
  }
  ctx.emit({ type: "boxOpened", boxId: box.id, tier: box.tier, boxType: box.boxType, contents: names });
  ctx.say(`box.open.${box.tier}`, { box: boxName(ctx.content, box), count: names.length });
  ctx.describe(`The ${boxName(ctx.content, box)} opens: ${names.join(", ")}.`);
  return true;
}
