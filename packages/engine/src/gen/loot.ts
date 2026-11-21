/**
 * Room contents (Milestone 4b). Every room type rolls some junk from a loot
 * table on the floor theme: some lying in plain sight, some only found by
 * `search`. The first safe room always holds a tutorial kit (a pipe, tacks,
 * tape — the nail bat is one `combine` away), and a couple of ordinary rooms
 * become workshops with a workbench.
 *
 * This runs after generateFloor() so the map generator (and its tests) stay
 * about the map. Loot tables are the seam Milestone 5/7 reuse for drops and boxes.
 */
import type { Content } from "../content/load";
import type { FloorTheme, LootTable } from "../content/schemas";
import { chance, int, pick, shuffle, weightedPick } from "../rng";
import type { FloorState, ItemInstance, Room } from "../state";
import { bfsDistances } from "./floor";
import { itemFromRef } from "./item";
import { addToPile } from "../inventory";

export function rollLoot(table: LootTable, content: Content): ItemInstance {
  const e = weightedPick(table.entries, (x) => x.weight);
  const qty = e.qty ? int(e.qty[0], e.qty[1]) : 1;
  return itemFromRef(content, e.item, qty);
}

function rollMany(content: Content, tableId: string, range: readonly [number, number]): ItemInstance[] {
  const table = content.lootTables.get(tableId);
  const out: ItemInstance[] = [];
  for (let n = int(range[0], range[1]); n > 0; n--) addToPile(out, rollLoot(table, content));
  return out;
}

export function seedFloorLoot(floor: FloorState, theme: FloorTheme, content: Content): void {
  const loot = theme.loot;
  for (const room of floor.rooms) {
    const rl = loot.rooms[room.type];
    if (!rl) continue;
    const items = rollMany(content, rl.table, rl.visible);
    const hidden = rollMany(content, rl.table, rl.hidden);
    if (items.length) room.items = items;
    if (hidden.length) room.hidden = hidden;
  }

  // Safe rooms are workshops by definition; the first one (nearest the start) gets the kit.
  const fromStart = bfsDistances(floor.rooms, floor.startRoom);
  const safes = floor.rooms.filter((r) => r.type === "safe").sort((a, b) => fromStart[a.id]! - fromStart[b.id]!);
  for (const r of safes) r.workbench = true;
  const first = safes[0];
  if (first && loot.firstSafe.length) {
    first.items ??= [];
    for (const f of loot.firstSafe) addToPile(first.items, itemFromRef(content, f.item, f.qty));
  }

  // A couple of ordinary rooms with a bench, away from the safe rooms.
  const safeDist = safes.map((s) => bfsDistances(floor.rooms, s.id));
  const candidates = floor.rooms.filter((r) =>
    (r.type === "chamber" || r.type === "empty" || r.type === "puzzle") && r.shape !== "corridor" &&
    r.id !== floor.startRoom && safeDist.every((d) => d[r.id]! >= 3));
  const count = int(loot.workshops[0], loot.workshops[1]);
  for (const r of shuffle(candidates).slice(0, count)) {
    r.workbench = true;
    if (loot.workshopTable) {
      r.items ??= [];
      for (const it of rollMany(content, loot.workshopTable, [1, 2])) addToPile(r.items, it);
    }
  }
  scatterFloorLoot(floor, theme, content);
}

/**
 * The floor's scatter list (floors.json → loot.scatter): module parts, a boss's counter
 * item, a hand-written oddity. Spread over ordinary rooms, some only found by searching.
 */
export function scatterFloorLoot(floor: FloorState, theme: FloorTheme, content: Content): void {
  const open = floor.rooms.filter((r) => r.id !== floor.startRoom && r.type !== "stairwell" && r.type !== "safe" && !r.boss);
  if (open.length === 0) return;
  for (const s of theme.loot.scatter) {
    for (let n = int(s.count[0], s.count[1]); n > 0; n--) {
      const item = s.table ? rollLoot(content.lootTables.get(s.table), content)
        : s.item ? itemFromRef(content, s.item)
        : oddityFor(content, floor.floor);
      if (!item) continue;
      const room = pick(open);
      const pile = chance(s.hiddenChance) ? (room.hidden ??= []) : (room.items ??= []);
      addToPile(pile, item);
    }
  }
}

/** A random oddity whose floor range covers this floor (boss counters are placed on purpose instead). */
export function oddityFor(content: Content, floor: number): ItemInstance | undefined {
  const pool = content.oddities.all.filter((o) => o.threadTie !== "Boss weakness" && o.floors[0] <= floor && floor <= o.floors[1]);
  return pool.length ? itemFromRef(content, pick(pool).id) : undefined;
}

/** One line for a workshop's description. */
export function workbenchLine(theme: FloorTheme, room: Room): string | undefined {
  if (!room.workbench || theme.loot.workbenchLines.length === 0) return undefined;
  return pick(theme.loot.workbenchLines);
}
