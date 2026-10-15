import { MODULE_ID, SCHEMA_VERSION, clone, uid, t, fmt, report } from "./utils.js";
import { canEdit, getLibrary, mutate } from "./library-service.js";

export const ACTOR_DEFAULT_GROUPS = Object.freeze([
  {name: "attack", category: "voice.attack"},
  {name: "take cover", category: "voice.take-cover"},
  {name: "enter building", category: "voice.enter-building"},
  {name: "movement", category: "voice.movement"},
  {name: "wounded", category: "voice.wounded"},
  {name: "retreat", category: "voice.retreat"}
].map(Object.freeze));

const pending = new Map();
const normalizedName = name => String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Add missing defaults in place, preserving all existing groups, IDs and clips. */
export function addActorDefaults(library) {
  if (library.schemaVersion !== SCHEMA_VERSION || !Array.isArray(library.groups)) throw new Error(t("UnsupportedSchema"));
  const matches = new Map();
  const used = new Set();
  // Existing macro keys take priority over names, including renamed groups.
  for (const definition of ACTOR_DEFAULT_GROUPS) {
    const group = library.groups.find(group => group.category === definition.category && !used.has(group));
    if (group) { matches.set(definition, group); used.add(group); }
  }
  let changed = false;
  for (const definition of ACTOR_DEFAULT_GROUPS) {
    let group = matches.get(definition);
    if (!group) {
      group = library.groups.find(group => !used.has(group) && normalizedName(group.name) === definition.name);
      if (group) used.add(group);
    }
    if (group) {
      // Adopt an unkeyed group by name, without changing an existing custom key.
      if (!group.category) { group.category = definition.category; changed = true; }
    } else {
      library.groups.push({id: uid(), ...definition, entries: []});
      changed = true;
    }
  }
  return changed;
}

/** Runs synchronously before normal Actor creation, including imports/duplicates. */
export function seedNewActor(document) {
  const raw = document.getFlag(MODULE_ID, "library");
  const library = raw ? clone(raw) : {schemaVersion: SCHEMA_VERSION, groups: []};
  if (addActorDefaults(library)) document.updateSource({[`flags.${MODULE_ID}.library`]: library});
}

/** Persist defaults through the same ownership checks and queue as manual edits. */
export function ensureActorDefaults(document) {
  if (document?.documentName !== "Actor" || !canEdit(document)) return Promise.resolve(false);
  if (pending.has(document.uuid)) return pending.get(document.uuid);
  const task = (async () => {
    if (!addActorDefaults(getLibrary(document))) return false;
    await mutate(document, library => { addActorDefaults(library); });
    return true;
  })();
  pending.set(document.uuid, task);
  task.finally(() => { if (pending.get(document.uuid) === task) pending.delete(document.uuid); }).catch(() => {});
  return task;
}

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
