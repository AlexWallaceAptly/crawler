/**
 * Room state at floor generation (Milestone 6c): which groups wait where, which rooms are
 * dense, which hold a hazard, and which loot stays hidden until searched. Runs after
 * seedFloorLoot (it only moves and tags what's there; drop tables are untouched).
 */
import type { Content } from "../content/load";
import type { FloorTheme } from "../content/schemas";
import { chance, int, random, shuffle } from "../rng";
import type { FloorState, GroupKind, ItemInstance, Room } from "../state";
import { addToPile } from "../inventory";
import { rollLoot } from "./loot";

/** Rooms that can hold a fight or a hazard (not the start, safe rooms, stairwells or a boss's room). */
const ordinary = (floor: FloorState, r: Room) =>
  r.id !== floor.startRoom && r.type !== "safe" && r.type !== "stairwell" && !r.boss;

export function seedRoomState(floor: FloorState, theme: FloorTheme, content: Content): void {
  const cfg = content.pacing;
  const open = floor.rooms.filter((r) => ordinary(floor, r));

  // --- hazards and groups from the room type ---
  for (const room of open) {
    const rs = room.rs;
    if (room.trap) rs.hazards.push({ id: room.trap, active: true, intensity: 1, sourceTime: 0, ticks: 0 });
    let p = room.type === "lair" ? 1 : (cfg.groups.chance[room.type] ?? 0);
    if (room.type === "trap") p = floor.floor >= cfg.groups.trapFightFromFloor ? cfg.groups.trapFightChance : 0;
    if (p > 0 && chance(p)) {
      const kind: GroupKind = room.type === "lair" ? "elite" : room.type === "corridor" ? "corridor" : "pack";
      rs.groups.push({ kind });
    }
  }

  // --- dense rooms: one more group and a better reward, flagged "dangerous" when scouted ---
  const denseable = open.filter((r) => r.type !== "corridor" && r.type !== "empty");
  const share = cfg.dense.minPct + (cfg.dense.maxPct - cfg.dense.minPct) * random();
  const target = Math.round(open.length * share);
  for (const room of shuffle(denseable).slice(0, target)) {
    room.rs.dense = true;
    for (let n = 0; n < cfg.dense.extraGroups; n++) room.rs.groups.push({ kind: "pack" });
    const rl = theme.loot.rooms[room.type];
    if (rl) {
      const table = content.lootTables.get(rl.table);
      for (let n = 0; n < cfg.dense.extraRewardRolls; n++) addToPile((room.hidden ??= []), rollLoot(table, content, floor.floor));
    }
  }

  // --- loot is hidden by default ---
  for (const room of floor.rooms) {
    if (room.type !== "safe" && room.items?.length) {
      const stay: ItemInstance[] = [];
      for (const it of room.items) {
        if (it.plain) stay.push(it);
        else addToPile((room.hidden ??= []), it);
      }
      if (stay.length) room.items = stay;
      else delete room.items;
    }
    for (const it of room.hidden ?? []) {
      it.searchDc = int(cfg.search.dcMin, cfg.search.dcMax) + (room.rs.dense ? cfg.search.denseDcBonus : 0);
    }
    room.rs.hiddenTotal = (room.hidden ?? []).reduce((n, it) => n + it.qty, 0);
  }
}
