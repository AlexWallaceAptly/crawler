import type { Content } from "../content/load";
import type { Consumable, ItemBase } from "../content/schemas";
import { uid } from "../rng";
import type { ItemInstance } from "../state";

/** A plain common item straight from its base (no material/affixes). Used for starting kit. */
export function itemFromBase(base: ItemBase): ItemInstance {
  return {
    uid: uid("it"),
    baseId: base.id,
    kind: "gear",
    name: base.name,
    rarity: "common",
    slot: base.slot,
    ...(base.twoHanded ? { twoHanded: true } : {}),
    ...(base.weaponType ? { weaponType: base.weaponType } : {}),
    ...(base.damage ? { damage: base.damage } : {}),
    ...(base.damageType ? { damageType: base.damageType } : {}),
    ...(base.stat ? { stat: base.stat } : {}),
    ...(base.range ? { range: base.range } : {}),
    ...(base.armor !== undefined ? { armor: base.armor } : {}),
    modifiers: base.modifiers.slice(),
    weight: base.weight,
    value: base.value,
    qty: 1,
    ...(base.flavor ? { flavor: base.flavor } : {}),
    tags: base.tags.slice(),
  };
}

export function itemFromConsumable(c: Consumable, qty = 1): ItemInstance {
  return {
    uid: uid("it"),
    baseId: c.id,
    kind: "consumable",
    name: c.name,
    rarity: "common",
    modifiers: [],
    weight: c.weight,
    value: c.value,
    qty,
    flavor: c.text,
    tags: c.tags.slice(),
  };
}

/** Build an item from a base or consumable id. */
export function itemFromRef(content: Content, id: string): ItemInstance {
  if (content.items.bases.has(id)) return itemFromBase(content.items.bases.get(id));
  return itemFromConsumable(content.items.consumables.get(id));
}

export function isWeapon(item: ItemInstance): boolean {
  return item.kind === "gear" && item.slot === "mainHand" && !!item.damage;
}
