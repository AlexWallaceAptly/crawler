/**
 * The slice of Milestone 5 that junk and crafting need now: picking things up,
 * putting them down, a hard weight cap, stacking, and equipping. Item generation
 * (materials, rarity, affixes) is still Milestone 5.
 */
import { inCombat, minorLimit } from "./combat";
import { derive } from "./rules/derived";
import type { StepContext } from "./step";
import type { Crawler, EquipSlot, ItemInstance, Room } from "./state";

/**
 * Tags an item answers to, for recipes and lookups: its own tags, its weapon type
 * (blunt, blades, polearm, ...), and "weapon"/"armor"/"slot:<slot>".
 */
export function effectiveTags(item: ItemInstance): string[] {
  const tags = new Set(item.tags);
  if (item.weaponType) tags.add(item.weaponType);
  if (item.kind === "gear" && item.damage) tags.add("weapon");
  if (item.kind === "gear" && item.armor) tags.add("armor");
  if (item.slot) tags.add(`slot:${item.slot}`);
  return [...tags];
}

/** Items that can share a stack: same base, nothing baked in. */
function stackable(a: ItemInstance, b: ItemInstance): boolean {
  return a.kind === "consumable" && b.kind === "consumable" && a.baseId === b.baseId &&
    !a.crafted?.length && !b.crafted?.length && !a.onHit && !b.onHit;
}

/** Put an item on a pile (room floor, pack), merging consumable stacks. Returns the entry it landed in. */
export function addToPile(pile: ItemInstance[], item: ItemInstance): ItemInstance {
  const same = pile.find((p) => stackable(p, item));
  if (same) {
    same.qty += item.qty;
    return same;
  }
  pile.push(item);
  return item;
}

/**
 * Candidates for a typed name, best first: exact name, then whole words, then any
 * substring. "tape" finds duct tape and friction tape; "duct tape" finds one.
 */
export function findItems(items: ItemInstance[], query: string): ItemInstance[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const exact = items.filter((i) => i.name.toLowerCase() === q);
  const words = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const word = items.filter((i) => !exact.includes(i) && words.test(i.name.toLowerCase()));
  const sub = items.filter((i) => !exact.includes(i) && !word.includes(i) && i.name.toLowerCase().includes(q));
  return [...exact, ...word, ...sub];
}

export function carried(c: Crawler): number {
  return c.inventory.reduce((sum, it) => sum + it.weight * it.qty, 0);
}

/** How many of this stack fit under the carry limit. */
export function howManyFit(ctx: StepContext, item: ItemInstance): number {
  const d = derive(ctx.crawler, ctx.content);
  if (item.weight <= 0) return item.qty;
  return Math.max(0, Math.min(item.qty, Math.floor((d.carryLimit - carried(ctx.crawler) + 1e-9) / item.weight)));
}

function label(item: ItemInstance): string {
  return item.qty > 1 ? `${item.name} ×${item.qty}` : item.name;
}

/** Move (part of) a stack off a pile into the pack. Returns what was taken, or null. */
export function takeFrom(ctx: StepContext, pile: ItemInstance[], item: ItemInstance): ItemInstance | null {
  const fit = howManyFit(ctx, item);
  if (fit <= 0) {
    ctx.say("item.tooHeavy", { item: item.name });
    return null;
  }
  let moving = item;
  if (fit < item.qty) {
    moving = { ...item, uid: `${item.uid}_${item.qty - fit}`, qty: fit };
    item.qty -= fit;
  } else {
    pile.splice(pile.indexOf(item), 1);
  }
  return addToPile(ctx.crawler.inventory, moving);
}

function here(ctx: StepContext): Room {
  const floor = ctx.game.floor!;
  return floor.rooms[floor.currentRoom]!;
}

export function takeItems(ctx: StepContext, query: string): void {
  const room = here(ctx);
  const pile = room.items ?? [];
  const all = query === "all" || query === "everything";
  const targets = all ? pile.slice() : findItems(pile, query).slice(0, 1);
  if (targets.length === 0) {
    ctx.error(pile.length ? `Nothing here called "${query}".` : "There's nothing here to take.");
    return;
  }
  const got: string[] = [];
  for (const it of targets) {
    const before = it.qty;
    if (!takeFrom(ctx, pile, it)) break;
    const moved = pile.includes(it) ? before - it.qty : before; // a partial take leaves the rest behind
    got.push(label({ ...it, qty: moved }));
  }
  if (pile.length === 0) delete room.items;
  if (got.length) ctx.describe(`You take ${got.join(", ")}.`);
}

export function dropItem(ctx: StepContext, query: string): void {
  const c = ctx.crawler;
  const item = findItems(c.inventory, query)[0];
  if (!item) {
    ctx.error(`You aren't carrying anything like "${query}".`);
    return;
  }
  unequipUid(c, item.uid);
  c.inventory.splice(c.inventory.indexOf(item), 1);
  const room = here(ctx);
  room.items ??= [];
  addToPile(room.items, item);
  ctx.describe(`You drop ${label(item)}.`);
}

export function equippedSlot(c: Crawler, uid: string): EquipSlot | undefined {
  return (Object.entries(c.equipment) as [EquipSlot, string][]).find(([, u]) => u === uid)?.[0];
}

export function unequipUid(c: Crawler, uid: string): boolean {
  let any = false;
  for (const [slot, u] of Object.entries(c.equipment) as [EquipSlot, string][]) {
    if (u === uid) {
      delete c.equipment[slot];
      any = true;
    }
  }
  return any;
}

/**
 * Put gear on, displacing whatever was there. Two-handed weapons clear the off
 * hand; an off-hand item knocks a two-hander out. Returns the replaced items.
 */
export function equip(c: Crawler, item: ItemInstance): { slot: EquipSlot; replaced: ItemInstance[] } | null {
  if (item.kind !== "gear" || !item.slot) return null;
  const byUid = (uid?: string) => (uid ? c.inventory.find((i) => i.uid === uid) : undefined);
  const slot: EquipSlot = item.slot === "ring" ? (c.equipment.ring1 && !c.equipment.ring2 ? "ring2" : "ring1") : item.slot;
  const replaced: ItemInstance[] = [];
  unequipUid(c, item.uid);
  const bump = (s: EquipSlot) => {
    const old = byUid(c.equipment[s]);
    if (old) replaced.push(old);
    delete c.equipment[s];
  };
  bump(slot);
  if (item.twoHanded) bump("offHand");
  if (slot === "offHand" && byUid(c.equipment.mainHand)?.twoHanded) bump("mainHand");
  c.equipment[slot] = item.uid;
  return { slot, replaced };
}

/** Swapping gear mid-fight is the minor action (bands) or one tile of movement (grid). */
function payForSwap(ctx: StepContext): boolean {
  if (!inCombat(ctx)) return true;
  const combat = ctx.game.combat!;
  if (combat.arena) {
    if (combat.arena.moveLeft < 1) {
      ctx.error("No movement left to swap gear this turn.");
      return false;
    }
    combat.arena.moveLeft -= 1;
    return true;
  }
  if (combat.minorActionsUsed >= minorLimit(ctx.crawler.statuses, ctx.content)) {
    ctx.error("You've already used your minor action this round.");
    return false;
  }
  combat.minorActionsUsed += 1;
  return true;
}

export function equipItem(ctx: StepContext, query: string): void {
  const c = ctx.crawler;
  const item = findItems(c.inventory.filter((i) => i.kind === "gear" && i.slot), query)[0];
  if (!item) {
    ctx.error(`You don't have any gear like "${query}".`);
    return;
  }
  if (equippedSlot(c, item.uid)) {
    ctx.error(`You're already using ${item.name}.`);
    return;
  }
  if (!payForSwap(ctx)) return;
  const res = equip(c, item)!;
  const swap = res.replaced.length ? ` (putting away ${res.replaced.map((r) => r.name).join(", ")})` : "";
  const line = `You ${item.slot === "mainHand" ? "ready" : "put on"} ${item.name}${swap}.`;
  if (inCombat(ctx)) ctx.fight(line, "you");
  else ctx.describe(line);
}

export function unequipItem(ctx: StepContext, query: string): void {
  const c = ctx.crawler;
  const equipped = c.inventory.filter((i) => equippedSlot(c, i.uid));
  const item = findItems(equipped, query)[0];
  if (!item) {
    ctx.error(`You aren't using anything like "${query}".`);
    return;
  }
  unequipUid(c, item.uid);
  ctx.describe(`You take off ${item.name}.`);
}
