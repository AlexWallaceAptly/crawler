/**
 * Enemy generation (spec: Enemies and bosses).
 * level = floor*4 + random(-1, 2) + tier.levelOffset; stats shift 1 per level away
 * from the floor baseline; maxHP = hpBase * (1 + 0.25*level) * tierMult; mods bake
 * into the instance at spawn.
 *
 * Milestone 4b: ordinary fights are packs of minions (two levels down, 60% HP and
 * XP, no mods), so the crawler fights several weak things instead of one sturdy one.
 */
import type { Content } from "../content/load";
import { STATS, type EnemyFamily, type EnemyMod } from "../content/schemas";
import { chance, int, pick, shuffle, uid, weightedPick } from "../rng";
import type { Enemy, EnemyTier } from "../state";

/** Tier tuning. A boss row lands with Milestone 9; Claude runs it in Milestone 10. */
export const TIER: Record<EnemyTier, { hpMult: number; mods: readonly [number, number]; levelOffset: number; xpMult: number }> = {
  minion: { hpMult: 0.6, mods: [0, 0], levelOffset: -2, xpMult: 0.6 },
  mob: { hpMult: 1, mods: [0, 1], levelOffset: 0, xpMult: 1 },
  elite: { hpMult: 2.5, mods: [1, 2], levelOffset: 0, xpMult: 3 },
};

export function generateEnemy(family: EnemyFamily, tier: EnemyTier, floor: number, content: Content): Enemy {
  const level = Math.max(1, floor * 4 + int(-1, 2) + TIER[tier].levelOffset);
  const baseline = floor * 4; // the level family.stats are written for
  const shift = level - baseline;

  const stats = { ...family.stats };
  for (const s of STATS) stats[s] = Math.max(1, stats[s] + shift);

  const modCount = int(TIER[tier].mods[0], TIER[tier].mods[1]);
  const mods: EnemyMod[] = [];
  const pool = content.enemyMods.all.slice();
  for (let i = 0; i < modCount && pool.length > 0; i++) {
    const m = weightedPick(pool, (x) => x.weight);
    mods.push(m);
    pool.splice(pool.indexOf(m), 1);
  }

  let hpMult = TIER[tier].hpMult;
  let armor = family.armor;
  let defenseBonus = 0;
  let damageBonus = 0;
  let initiativeBonus = 0;
  let regen = 0;
  let talkable = family.talkable;
  let fleeBelow = fleeThreshold(family.ai);
  let statusOnHit: EnemyMod["statusOnHit"];
  for (const m of mods) {
    hpMult *= m.hpMult;
    armor += m.armorBonus;
    defenseBonus += m.defenseBonus;
    damageBonus += m.damageBonus;
    initiativeBonus += m.initiativeBonus;
    regen += m.regen;
    if (m.talkable) talkable = true;
    if (m.fleeBelow !== undefined) fleeBelow = Math.max(fleeBelow, m.fleeBelow);
    if (m.statusOnHit) statusOnHit = m.statusOnHit;
  }

  const maxHP = Math.max(1, Math.round(family.hpBase * (1 + 0.25 * level) * hpMult));
  const attacks = family.attacks.map((a) => ({
    ...a,
    dice: damageBonus ? `${a.dice}${damageBonus > 0 ? "+" : ""}${damageBonus}` : a.dice,
    ...(statusOnHit && !a.status ? { status: statusOnHit } : {}),
    ready: 0,
  }));

  return {
    uid: uid("en"),
    familyId: family.id,
    name: [...mods.map((m) => m.name), family.name].join(" "),
    level,
    tier,
    speed: family.speed,
    stats,
    maxHP,
    hp: maxHP,
    armor,
    defense: 10 + Math.floor(stats.DEX / 2) + armor + defenseBonus,
    attacks,
    ai: family.ai,
    preferRange: family.preferRange,
    talkable,
    range: family.preferRange,
    statuses: [],
    regen,
    fleeBelow,
    initiative: initiativeBonus, // the d20 is rolled at combat start
    xp: Math.max(1, Math.round(family.xp * (1 + 0.15 * level) * TIER[tier].xpMult)),
  };
}

function fleeThreshold(ai: string[]): number {
  for (const token of ai) {
    const m = /^flee_below_(\d+)$/.exec(token);
    if (m) return Number(m[1]) / 100;
  }
  return 0;
}

export type EncounterKind = "pack" | "corridor" | "elite";

/**
 * Roll an encounter.
 * - pack / corridor: 2-4 (2-3 in corridors) minions. The first family fills what
 *   its groupSize allows; a second family fills the rest, or joins anyway on
 *   `mixedChance`. Never a lone enemy.
 * - elite: one elite of a family, alone or with 1-2 minion escorts of the same family.
 */
export function generateGroup(floor: number, kind: EncounterKind, content: Content): Enemy[] {
  const families = content.enemies.all.filter((f) => f.floor === floor);
  if (families.length === 0) return [];
  const theme = content.floors.all.find((t) => t.floor === floor);
  const enc = theme?.encounters ?? { pack: [2, 4], corridorPack: [2, 3], mixedChance: 0.35, eliteAloneChance: 0.5, eliteEscorts: [1, 2] };

  if (kind === "elite") {
    const family = pick(families);
    const out = [generateEnemy(family, "elite", floor, content)];
    if (!chance(enc.eliteAloneChance)) {
      const extra = int(enc.eliteEscorts[0], enc.eliteEscorts[1]);
      for (let i = 0; i < extra; i++) out.push(generateEnemy(family, "minion", floor, content));
    }
    return out;
  }

  const [lo, hi] = kind === "corridor" ? enc.corridorPack : enc.pack;
  const total = int(Math.max(1, lo), Math.max(1, hi));
  const [primary, ...others] = shuffle(families);
  let first = Math.min(total, int(primary!.groupSize[0], primary!.groupSize[1]));
  const second = others[0];
  // Mix in a second family when the first can't fill the pack, or just because.
  if (second && total >= 2 && first === total && chance(enc.mixedChance)) first = int(1, total - 1);
  const out: Enemy[] = [];
  for (let i = 0; i < first; i++) out.push(generateEnemy(primary!, "minion", floor, content));
  if (second) {
    const rest = Math.min(total - first, second.groupSize[1]);
    for (let i = 0; i < rest; i++) out.push(generateEnemy(second, "minion", floor, content));
  }
  // Two capped families can still come up short; top the primary up past its cap
  // rather than ship a lone enemy.
  while (out.length < Math.min(2, total)) out.push(generateEnemy(primary!, "minion", floor, content));
  return out;
}

/**
 * Same-named enemies get letters ("Sump Rat A", "Sump Rat B") so they can be
 * told apart in the log and targeted by name.
 */
export function assignMarks(enemies: Enemy[]): void {
  const counts = new Map<string, number>();
  for (const e of enemies) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const e of enemies) {
    if ((counts.get(e.name) ?? 0) < 2) continue;
    const n = seen.get(e.name) ?? 0;
    seen.set(e.name, n + 1);
    e.mark = String.fromCharCode(65 + n);
  }
  for (const e of enemies) if (e.mark) e.name = `${e.name} ${e.mark}`;
}
