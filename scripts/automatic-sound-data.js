import { MODULE_ID, pathName, t, validatePath } from "./utils.js";

export const AUTOMATIC_SOUND_KEY = "automaticSoundMatching";
export const SOUND_EVENTS = Object.freeze(["attack", "hurt", "death"]);
export const AUTOMATIC_SOUND_SCHEMA = 2;

function validateFolder(folder) {
  if (folder?.type !== "folder" || !["forgevtt", "data", "public", "s3"].includes(folder.source)
    || !Array.isArray(folder.clips) || (folder.excluded !== undefined && !Array.isArray(folder.excluded))) {
    throw new Error(t("AutoInvalidSets"));
  }
  const path = validatePath(folder.path);
  const excluded = [...new Set((folder.excluded ?? []).map(clip => validatePath(clip, true)))];
  const hidden = new Set(excluded);
  const paths = [...new Set(folder.clips.map(clip => validatePath(clip.path, true)))];
  return {type: "folder", path, source: folder.source, recursive: Boolean(folder.recursive),
    ...(folder.bucket ? {bucket: String(folder.bucket)} : {}),
    name: String(folder.name || pathName(path) || "/").trim().slice(0, 200),
    excluded, clips: paths.filter(clip => !hidden.has(clip)).map(path => ({path, name: pathName(path)}))};
}

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
      const files = new Set();
      soundSet[event] = [];
      for (const entry of set[event]) {
        if (typeof entry !== "string") {
          soundSet[event].push(validateFolder(entry));
          continue;
        }
        const path = validatePath(entry, true);
        if (files.has(path)) continue;
        files.add(path);
        soundSet[event].push(path);
      }
    }
    return soundSet;
  });
}

export function getAutomaticSounds() {
  const data = game.settings.get(MODULE_ID, AUTOMATIC_SOUND_KEY);
  if (![1, AUTOMATIC_SOUND_SCHEMA].includes(data?.schemaVersion) || typeof data.enabled !== "boolean") {
    throw new Error(t("AutoInvalidSets"));
  }
  return {schemaVersion: AUTOMATIC_SOUND_SCHEMA, enabled: data.enabled, sets: validateSoundSets(data.sets)};
}

export function chooseAutomaticSound(sets, actorName, tokenName, event, random = Math.random) {
  const find = name => {
    const normalized = normalizeSoundName(name);
    return normalized && sets.find(set => normalizeSoundName(set.name) === normalized);
  };
  const pool = (find(actorName) || find(tokenName))?.[event];
  const paths = [...new Set(pool?.flatMap(entry => typeof entry === "string" ? [entry] : entry.clips.map(clip => clip.path)))];
  return paths.length ? paths[Math.floor(random() * paths.length)] : undefined;
}
