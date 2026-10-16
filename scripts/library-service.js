import { MODULE_ID, SCHEMA_VERSION, clone, uid, t, validatePath, pathName } from "./utils.js";
import { scanFolder } from "./forge-browser.js";

const queues = new Map();

export function assertDocument(document) {
  if (!["Actor", "Item"].includes(document?.documentName) || !document.uuid || typeof document.getFlag !== "function") {
    throw new TypeError(t("InvalidDocument"));
  }
}

export function canRead(document) {
  return Boolean(document?.testUserPermission?.(game.user, "OBSERVER"));
}

export function canEdit(document) {
  return canRead(document) && Boolean(document.isOwner && document.canUserModify(game.user, "update"))
    && !document.pack?.locked && !game.packs?.get(document.pack)?.locked;
}

export function requireRead(document) {
  assertDocument(document);
  if (!canRead(document)) throw new Error(t("ReadDenied"));
}

export function requireEdit(document) {
  requireRead(document);
  if (!canEdit(document)) throw new Error(t("EditDenied"));
}

export function getLibrary(document) {
  requireRead(document);
  const raw = document.getFlag(MODULE_ID, "library");
  if (!raw) return {schemaVersion: SCHEMA_VERSION, groups: []};
  if (raw.schemaVersion !== SCHEMA_VERSION || !Array.isArray(raw.groups)) throw new Error(t("UnsupportedSchema"));
  return clone(raw);
}

// Serialize this client's changes and re-read the current document before each write.
// Cross-client writes still follow Foundry's normal last-write-wins semantics.
export function mutate(document, operation) {
  const key = document?.uuid;
  const task = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    requireEdit(document);
    const library = getLibrary(document);
    const result = await operation(library);
    requireEdit(document);
    await document.setFlag(MODULE_ID, "library", library);
    return clone(result ?? library);
  });
  queues.set(key, task);
  task.finally(() => { if (queues.get(key) === task) queues.delete(key); }).catch(() => {});
  return task;
}

function groupIn(library, id) {
  const group = library.groups.find(g => g.id === id);
  if (!group) throw new Error(t("GroupMissing"));
  return group;
}

function entryIn(library, id) {
  for (const group of library.groups) {
    const entry = group.entries.find(e => e.id === id);
    if (entry) return {group, entry};
  }
  throw new Error(t("EntryMissing"));
}

function cleanName(name) {
  const result = String(name ?? "").trim().slice(0, 200);
  if (!result) throw new Error(t("NameRequired"));
  return result;
}

function categoryIn(library, category, exclude) {
  const result = String(category ?? "").trim().slice(0, 100);
  if (result && !/^[a-zA-Z0-9_.-]+$/.test(result)) throw new Error(t("InvalidCategory"));
  if (result && library.groups.some(g => g.id !== exclude && g.category === result)) throw new Error(t("DuplicateCategory"));
  return result;
}

export const addGroup = (document, {name, category}) => mutate(document, library => {
  const group = {id: uid(), name: cleanName(name), category: categoryIn(library, category), entries: []};
  library.groups.push(group);
  return group;
});

export const editGroup = (document, id, {name, category}) => mutate(document, library => {
  const group = groupIn(library, id);
  group.name = cleanName(name);
  group.category = categoryIn(library, category, id);
  return group;
});

export const removeGroup = (document, id) => mutate(document, library => {
  groupIn(library, id);
  library.groups = library.groups.filter(g => g.id !== id);
});

export const addFile = (document, groupId, {path, name, label = ""}) => mutate(document, library => {
  const entry = {id: uid(), type: "file", path: validatePath(path, true), name: cleanName(name || pathName(path)), label: String(label).slice(0, 200)};
  groupIn(library, groupId).entries.push(entry);
  return entry;
});

export async function addFolder(document, groupId, {path, source, name, recursive = false, bucket}) {
  requireEdit(document);
  const folder = {id: uid(), type: "folder", name: cleanName(name || pathName(path) || "/"),
    path: path || "/", source, recursive: Boolean(recursive), ...(bucket ? {bucket} : {})};
  folder.clips = await scanFolder(folder);
  folder.refreshedAt = new Date().toISOString();
  return mutate(document, library => {
    groupIn(library, groupId).entries.push(folder);
    return folder;
  });
}

export const editEntry = (document, id, {name, label = ""}) => mutate(document, library => {
  const {entry} = entryIn(library, id);
  entry.name = cleanName(name);
  entry.label = String(label).slice(0, 200);
  return entry;
});

export const removeEntry = (document, id) => mutate(document, library => {
  const {group} = entryIn(library, id);
  group.entries = group.entries.filter(e => e.id !== id);
});

export const removeFolderClip = (document, id, path) => mutate(document, library => {
  const {entry} = entryIn(library, id);
  if (entry.type !== "folder") throw new Error(t("EntryMissing"));
  // Hidden references stay excluded across refreshes; source files are untouched.
  entry.excluded = [...new Set([...(entry.excluded ?? []), path])];
  entry.clips = entry.clips.filter(c => c.path !== path);
});

export async function refreshFolder(document, entryId) {
  requireEdit(document);
  const {entry: snapshot} = entryIn(getLibrary(document), entryId);
  if (snapshot.type !== "folder") throw new Error(t("EntryMissing"));
  const clips = await scanFolder(snapshot);
  return mutate(document, library => {
    const {entry} = entryIn(library, entryId);
    if (entry.path !== snapshot.path || entry.source !== snapshot.source) throw new Error(t("EntryChanged"));
    const excluded = new Set(entry.excluded ?? []);
    entry.clips = clips.filter(c => !excluded.has(c.path));
    entry.refreshedAt = new Date().toISOString();
    return entry;
  });
}

export function reorder(document, {groupId, entryId, beforeId, offset}) {
  return mutate(document, library => {
    const array = entryId ? groupIn(library, groupId).entries : library.groups;
    const id = entryId || groupId;
    const index = array.findIndex(e => e.id === id);
    if (index < 0) throw new Error(t("EntryMissing"));
    let target = offset !== undefined ? Math.max(0, Math.min(array.length - 1, index + offset)) : array.findIndex(e => e.id === beforeId);
    if (target < 0 || target === index) return;
    const [value] = array.splice(index, 1);
    if (offset === undefined && index < target) target--;
    array.splice(target, 0, value);
  });
}

export function listClips(document, {groupId, category, search = ""} = {}) {
  const library = getLibrary(document);
  // Older API macros can still read the migrated movement pool. Before migration,
  // an actual legacy group keeps priority; Item category filters remain literal.
  if (document.documentName === "Actor" && category === "voice.movement"
    && !library.groups.some(group => group.category === category)) category = "voice.move";
  const clips = [];
  const query = String(search).toLocaleLowerCase();
  for (const group of library.groups) {
    if (groupId && group.id !== groupId || category && group.category !== category) continue;
    for (const entry of group.entries) {
      const resolved = entry.type === "folder" ? entry.clips : [entry];
      for (const clip of resolved ?? []) {
        if (query && !`${clip.name} ${entry.label ?? ""} ${clip.path}`.toLocaleLowerCase().includes(query)) continue;
        clips.push({documentUuid: document.uuid, groupId: group.id, groupName: group.name, category: group.category,
          entryId: entry.id, folderId: entry.type === "folder" ? entry.id : null,
          name: clip.name, path: clip.path, label: clip.label ?? entry.label ?? ""});
      }
    }
  }
  return clips;
}

export function getRandomClip(document, options) {
  const clips = listClips(document, options);
  return clips.length ? clips[Math.floor(Math.random() * clips.length)] : null;
}
