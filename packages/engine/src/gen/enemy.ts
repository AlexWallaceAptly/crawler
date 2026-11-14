/**
 * Enemy generation (spec: Enemies and bosses).
 * level = floor*4 + random(-1, 2); stats shift 1 per level away from that baseline;
 * maxHP = hpBase * (1 + 0.25*level) * tierMult; mods bake into the instance at spawn.
 */
import type { Content } from "../content/load";
import { STATS, type EnemyFamily, type EnemyMod } from "../content/schemas";
import { chance, int, pickN, uid, weightedPick } from "../rng";
import type { Enemy } from "../state";

const TIER = {
  mob: { hpMult: 1, mods: [0, 1] as const },
  elite: { hpMult: 2.5, mods: [1, 2] as const },
};

export function generateEnemy(family: EnemyFamily, tier: "mob" | "elite", floor: number, content: Content): Enemy {
  const level = Math.max(1, floor * 4 + int(-1, 2));
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
    xp: Math.round(family.xp * (1 + 0.15 * level) * (tier === "elite" ? 3 : 1)),
  };
}

function fleeThreshold(ai: string[]): number {
  for (const token of ai) {
    const m = /^flee_below_(\d+)$/.exec(token);
    if (m) return Number(m[1]) / 100;
  }
  return 0;
}

/** Roll an encounter group: 1 family, groupSize rolls; elites lead lair packs. */
export function generateGroup(floor: number, elite: boolean, content: Content): Enemy[] {
  const families = content.enemies.all.filter((f) => f.floor === floor);
  if (families.length === 0) return [];
  const family = pickN(families, 1)[0]!;
  const out: Enemy[] = [];
  if (elite) {
    out.push(generateEnemy(family, "elite", floor, content));
    if (chance(0.4)) {
      const extra = int(1, 2);
      for (let i = 0; i < extra; i++) out.push(generateEnemy(family, "mob", floor, content));
    }
  } else {
    const n = int(family.groupSize[0], family.groupSize[1]);
    for (let i = 0; i < n; i++) out.push(generateEnemy(family, "mob", floor, content));
  }
  return out;
}
