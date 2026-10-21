import { MODULE_ID, clone, t } from "./utils.js";

export const ACTOR_DEFAULT_GROUPS = Object.freeze([
  {name: "attack", category: "voice.attack"},
  {name: "take cover", category: "voice.take-cover"},
  {name: "enter building", category: "voice.enter-building"},
  {name: "move", category: "voice.move"},
  {name: "run", category: "voice.run"},
  {name: "wounded", category: "voice.wounded"},
  {name: "retreat", category: "voice.retreat"}
].map(Object.freeze));

export const ITEM_DEFAULT_GROUPS = Object.freeze([
  {name: "Bolt-Action", category: "weapon.bolt-action"},
  {name: "Semi-Auto", category: "weapon.semi-auto"},
  {name: "LMG", category: "weapon.lmg"},
  {name: "HMG", category: "weapon.hmg"},
  {name: "Sub-Machine", category: "weapon.sub-machine"},
  {name: "Pistol", category: "weapon.pistol"},
  {name: "Cannon", category: "weapon.cannon"},
  {name: "Reload", category: "weapon.reload"},
  {name: "Explosion", category: "weapon.explosion"}
].map(Object.freeze));

export function prototypeKey(kind) {
  if (!["voice", "weapon"].includes(kind)) throw new TypeError("Unknown prototype kind");
  return kind === "voice" ? "prototypeVoice" : "prototypeWeapon";
}

export function builtinPrototype(kind) {
  prototypeKey(kind);
  return {schemaVersion: 1, groups: clone(kind === "voice" ? ACTOR_DEFAULT_GROUPS : ITEM_DEFAULT_GROUPS)};
}

/** Validate the entire draft before saving or touching any document. No row limit. */
export function validatePrototype(kind, value) {
  prototypeKey(kind);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.groups)) throw new Error(t("UnsupportedPrototype"));
  const keys = new Set();
  const names = new Set();
  const groups = value.groups.map(group => {
    if (typeof group?.name !== "string" || !group.name.trim() || group.name.trim().length > 200) throw new Error(t("PrototypeNameInvalid"));
    const name = group.name.trim();
    const normalized = name.toLowerCase().replace(/\s+/g, " ");
    if (names.has(normalized)) throw new Error(t("PrototypeDuplicateName"));
    names.add(normalized);
    const category = typeof group.category === "string" ? group.category.trim() : "";
    if (category.length > 100 || !category.startsWith(`${kind}.`) || category.length === kind.length + 1
      || !/^[a-zA-Z0-9_.-]+$/.test(category)) throw new Error(t(kind === "voice" ? "PrototypeVoiceKeyInvalid" : "PrototypeWeaponKeyInvalid"));
    if (category === "voice.movement") throw new Error(t("PrototypeLegacyKey"));
    if (keys.has(category)) throw new Error(t("DuplicateCategory"));
    keys.add(category);
    return {name, category};
  });
  return {schemaVersion: 1, groups};
}

export function getPrototype(kind) {
  const key = prototypeKey(kind);
  const value = globalThis.game?.settings?.get(MODULE_ID, key);
  return validatePrototype(kind, value === undefined ? builtinPrototype(kind) : value);
}
