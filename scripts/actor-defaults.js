import { MODULE_ID, fmt, report, uid, t } from "./utils.js";
import { createDefaultGroupService } from "./default-groups.js";

export const ACTOR_DEFAULT_GROUPS = Object.freeze([
  {name: "attack", category: "voice.attack"},
  {name: "take cover", category: "voice.take-cover"},
  {name: "enter building", category: "voice.enter-building"},
  {name: "move", category: "voice.move"},
  {name: "run", category: "voice.run"},
  {name: "wounded", category: "voice.wounded"},
  {name: "retreat", category: "voice.retreat"}
].map(Object.freeze));

const normalizedName = name => String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Move the old default's references into move; run receives its own empty pool.
 * Custom category keys are intentionally left alone. No audio assets are changed. */
function migrateMovementGroups(library) {
  const legacy = library.groups.filter(group => group.category === "voice.movement"
    || (!group.category && normalizedName(group.name) === "movement"));
  if (!legacy.length) return false;
  const legacySet = new Set(legacy);
  let target = library.groups.find(group => !legacySet.has(group) && group.category === "voice.move")
    ?? library.groups.find(group => !legacySet.has(group) && !group.category && normalizedName(group.name) === "move");
  if (!target) target = legacy.shift();
  if (![target, ...legacy].every(group => Array.isArray(group.entries))) throw new Error(t("UnsupportedSchema"));
  target.category = "voice.move";
  if (normalizedName(target.name) === "movement") target.name = "move";
  for (const group of legacy) {
    for (const entry of group.entries) {
      const existing = target.entries.find(candidate => candidate.id === entry.id);
      if (existing && JSON.stringify(existing) === JSON.stringify(entry)) continue;
      // Different references with a colliding ID must both survive the merge.
      target.entries.push(existing ? {...entry, id: uid()} : entry);
    }
  }
  const merged = new Set(legacy);
  library.groups = library.groups.filter(group => !merged.has(group));
  return true;
}

const defaults = createDefaultGroupService("Actor", ACTOR_DEFAULT_GROUPS, migrateMovementGroups);
export const addActorDefaults = defaults.add;
export const seedNewActor = defaults.seed;
export const ensureActorDefaults = defaults.ensure;

/** One elected GM migrates world Actors and existing unlinked scene token Actors. */
export async function initializeActorDefaults() {
  const summary = {updated: 0, failed: 0};
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return summary;
  const seen = new Set();
  async function initialize(actor) {
    if (!actor || seen.has(actor.uuid)) return;
    seen.add(actor.uuid);
    try { if (await ensureActorDefaults(actor)) summary.updated++; }
    catch (error) {
      summary.failed++;
      console.error(`${MODULE_ID} | Default Actor groups: ${actor.uuid}`, error);
    }
  }
  for (const actor of game.actors) await initialize(actor);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) if (!token.actorLink) await initialize(token.actor);
  }
  if (summary.failed) ui.notifications.warn(fmt("ActorDefaultsFailed", {count: summary.failed}));
  return summary;
}

export function registerActorDefaults() {
  Hooks.on("preCreateActor", document => {
    try { seedNewActor(document); }
    catch (error) { report(error); }
  });
}
