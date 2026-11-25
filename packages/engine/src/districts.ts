/**
 * Districts at play time (Milestone 9). The split itself is in gen/district.ts; this file is what
 * a district means once you're on the floor: which one a room is in, what it adds to the enemies
 * rolled there, the line when you first cross in, and its Guide entry.
 */
import type { Content } from "./content/load";
import type { District } from "./content/schemas";
import type { GroupOptions } from "./gen/enemy";
import { guideAdd } from "./guide";
import type { FloorState, Room } from "./state";
import type { StepContext } from "./step";

/**
 * The district a room is in: its index and its floors.json entry. A floor with one district (or
 * one saved before districts) gives index 0 and no entry.
 */
export function districtOf(content: Content, floor: FloorState, room: Room): { index: number; def?: District } {
  const index = room.district ?? 0;
  const id = floor.districts?.[index];
  const def = id ? content.floors.byId[floor.theme]?.districts.find((d) => d.id === id) : undefined;
  return def ? { index, def } : { index: 0 };
}

/** How many levels a district adds to its enemies (spec: floor*4 + district.index). */
export const districtLevel = (def: District, index: number): number => def.levelOffset ?? index;

/** "a level", "2 levels": for lines that say how much tougher a district is. */
const levelsText = (n: number): string => (n === 1 ? "a level" : `${n} levels`);

/** What a room's district adds to a group rolled there: its level step, its favored families, its champion. */
export function districtGroupOptions(ctx: StepContext, room: Room, champion?: string): GroupOptions {
  const floor = ctx.game.floor!;
  const { index, def } = districtOf(ctx.content, floor, room);
  if (!def) return {};
  const theme = ctx.content.floors.byId[floor.theme];
  const champ = champion ? theme?.districts.find((d) => d.id === champion)?.champion : undefined;
  return {
    levelOffset: districtLevel(def, index),
    favored: def.favored,
    ...(champ && champion ? { champion: { district: champion, title: champ.title, family: champ.family, levelBonus: champ.levelBonus } } : {}),
  };
}

/** "District: The Stacks (2 of 3)", or null on a floor with one district. */
export function districtLabel(content: Content, floor: FloorState, room: Room): string | null {
  const { index, def } = districtOf(content, floor, room);
  return def ? `${def.name} (${index + 1} of ${floor.districts!.length})` : null;
}

/** The first time the crawler is in a district this floor: its line, the System AI's, the ticker and the Guide. */
export function noteDistrict(ctx: StepContext, room: Room): void {
  const floor = ctx.game.floor!;
  const { index, def } = districtOf(ctx.content, floor, room);
  if (!def || !floor.districts) return;
  const seen = (floor.districtsSeen ??= []);
  if (seen.includes(index)) return;
  seen.push(index);
  const of = floor.districts.length;
  const level = districtLevel(def, index);
  const alive = !!def.champion && !(floor.championsKilled ?? []).includes(def.id);
  ctx.describe(def.enter);
  ctx.say("district.entered", {
    name: def.name, index: index + 1, of, tougher: levelsText(level),
    first: index === 0, deep: index === of - 1 && of > 1,
    champion: def.champion?.title ?? "", championAlive: alive,
  });
  ctx.emit({ type: "districtEntered", floor: floor.floor, district: def.id, name: def.name, index, of, allSeen: seen.length === of });
  guideDistrict(ctx, floor, index);
}

/** The district's Guide entry (rewritten when its champion dies). */
export function guideDistrict(ctx: StepContext, floor: FloorState, index: number): void {
  const id = floor.districts?.[index];
  const def = id ? ctx.content.floors.byId[floor.theme]?.districts.find((d) => d.id === id) : undefined;
  if (!def || !floor.districts) return;
  const level = districtLevel(def, index);
  const lines = [def.enter, level > 0 ? `Enemies here are ${levelsText(level)} tougher than at the entrance.` : "The easiest part of the floor."];
  if (def.champion) {
    const dead = (floor.championsKilled ?? []).includes(def.id);
    lines.push(dead ? `Champion: the ${def.champion.title}. Dead. You did that.` : `Champion: the ${def.champion.title}, in a lair somewhere at the far end. Alive.`);
  }
  guideAdd(ctx.game, `district.${floor.floor}.${index}`, "districts", `${def.name} (district ${index + 1} of ${floor.districts.length})`, lines.join("\n"));
}

/** After a champion dies: its district's Guide entry says so. */
export function guideChampionKilled(ctx: StepContext, floor: FloorState, district: string): void {
  const index = floor.districts?.indexOf(district) ?? -1;
  if (index >= 0 && (floor.districtsSeen ?? []).includes(index)) guideDistrict(ctx, floor, index);
}
