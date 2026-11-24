/**
 * Sleep deprivation (Milestone 6c): the only attrition system. Minutes awake since the
 * last proper sleep put the crawler in a stage; stages are data (pacing.json).
 */
import type { Content } from "../content/load";
import type { SleepStage } from "../content/schemas";
import type { Crawler } from "../state";
import type { Modifier } from "../content/schemas";

export const awakeHours = (c: Pick<Crawler, "awakeMin">): number => (c.awakeMin ?? 0) / 60;

export function sleepStageAt(content: Content, hours: number): SleepStage {
  const stages = content.pacing.sleepStages;
  let found = stages[0]!;
  for (const s of stages) if (hours >= s.fromHours) found = s;
  return found;
}

export function sleepStage(c: Pick<Crawler, "awakeMin">, content: Content): SleepStage {
  return sleepStageAt(content, awakeHours(c));
}

/** The stage's hit / dodge / damage penalties as ordinary modifiers. */
export function sleepModifiers(c: Pick<Crawler, "awakeMin">, content: Content): Modifier[] {
  const s = sleepStage(c, content);
  const out: Modifier[] = [];
  if (s.hit) out.push({ to: "hit", value: s.hit } as Modifier);
  if (s.dodge) out.push({ to: "defense", value: s.dodge } as Modifier);
  if (s.damage) out.push({ to: "damage", value: s.damage } as Modifier);
  return out;
}

/** Scouting and search cost, with the stage's surcharge. */
export function actionMinutes(c: Pick<Crawler, "awakeMin">, content: Content, base: number): number {
  return Math.ceil(base * (1 + sleepStage(c, content).actionCostPct / 100));
}
