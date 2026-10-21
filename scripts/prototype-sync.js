import { MODULE_ID, clone, t } from "./utils.js";
import { getPrototype, prototypeKey, validatePrototype } from "./prototype-data.js";
import { initializeActorDefaults } from "./actor-defaults.js";
import { initializeItemDefaults } from "./item-defaults.js";

let syncQueue = Promise.resolve();
let pendingSync;
const saves = new Map();
export const isPrototypeWriter = () => Boolean(game.user.isGM && game.users.activeGM?.id === game.user.id);

/** Each pass re-reads current settings. Failed passes do not poison later retries. */
export function synchronizePrototypes() {
  if (!isPrototypeWriter()) return Promise.resolve({updated: 0, failed: 0, delegated: true});
  let signature;
  try { signature = JSON.stringify([getPrototype("voice"), getPrototype("weapon")]); }
  catch (error) { return Promise.reject(error); }
  if (pendingSync?.signature === signature) return pendingSync.task;
  const task = syncQueue.catch(() => {}).then(async () => {
    if (!isPrototypeWriter()) return {updated: 0, failed: 0, delegated: true};
    // Fail closed for invalid settings, before any document gets a write.
    getPrototype("voice"); getPrototype("weapon");
    const actors = await initializeActorDefaults();
    const items = await initializeItemDefaults();
    return {updated: actors.updated + items.updated, failed: actors.failed + items.failed, delegated: false};
  });
  syncQueue = task;
  pendingSync = {signature, task};
  task.finally(() => { if (pendingSync?.task === task) pendingSync = undefined; }).catch(() => {});
  return task;
}

/** Persist configuration first. Document failures are reported and retried on
 * the next save, GM reload or owner-opened archive; never roll back live flags. */
export function savePrototype(kind, draft, expected) {
  const key = prototypeKey(kind);
  const input = validatePrototype(kind, draft);
  const original = clone(expected);
  const task = (saves.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!game.user.isGM) throw new Error(t("PrototypeGMOnly"));
    const current = getPrototype(kind);
    if (JSON.stringify(current) !== JSON.stringify(original)) throw new Error(t("PrototypeConflict"));
    if (JSON.stringify(current) !== JSON.stringify(input)) await game.settings.set(MODULE_ID, key, input);
    return synchronizePrototypes();
  });
  saves.set(key, task);
  task.finally(() => { if (saves.get(key) === task) saves.delete(key); }).catch(() => {});
  return task;
}
