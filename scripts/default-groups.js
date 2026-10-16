import { MODULE_ID, SCHEMA_VERSION, clone, uid, t } from "./utils.js";
import { canEdit, getLibrary, mutate } from "./library-service.js";

const normalizedName = name => String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function validateLibrary(library) {
  if (library?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(library.groups)) throw new Error(t("UnsupportedSchema"));
}

/** Shared, additive defaults for Actor and Item archives. */
export function addDefaultGroups(library, definitions) {
  validateLibrary(library);
  const matches = new Map();
  const used = new Set();
  for (const definition of definitions) {
    const group = library.groups.find(group => group.category === definition.category && !used.has(group));
    if (group) { matches.set(definition, group); used.add(group); }
  }
  let changed = false;
  for (const definition of definitions) {
    let group = matches.get(definition);
    if (!group) {
      group = library.groups.find(group => !used.has(group) && normalizedName(group.name) === normalizedName(definition.name));
      if (group) used.add(group);
    }
    if (group) {
      // Adopt unkeyed matching names without replacing existing custom macro keys.
      if (!group.category) { group.category = definition.category; changed = true; }
    } else {
      library.groups.push({id: uid(), ...definition, entries: []});
      changed = true;
    }
  }
  return changed;
}

export function createDefaultGroupService(documentName, definitions, migrate) {
  const pending = new Map();
  const add = library => {
    validateLibrary(library);
    const migrated = migrate?.(library) ?? false;
    const added = addDefaultGroups(library, definitions);
    return migrated || added;
  };
  const seed = document => {
    if (document.documentName !== documentName) return;
    const raw = document.getFlag(MODULE_ID, "library");
    const library = raw ? clone(raw) : {schemaVersion: SCHEMA_VERSION, groups: []};
    if (add(library)) document.updateSource({[`flags.${MODULE_ID}.library`]: library});
  };
  const ensure = document => {
    if (document?.documentName !== documentName || !canEdit(document)) return Promise.resolve(false);
    if (pending.has(document.uuid)) return pending.get(document.uuid);
    const task = (async () => {
      if (!add(getLibrary(document))) return false;
      await mutate(document, library => { add(library); });
      return true;
    })();
    pending.set(document.uuid, task);
    task.finally(() => { if (pending.get(document.uuid) === task) pending.delete(document.uuid); }).catch(() => {});
    return task;
  };
  return Object.freeze({add, seed, ensure});
}
