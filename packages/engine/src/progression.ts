/**
 * Progression (Milestone 6a): character levels from XP, and skills that rank up from use.
 *
 * - Levels: `xpToNext` is tuned so the first hard fight on Floor 1 brings level 2, a couple
 *   more bring level 3, and clearing the floor (boss included) lands about level 5. `crawler.xp` is the
 *   progress inside the current level. Each level: +3 stat points to spend (`raise STR`),
 *   a full heal, and a System AI line. There are no skill points.
 * - Skills: every use earns skill XP (a swing, a shove that lands, a check passed...).
 *   `skillXpToNext` puts rank 1 three uses in, rank 5 42 uses in (a dedicated weapon
 *   user, end of Floor 1), rank 10 at 212 and rank 15 at 609 (around Floor 10, if ever). Trained ranks stop at 15;
 *   gear (`skill:<id>` modifiers) can push the rank used in rolls past that.
 * - Every 5th rank unlocks a perk (skills.json), announced as a milestone.
 */
import { STATS, type Stat } from "./content/schemas";
import type { Content } from "./content/load";
import { collectModifiers, derive, modTotal } from "./rules/derived";
import type { Modifier } from "./content/schemas";
import type { StepContext } from "./step";
import type { Crawler } from "./state";

/** Trained skill ranks stop here. Gear can add on top. */
export const SKILL_CAP = 15;
export const STAT_POINTS_PER_LEVEL = 3;

/** XP to go from `level` to the next: 25, 47, 67, 87, 106... (level 5 at 226 XP, level 10 at 946). */
export function xpToNext(level: number): number {
  return Math.round(25 * Math.max(1, level) ** 0.9);
}

/** Skill XP to go from `rank` to the next: 3, 5, 8, 11, 15 (rank 5 = 42 uses), rank 10 = 212, rank 15 = 609. */
export function skillXpToNext(rank: number): number {
  return Math.round(3 + 1.5 * rank + 0.4 * rank * rank);
}

/** The rank rolls use: trained rank plus gear (`skill:<id>`). Can pass 15. */
export function skillRank(c: Crawler, id: string, mods: readonly Modifier[]): number {
  return (c.skills[id]?.rank ?? 0) + modTotal(mods, `skill:${id}`);
}

/** The perk a skill unlocks at exactly this rank, if any. */
export function perkAt(content: Content, id: string, rank: number) {
  return content.skills.byId[id]?.perks.find((p) => p.rank === rank);
}

/** The next perk a skill has waiting above `rank`. */
export function nextPerk(content: Content, id: string, rank: number) {
  return content.skills.byId[id]?.perks.filter((p) => p.rank > rank).sort((a, b) => a.rank - b.rank)[0];
}

/** A perk's short name: its `name`, or the start of its text. */
export function perkName(p: { name?: string; text: string }): string {
  return p.name ?? p.text.replace(/\.$/, "");
}

// ---------------------------------------------------------------- levels

/**
 * Add character XP (after the quirk bonus) and take any level-ups it pays for.
 * `announce: false` leaves the level-up events to the caller (`announceLevels`), so a
 * fight's VICTORY line can print first. Returns the XP actually added and the new levels.
 */
export function gainXp(ctx: StepContext, amount: number, announce = true): { gained: number; levels: number[] } {
  const c = ctx.crawler;
  if (amount <= 0) return { gained: 0, levels: [] };
  const bonus = modTotal(collectModifiers(c, ctx.content), "perk:xpBonus");
  const gained = Math.max(1, Math.round(amount * (1 + bonus / 100)));
  c.xp += gained;
  const levels: number[] = [];
  while (c.xp >= xpToNext(c.level)) {
    c.xp -= xpToNext(c.level);
    c.level += 1;
    c.unspentStatPoints += STAT_POINTS_PER_LEVEL;
    levels.push(c.level);
  }
  if (levels.length) {
    const d = derive(c, ctx.content);
    c.hp = d.maxHP;
    c.mp = d.maxMP;
  }
  if (announce) announceLevels(ctx, levels);
  return { gained, levels };
}

/**
 * Saves from before leveling existed kept every point of XP at level 1. On load, take
 * the levels it already paid for (and their stat points), quietly: no popup for old news.
 */
export function catchUpLevels(c: Crawler): void {
  for (let i = 0; i < 200 && c.xp >= xpToNext(c.level); i++) {
    c.xp -= xpToNext(c.level);
    c.level += 1;
    c.unspentStatPoints += STAT_POINTS_PER_LEVEL;
  }
}

export function announceLevels(ctx: StepContext, levels: number[]): void {
  const c = ctx.crawler;
  for (const level of levels) {
    ctx.emit({ type: "levelUp", level, statPoints: STAT_POINTS_PER_LEVEL, unspent: c.unspentStatPoints, next: xpToNext(c.level) });
    ctx.say("progress.levelUp", { level, points: c.unspentStatPoints });
  }
}

/** `raise STR`: spend one stat point. Free, but not mid-fight. */
export function raiseStat(ctx: StepContext, stat: Stat, times = 1): void {
  const c = ctx.crawler;
  if (ctx.game.phase === "combat") {
    ctx.error("You can spend stat points after the fight. Right now, swing.");
    return;
  }
  if (c.unspentStatPoints <= 0) {
    ctx.error(`No stat points to spend. You get ${STAT_POINTS_PER_LEVEL} every level (${c.xp}/${xpToNext(c.level)} XP to level ${c.level + 1}).`);
    return;
  }
  const n = Math.max(1, Math.min(times, c.unspentStatPoints));
  const before = derive(c, ctx.content);
  c.baseStats[stat] += n;
  c.unspentStatPoints -= n;
  const after = derive(c, ctx.content);
  // More CON means more max HP; you get the new hit points now, not after a rest.
  if (after.maxHP > before.maxHP) c.hp += after.maxHP - before.maxHP;
  if (after.maxMP > before.maxMP) c.mp += after.maxMP - before.maxMP;
  ctx.info(`${stat} ${before.stats[stat]} → ${after.stats[stat]}.${c.unspentStatPoints ? ` ${c.unspentStatPoints} point${c.unspentStatPoints === 1 ? "" : "s"} left.` : ""}`);
}

export function isStat(s: string): s is Stat {
  return (STATS as readonly string[]).includes(s);
}

// ---------------------------------------------------------------- skills

export interface SkillProgress {
  id: string;
  name: string;
  rank: number;
  xp: number;
  /** XP to the next rank (0 at the cap). */
  next: number;
}

export function skillProgress(c: Crawler, content: Content, id: string): SkillProgress {
  const st = c.skills[id] ?? { rank: 0, xp: 0 };
  return {
    id, name: content.skills.byId[id]?.name ?? id, rank: st.rank, xp: st.xp,
    next: st.rank >= SKILL_CAP ? 0 : skillXpToNext(st.rank),
  };
}

/**
 * Skill XP for using something. A skill you've never used starts at rank 0, so three
 * uses teach it. In a fight the gains are tallied for the end-of-fight summary; out of
 * one, a quiet `skillXp` line says so. Rank-ups announce themselves (`skillUp`), and
 * ranks 1, 5, 10 and 15 get a System AI line.
 */
export function trainSkill(ctx: StepContext, id: string | undefined, amount = 1, ranks = 0): void {
  if (!id || (amount <= 0 && ranks <= 0)) return;
  const skill = ctx.content.skills.byId[id];
  if (!skill) return;
  const c = ctx.crawler;
  const st = (c.skills[id] ??= { rank: 0, xp: 0 });
  if (st.rank >= SKILL_CAP) return;
  st.xp += amount;
  const ups: number[] = [];
  for (let i = 0; i < ranks && st.rank < SKILL_CAP; i++) ups.push(++st.rank);
  while (st.rank < SKILL_CAP && st.xp >= skillXpToNext(st.rank)) {
    st.xp -= skillXpToNext(st.rank);
    ups.push(++st.rank);
  }
  if (st.rank >= SKILL_CAP) st.xp = 0;

  const combat = ctx.game.phase === "combat" ? ctx.game.combat : undefined;
  if (combat && amount > 0) {
    combat.skillGains ??= {};
    combat.skillGains[id] = (combat.skillGains[id] ?? 0) + amount;
  } else if (amount > 0 && ups.length === 0) {
    const { id: skillId, ...p } = skillProgress(c, ctx.content, id);
    ctx.emit({ type: "skillXp", skillId, ...p, gained: amount });
  }

  for (const rank of ups) {
    const perk = perkAt(ctx.content, id, rank);
    const coming = nextPerk(ctx.content, id, rank);
    ctx.emit({
      type: "skillUp", skillId: id, name: skill.name, rank,
      ...(perk ? { perk: perk.text, perkName: perkName(perk) } : {}),
      ...(coming ? { nextPerk: { rank: coming.rank, name: perkName(coming) } } : {}),
    });
    if (perk) ctx.say("progress.milestone", { skill: skill.name, rank, perk: perkName(perk) });
    else if (rank === 1) ctx.say("progress.skillLearned", { skill: skill.name });
  }
}

/**
 * Where a skill stands, in one line: "Blades 2 · 4/10 to rank 3 · rank 5: Decapitation",
 * or "Blades untrained · 3 uses to rank 1". `uses` names what trains it ("swings").
 */
export function skillLine(c: Crawler, content: Content, id: string, uses = "uses"): string {
  const p = skillProgress(c, content, id);
  const coming = nextPerk(content, id, p.rank);
  const head = p.rank === 0
    ? `${p.name} untrained · ${p.next - p.xp} ${uses} to rank 1`
    : p.next ? `${p.name} ${p.rank} · ${p.xp}/${p.next} to rank ${p.rank + 1}` : `${p.name} ${p.rank} (maxed)`;
  return coming ? `${head} · rank ${coming.rank}: ${perkName(coming)}` : head;
}

/** The fight's skill gains, for the end-of-fight line: "Blades +5 (rank 2 · 4/10)". */
export function fightSkillSummary(ctx: StepContext): (SkillProgress & { gained: number })[] {
  const gains = ctx.game.combat?.skillGains ?? {};
  return Object.entries(gains)
    .filter(([, n]) => n > 0)
    .map(([id, gained]) => ({ ...skillProgress(ctx.crawler, ctx.content, id), gained }));
}
