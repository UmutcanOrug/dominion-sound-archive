import { MODULE_ID, t, validatePath } from "./utils.js";

export const AUTOMATIC_SOUND_KEY = "automaticSoundMatching";
export const SOUND_EVENTS = Object.freeze(["attack", "hurt", "death"]);

export function normalizeSoundName(name) {
  return typeof name === "string"
    ? name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase().replace(/i\u0307/g, "i")
    : "";
}

export function validateSoundSets(sets) {
  if (!Array.isArray(sets)) throw new Error(t("AutoInvalidSets"));
  const names = new Set();
  return sets.map(set => {
    const name = typeof set?.name === "string" ? set.name.trim() : "";
    const key = normalizeSoundName(name);
    if (!key || name.length > 200) throw new Error(t("AutoNameRequired"));
    if (names.has(key)) throw new Error(t("AutoDuplicateName"));
    names.add(key);
    const soundSet = {name};
    for (const event of SOUND_EVENTS) {
      if (!Array.isArray(set[event])) throw new Error(t("AutoInvalidSets"));
      soundSet[event] = [...new Set(set[event].map(path => validatePath(path, true)))];
    }
    return soundSet;
  });
}

export function getAutomaticSounds() {
  const data = game.settings.get(MODULE_ID, AUTOMATIC_SOUND_KEY);
  if (data?.schemaVersion !== 1 || typeof data.enabled !== "boolean") throw new Error(t("AutoInvalidSets"));
  return {schemaVersion: 1, enabled: data.enabled, sets: validateSoundSets(data.sets)};
}

export function chooseAutomaticSound(sets, actorName, tokenName, event, random = Math.random) {
  const find = name => {
    const normalized = normalizeSoundName(name);
    return normalized && sets.find(set => normalizeSoundName(set.name) === normalized);
  };
  const pool = (find(actorName) || find(tokenName))?.[event];
  return pool?.length ? pool[Math.floor(random() * pool.length)] : undefined;
}
