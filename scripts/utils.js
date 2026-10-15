export const MODULE_ID = "dominion-sound-archive";
export const SCHEMA_VERSION = 1;
export const uid = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID();
export const clone = value => structuredClone(value);
export const t = key => game.i18n.localize(`DSA.${key}`);
export const fmt = (key, data) => game.i18n.format(`DSA.${key}`, data);
export const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);

export function report(error) {
  console.error(`${MODULE_ID} |`, error);
  ui.notifications.error(error?.message ?? t("UnexpectedError"));
}

export function isAudioPath(path) {
  return typeof path === "string" && /\.(ogg|oga|mp3|wav|webm|m4a|aac|flac|opus)(?:[?#].*)?$/i.test(path);
}

export function validatePath(path, audio = false) {
  if (typeof path !== "string" || !path.trim() || /[\u0000-\u001f]/.test(path)) throw new Error(t("InvalidPath"));
  const value = path.trim();
  // Relative Foundry paths and HTTP(S) assets only; never accept executable URLs.
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) throw new Error(t("InvalidPath"));
  if (value.startsWith("//")) throw new Error(t("InvalidPath"));
  if (audio && !isAudioPath(value)) throw new Error(t("NotAudio"));
  return value;
}

export function pathName(path) {
  const name = String(path).split(/[?#]/)[0].replace(/\/$/, "").split("/").pop() || path;
  try { return decodeURIComponent(name); } catch { return name; }
}
