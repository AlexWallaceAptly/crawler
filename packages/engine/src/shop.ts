/**
 * Shops (Milestone 7). Every safe room has one: a shopkeeper with a personality and a shelf,
 * rolled when the floor is generated and kept in the room's state, so a reload shows the
 * same stock. Prices come from `item.value`, the personality's markup and sell rate, the
 * crawler's CHA and the Lost Property Index's `sellBonus`. Nothing here costs game time.
 */
import type { Content } from "./content/load";
import type { ShopPersonality } from "./content/schemas";
import { addGold } from "./economy";
import { generateItem, itemFromRef, itemLevelFor } from "./gen/item";
import { addToPile, findItems, howManyFit } from "./inventory";
import { effectsNow } from "./modules";
import { derive } from "./rules/derived";
import { itemInfo, type ItemQuick } from "./itemInfo";
import { chance, int, pick } from "./rng";
import type { Crawler, FloorState, GameState, ItemInstance, Room } from "./state";
import type { StepContext } from "./step";

export function personalityOf(content: Content, shop: { personality: string }): ShopPersonality {
  return content.shops.personalities.find((p) => p.id === shop.personality) ?? content.shops.personalities[0]!;
}

/** Roll one shop's shelf. */
function stockShop(content: Content, p: ShopPersonality, floor: number): ItemInstance[] {
  const n = int(p.stock[0], p.stock[1]);
  const consumables = content.items.consumables.all.filter((c) => c.generate && (c.type === "potion" || c.type === "food" || c.type === "explosive"));
  const parts = content.items.consumables.all.filter((c) => c.generate && c.type === "junk");
  const out: ItemInstance[] = [];
  for (let i = 0; i < n; i++) {
    if (chance(p.gearShare)) addToPile(out, generateItem(content, itemLevelFor(floor), { floor }));
    else if (parts.length && chance(content.shops.partsShare)) addToPile(out, itemFromRef(content, pick(parts).id, int(1, 3), floor));
    else if (consumables.length) addToPile(out, itemFromRef(content, pick(consumables).id, int(1, 2), floor));
  }
  return out;
}

/** Give every safe room a shopkeeper and a shelf. Runs once per floor, after the loot is seeded. */
export function seedShops(floor: FloorState, content: Content): void {
  for (const room of floor.rooms) {
    if (room.type !== "safe") continue;
    const p = pick(content.shops.personalities);
    room.shop = { personality: p.id, keeper: pick(p.names), stock: stockShop(content, p, floor.floor) };
  }
}

// ---------------------------------------------------------------- prices

/** CHA 10 is neutral. Each point above takes `chaPerPoint` off the price you pay, up to `chaCap`. */
function chaShift(c: Crawler, content: Content): number {
  const { chaPerPoint, chaCap } = content.shops;
  const delta = (derive(c, content).stats.CHA - 10) * chaPerPoint;
  return Math.max(-chaCap, Math.min(chaCap, delta));
}

/** What the shopkeeper charges for one of these. */
export function buyPrice(game: GameState, content: Content, shop: { personality: string }, item: ItemInstance): number {
  const c = game.crawler!;
  const p = personalityOf(content, shop);
  return Math.max(content.shops.minPrice, Math.round(item.value * p.markup * (1 - chaShift(c, content))));
}

/** What the shopkeeper pays for one of these. 0 means they won't take it. */
export function sellPrice(game: GameState, content: Content, shop: { personality: string }, item: ItemInstance): number {
  if (item.value <= 0) return 0;
  const c = game.crawler!;
  const p = personalityOf(content, shop);
  const bonus = effectsNow(game, content).sellBonus ?? 0;
  return Math.max(1, Math.round(item.value * p.sellRate * (1 + bonus) * (1 + chaShift(c, content) / 2)));
}

// ---------------------------------------------------------------- views

export interface ShopLine {
  name: string; qty: number; price: number; rarity: string; slot?: string; value: number;
  /** For sale: a weapon's stat and the one number against what you have on, like the inventory row. */
  quick?: ItemQuick;
}

export interface ShopView {
  keeper: string;
  title: string;
  blurb: string;
  stock: ShopLine[];
  /** What each thing in your pack would fetch (0: not interested). */
  sell: ShopLine[];
  gold: number;
}

export function shopView(game: GameState, content: Content, room: Room): ShopView | undefined {
  if (!room.shop || !game.crawler) return undefined;
  const p = personalityOf(content, room.shop);
  const c = game.crawler;
  const equipped = new Set(Object.values(c.equipment));
  return {
    keeper: room.shop.keeper,
    title: p.title,
    blurb: p.blurb,
    gold: c.gold,
    stock: room.shop.stock.map((i) => {
      const quick = i.kind === "gear" ? itemInfo(c, content, i).quick : undefined;
      return { name: i.name, qty: i.qty, price: buyPrice(game, content, room.shop!, i), rarity: i.rarity, ...(i.slot ? { slot: i.slot } : {}), value: i.value, ...(quick ? { quick } : {}) };
    }),
    sell: c.inventory.filter((i) => !equipped.has(i.uid)).map((i) => ({ name: i.name, qty: i.qty, price: sellPrice(game, content, room.shop!, i), rarity: i.rarity, ...(i.slot ? { slot: i.slot } : {}), value: i.value })),
  };
}

// ---------------------------------------------------------------- commands

function needShop(ctx: StepContext, room: Room): room is Room & { shop: NonNullable<Room["shop"]> } {
  if (room.type !== "safe" || !room.shop) {
    ctx.error("There's no shop here. Shops live in safe rooms, next to the beds nobody dares to use.");
    return false;
  }
  return true;
}

/** `shop`: the shelf and what your pack would fetch. Free. */
export function showShop(ctx: StepContext, room: Room): void {
  if (!needShop(ctx, room)) return;
  const v = shopView(ctx.game, ctx.content, room)!;
  ctx.say(`shop.${room.shop.personality}.enter`, { keeper: v.keeper, title: v.title });
  const lines = v.stock.length
    ? v.stock.map((s, i) => `${i + 1}. ${s.name}${s.qty > 1 ? ` ×${s.qty}` : ""} — ${s.price}g${s.slot ? ` [${s.slot}]` : ""} (${s.rarity})`)
    : ["Nothing. Sold out. Business is booming."];
  const sell = v.sell.filter((s) => s.price > 0).slice(0, 8).map((s) => `${s.name}${s.qty > 1 ? ` ×${s.qty}` : ""}: ${s.price}g each`);
  ctx.info(`${v.keeper}, ${v.title}. You have ${v.gold} gold.`, [...lines, "", sell.length ? `They'd buy: ${sell.join("; ")}.` : "They wouldn't buy anything you're carrying.", "`buy <item> [n]`, `sell <item> [n|all]`."]);
}

function quantity(arg: string | undefined): number | "all" {
  if (arg === "all") return "all";
  const n = Number(arg);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function buyItem(ctx: StepContext, room: Room, query: string, qtyArg?: string): void {
  if (!needShop(ctx, room)) return;
  const shop = room.shop;
  const found = /^\d+$/.test(query) ? shop.stock[Number(query) - 1] : findItems(shop.stock, query)[0];
  if (!found) {
    ctx.error(`${shop.keeper} has nothing like "${query}". \`shop\` shows the shelf.`);
    return;
  }
  const want = quantity(qtyArg);
  let n = want === "all" ? found.qty : Math.min(want, found.qty);
  const each = buyPrice(ctx.game, ctx.content, shop, found);
  const c = ctx.crawler;
  n = Math.min(n, Math.floor(c.gold / each));
  if (n <= 0) {
    ctx.say(`shop.${shop.personality}.broke`, { item: found.name, price: each, gold: c.gold, keeper: shop.keeper });
    return;
  }
  const probe = { ...found, qty: n };
  const fit = howManyFit(ctx, probe);
  if (fit <= 0) {
    ctx.say("item.tooHeavy", { item: found.name });
    return;
  }
  n = Math.min(n, fit);
  const total = each * n;
  const bought: ItemInstance = n >= found.qty ? found : { ...found, uid: `${found.uid}_b${found.qty - n}`, qty: n };
  if (n >= found.qty) shop.stock.splice(shop.stock.indexOf(found), 1);
  else found.qty -= n;
  addToPile(c.inventory, { ...bought, qty: n });
  addGold(ctx, -total, `bought ${found.name}`);
  ctx.emit({ type: "shopBought", item: found.name, price: total, shopkeeper: shop.keeper });
  ctx.say(`shop.${shop.personality}.buy`, { item: found.name, price: total, keeper: shop.keeper, qty: n });
  ctx.describe(`Bought ${found.name}${n > 1 ? ` ×${n}` : ""} for ${total} gold.`);
}

export function sellItem(ctx: StepContext, room: Room, query: string, qtyArg?: string): void {
  if (!needShop(ctx, room)) return;
  const shop = room.shop;
  const c = ctx.crawler;
  const equipped = new Set(Object.values(c.equipment));
  const found = findItems(c.inventory, query)[0];
  if (!found) {
    ctx.error(`You aren't carrying anything like "${query}".`);
    return;
  }
  if (equipped.has(found.uid)) {
    ctx.error(`${found.name} is equipped. Unequip it first, then we'll talk about robbing you.`);
    return;
  }
  const each = sellPrice(ctx.game, ctx.content, shop, found);
  if (each <= 0) {
    ctx.say("shop.worthless", { item: found.name, keeper: shop.keeper });
    return;
  }
  const want = quantity(qtyArg);
  const n = want === "all" ? found.qty : Math.min(want, found.qty);
  const total = each * n;
  const sold: ItemInstance = { ...found, uid: `${found.uid}_s`, qty: n };
  found.qty -= n;
  if (found.qty <= 0) c.inventory.splice(c.inventory.indexOf(found), 1);
  addToPile(shop.stock, sold);
  addGold(ctx, total, `sold ${found.name}`);
  ctx.emit({ type: "shopSold", item: found.name, price: total, shopkeeper: shop.keeper });
  ctx.say(`shop.${shop.personality}.sell`, { item: found.name, price: total, keeper: shop.keeper, qty: n });
  ctx.describe(`Sold ${found.name}${n > 1 ? ` ×${n}` : ""} for ${total} gold.`);
}
