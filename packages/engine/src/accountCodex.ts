/**
 * The old account codex (Milestone 8): every enemy, item and achievement ever found, with the
 * System AI's commentary. It sits next to the thread Codex (echo.ts) and, like it, outlives every
 * crawler. Discoveries are read off each step's events and the crawler's pack at the end of the
 * step, so no handler has to remember to record anything:
 *
 *   - an enemy family (or floor boss) is found when a fight with it starts, or when one dies;
 *     the bestiary keeps how many you've met, killed, and how many crawlers it killed;
 *   - an item is found when it's in the pack of a crawler in play (base ids, so "Rusty Pipe of Ruin"
 *     counts as the pipe; not during creation, where a reroll's kit was never really found).
 */
import type { Content } from "./content/load";
import type { GameEventBody } from "./events";
import { narrateStable } from "./narrate/narrator";
import type { AccountState, EnemyTally } from "./state";
import type { StepContext } from "./step";

export function recordDiscoveries(ctx: StepContext, events: readonly GameEventBody[]): void {
  const codex = ctx.account.codex;
  const tallies = (codex.tallies ??= {});
  const tally = (id: string): EnemyTally => (tallies[id] ??= { met: 0, killed: 0, killedYou: 0 });
  const known = new Set(codex.enemies);
  const note = (id: string) => {
    if (known.has(id)) return;
    known.add(id);
    codex.enemies.push(id);
  };
  for (const e of events) {
    if (e.type === "combatStarted") for (const id of e.families) { note(id); tally(id).met += 1; }
    else if (e.type === "kill") { note(e.family); tally(e.family).killed += 1; }
    else if (e.type === "died" && e.killer) { note(e.killer); tally(e.killer).killedYou += 1; }
  }
  const c = ctx.game.crawler;
  // Not while making a crawler: a reroll's starting kit was never really found.
  if (!c || ctx.game.phase === "creation") return;
  const items = new Set(codex.items);
  for (const it of c.inventory) {
    if (items.has(it.baseId)) continue;
    items.add(it.baseId);
    codex.items.push(it.baseId);
  }
}

// ---------------------------------------------------------------- the view

export interface BestiaryEntry {
  id: string;
  name: string;
  description: string;
  met: number;
  killed: number;
  killedYou: number;
  boss: boolean;
  /** The System AI's take, from the tallies. */
  line: string;
}

export const ITEM_GROUPS = [
  ["weapons", "Weapons"], ["gear", "Gear and clothes"], ["potions", "Potions and medicine"], ["food", "Food"],
  ["explosives", "Explosives"], ["junk", "Junk"], ["books", "Tomes and scrolls"], ["oddities", "Oddities"],
] as const;
export type ItemGroup = (typeof ITEM_GROUPS)[number][0];

export interface ItemCodexGroup {
  id: ItemGroup;
  label: string;
  found: number;
  total: number;
  names: string[];
  line: string;
}

export interface AccountCodexView {
  bestiary: BestiaryEntry[];
  /** Enemy families (and bosses) the floors that exist can throw at you. */
  bestiaryTotal: number;
  items: { found: number; total: number; groups: ItemCodexGroup[] };
  achievements: { found: number; total: number };
}

function enemyInfo(content: Content, id: string): { name: string; description: string; boss: boolean } {
  const fam = content.enemies.byId[id];
  if (fam) return { name: fam.name, description: fam.description, boss: false };
  const boss = content.bosses.byId[id];
  if (boss) return { name: boss.name, description: boss.family?.description ?? "", boss: true };
  return { name: id, description: "", boss: false };
}

export function itemGroup(content: Content, id: string): ItemGroup {
  if (content.oddities.has(id)) return "oddities";
  const base = content.items.bases.byId[id];
  if (base) return base.power ? "weapons" : "gear";
  const cons = content.items.consumables.byId[id];
  if (!cons) return "junk";
  if (cons.type === "tome" || cons.type === "scroll") return "books";
  if (cons.type === "food" || cons.type === "explosive" || cons.type === "junk") return cons.type === "explosive" ? "explosives" : cons.type;
  return "potions";
}

function itemName(content: Content, id: string): string {
  return content.oddities.byId[id]?.name ?? content.items.bases.byId[id]?.name ?? content.items.consumables.byId[id]?.name ?? id;
}

/** How many items each group holds: content never changes while it's loaded, so this is worked out once. */
const TOTALS = new WeakMap<Content, { totals: Map<ItemGroup, number>; size: number }>();
function itemTotals(content: Content): { totals: Map<ItemGroup, number>; size: number } {
  let t = TOTALS.get(content);
  if (!t) {
    const ids = new Set([...content.items.bases.all.map((b) => b.id), ...content.items.consumables.all.map((c) => c.id)]);
    const totals = new Map<ItemGroup, number>();
    for (const id of ids) totals.set(itemGroup(content, id), (totals.get(itemGroup(content, id)) ?? 0) + 1);
    t = { totals, size: ids.size };
    TOTALS.set(content, t);
  }
  return t;
}

export function accountCodexView(content: Content, account: AccountState): AccountCodexView {
  const codex = account.codex;
  const bestiary = codex.enemies.map((id): BestiaryEntry => {
    const info = enemyInfo(content, id);
    const t = codex.tallies?.[id] ?? { met: 0, killed: 0, killedYou: 0 };
    const ctx = { ...t, name: info.name, boss: info.boss };
    return { id, ...info, ...t, line: narrateStable(content, "codex.enemy", ctx, id) };
  });
  const { totals, size } = itemTotals(content);
  const byGroup = new Map<ItemGroup, string[]>();
  for (const id of codex.items) {
    const g = itemGroup(content, id);
    byGroup.set(g, [...(byGroup.get(g) ?? []), itemName(content, id)]);
  }
  const groups = ITEM_GROUPS.map(([id, label]): ItemCodexGroup => {
    const names = (byGroup.get(id) ?? []).sort((a, b) => a.localeCompare(b));
    const total = totals.get(id) ?? 0;
    return { id, label, found: names.length, total, names, line: narrateStable(content, "codex.items", { group: id, found: names.length, total }, `${id}:${names.length}`) };
  });
  return {
    bestiary,
    bestiaryTotal: content.enemies.all.length + content.bosses.all.filter((b) => b.family).length,
    items: { found: codex.items.length, total: size, groups },
    achievements: { found: codex.achievements.length, total: content.achievements.all.length },
  };
}
