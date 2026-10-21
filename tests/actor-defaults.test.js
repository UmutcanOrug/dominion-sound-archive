import test, {beforeEach} from "node:test";
import assert from "node:assert/strict";
import { ACTOR_DEFAULT_GROUPS, addActorDefaults, seedNewActor, ensureActorDefaults,
  initializeActorDefaults, registerActorDefaults } from "../scripts/actor-defaults.js";
import { getLibrary, addFile, listClips, getRandomClip } from "../scripts/library-service.js";

const namespace = "dominion-sound-archive";
class Actor {
  constructor(uuid = "Actor.a", library) {
    this.documentName = "Actor"; this.uuid = uuid; this.name = uuid;
    this.isOwner = true; this.readable = true; this.flags = {};
    this.writes = 0; this.sourceUpdates = 0;
    if (library) this.flags[namespace] = {library: structuredClone(library)};
  }
  getFlag(scope, key) { return this.flags[scope]?.[key]; }
  testUserPermission() { return this.readable; }
  canUserModify() { return this.isOwner; }
  updateSource(changes) {
    this.flags[namespace] = {library: structuredClone(changes[`flags.${namespace}.library`])};
    this.sourceUpdates++;
  }
  async setFlag(scope, key, value) {
    await new Promise(resolve => setTimeout(resolve, 1));
    if (this.failWrite) throw new Error("write failed");
    this.flags[scope] ??= {}; this.flags[scope][key] = structuredClone(value); this.writes++;
  }
}

beforeEach(() => {
  globalThis.game = {user: {id: "gm", isGM: true}, users: {activeGM: {id: "gm"}}, actors: [], scenes: [],
    packs: new Map(), i18n: {localize: key => key, format: (key, values) => `${key} ${values.count}`}};
  globalThis.ui = {notifications: {warn() {}, error() {}}};
});

test("new Actors receive exactly seven keyed groups before persistence, including an unsaved Actor", () => {
  const actor = new Actor(undefined); actor.uuid = undefined;
  seedNewActor(actor);
  const groups = actor.getFlag(namespace, "library").groups;
  assert.deepEqual(groups.map(group => group.name), ["attack", "take cover", "enter building", "move", "run", "wounded", "retreat"]);
  assert.deepEqual(groups.map(group => group.category), ACTOR_DEFAULT_GROUPS.map(group => group.category));
  assert.equal(new Set(groups.map(group => group.id)).size, 7);
  assert(groups.every(group => group.entries.length === 0));
  assert.equal(actor.sourceUpdates, 1); assert.equal(actor.writes, 0);
  const snapshot = structuredClone(groups);
  seedNewActor(actor);
  assert.equal(actor.sourceUpdates, 1);
  assert.deepEqual(actor.getFlag(namespace, "library").groups, snapshot);
  const independent = new Actor("Actor.b"); seedNewActor(independent);
  assert.notEqual(independent.getFlag(namespace, "library").groups[0].id, groups[0].id);
});

test("existing groups, stable IDs, custom keys, cached folders and clip references survive backfill", async () => {
  const attack = {id: "attack-existing", name: "  ATTACK  ", category: "", entries: [
    {id: "folder", type: "folder", path: "voice/attack", source: "forgevtt",
      clips: [{path: "https://assets.forge-vtt.com/u/attack.ogg", name: "attack"}]}]};
  const movement = {id: "movement-existing", name: "Marching Voices", category: "voice.movement", entries: []};
  const retreat = {id: "retreat-existing", name: "retreat", category: "custom.retreat", entries: []};
  const custom = {id: "custom", name: "Battle cry", category: "voice.battle-cry", entries: []};
  const initial = {schemaVersion: 1, metadata: {keep: true}, groups: [attack, movement, retreat, custom]};
  const actor = new Actor("Actor.a", initial);
  assert.equal(await ensureActorDefaults(actor), true);
  const library = getLibrary(actor);
  assert.equal(library.groups.length, 8);
  assert.deepEqual(library.groups[0], {...attack, category: "voice.attack"});
  assert.deepEqual(library.groups.slice(1, 4), [{...movement, category: "voice.move"}, retreat, custom]);
  assert.deepEqual(library.metadata, {keep: true});
  assert.equal(await ensureActorDefaults(actor), false);
  assert.equal(actor.writes, 1);
  assert.deepEqual(getLibrary(actor), library);
});

test("ready backfills all world and unlinked scene Actors once, using only the elected GM", async () => {
  const world = new Actor("Actor.world"), synthetic = new Actor("Scene.s.Token.t.Actor.world"),
    otherScene = new Actor("Scene.other.Token.t.Actor.world"), linked = new Actor("Actor.linked");
  game.actors = [world];
  game.scenes = [{tokens: [{actorLink: true, actor: linked}, {actorLink: false, actor: synthetic}, {actorLink: false, actor: synthetic}]},
    {tokens: [{actorLink: false, actor: otherScene}]}];
  game.users.activeGM.id = "other-gm";
  assert.deepEqual(await initializeActorDefaults(), {updated: 0, failed: 0});
  game.user.isGM = false; game.users.activeGM.id = "gm";
  assert.deepEqual(await initializeActorDefaults(), {updated: 0, failed: 0});
  game.user.isGM = true;
  assert.deepEqual(await initializeActorDefaults(), {updated: 3, failed: 0});
  assert.equal(world.writes, 1); assert.equal(synthetic.writes, 1); assert.equal(otherScene.writes, 1); assert.equal(linked.writes, 0);
  assert.deepEqual(await initializeActorDefaults(), {updated: 0, failed: 0});
});

test("concurrent initialization shares one write and preserves queued manual archive edits", async () => {
  const actor = new Actor("Actor.concurrent", {schemaVersion: 1, groups: [{id: "custom", name: "Custom", category: "", entries: []}]});
  const first = ensureActorDefaults(actor), second = ensureActorDefaults(actor);
  assert.equal(first, second);
  await Promise.all([first, second, addFile(actor, "custom", {path: "voice/custom.ogg"})]);
  assert.equal(actor.writes, 2);
  assert.equal(getLibrary(actor).groups.length, 8);
  assert.equal(getLibrary(actor).groups[0].entries[0].path, "voice/custom.ogg");
});

test("Items, Observers and locked compendiums are never changed by Actor defaults", async () => {
  const item = new Actor("Item.i"); item.documentName = "Item";
  const observer = new Actor("Actor.observer"); observer.isOwner = false;
  const locked = new Actor("Actor.locked"); locked.pack = "locked.actors"; game.packs.set(locked.pack, {locked: true});
  for (const document of [item, observer, locked]) {
    assert.equal(await ensureActorDefaults(document), false);
    assert.equal(document.writes, 0); assert.equal(document.getFlag(namespace, "library"), undefined);
  }
});

test("duplicates keep their archives and fill missing defaults; a future schema is never overwritten", () => {
  const original = new Actor("Actor.original"); seedNewActor(original);
  const library = structuredClone(original.getFlag(namespace, "library"));
  library.groups.shift();
  const duplicate = new Actor("Actor.duplicate", library);
  seedNewActor(duplicate);
  assert.deepEqual(duplicate.getFlag(namespace, "library").groups.slice(0, 6), library.groups);
  assert.equal(duplicate.getFlag(namespace, "library").groups[6].name, "attack");
  const future = new Actor("Actor.future", {schemaVersion: 2, groups: []});
  assert.throws(() => seedNewActor(future), /UnsupportedSchema/);
  assert.equal(future.sourceUpdates, 0);
});

test("a matching name never duplicates or replaces an existing custom category", () => {
  const library = {schemaVersion: 1, groups: [{id: "renamed", name: "movement", category: "voice.attack", entries: []}]};
  assert.equal(addActorDefaults(library), true);
  assert.equal(library.groups.length, 7);
  assert.equal(library.groups.filter(group => group.category === "voice.move").length, 1);
  assert.equal(addActorDefaults(library), false);
});

test("failed migrations preserve old flags, continue to other Actors and can be retried", async () => {
  const broken = new Actor("Actor.broken"); broken.failWrite = true;
  const healthy = new Actor("Actor.healthy"); game.actors = [broken, healthy];
  const warnings = []; ui.notifications.warn = message => warnings.push(message);
  const log = console.error; console.error = () => {};
  try { assert.deepEqual(await initializeActorDefaults(), {updated: 1, failed: 1}); }
  finally { console.error = log; }
  assert.equal(broken.getFlag(namespace, "library"), undefined);
  assert.equal(warnings.length, 1);
  broken.failWrite = false;
  assert.equal(await ensureActorDefaults(broken), true);
});

test("the registered preCreateActor hook seeds synchronously without a second database update", () => {
  const hooks = new Map(); globalThis.Hooks = {on: (name, callback) => hooks.set(name, callback)};
  registerActorDefaults();
  assert.deepEqual([...hooks.keys()], ["preCreateActor", "createToken"]);
  const actor = new Actor("Actor.new");
  assert.equal(hooks.get("preCreateActor")(actor), undefined);
  assert.equal(actor.sourceUpdates, 1); assert.equal(actor.writes, 0);
});

test("1.0.2 movement migrates in place to move with all folder data and entry IDs preserved", async () => {
  const old = {id: "old-movement", name: "movement", category: "voice.movement", entries: [
    {id: "file", type: "file", name: "Walk", label: "quiet", path: "voice/walk.ogg"},
    {id: "folder", type: "folder", name: "March", source: "forgevtt", path: "voice/march", recursive: true,
      excluded: ["voice/march/hidden.ogg"], refreshedAt: "2026-10-15", clips: [{name: "March 1", path: "voice/march/a.mp3"}]}]};
  const actor = new Actor("Actor.migrate", {schemaVersion: 1, metadata: {keep: true}, groups: [old]});
  await ensureActorDefaults(actor);
  const migrated = getLibrary(actor);
  assert.deepEqual(migrated.groups[0], {...old, name: "move", category: "voice.move"});
  assert.deepEqual(migrated.metadata, {keep: true});
  assert.equal(migrated.groups.length, 7);
  assert.deepEqual(migrated.groups.find(group => group.category === "voice.run").entries, []);
  assert(!migrated.groups.some(group => group.category === "voice.movement"));
  assert.deepEqual(listClips(actor, {category: "voice.move"}).map(clip => clip.path), ["voice/walk.ogg", "voice/march/a.mp3"]);
  const snapshot = getLibrary(actor);
  assert.equal(await ensureActorDefaults(actor), false);
  assert.deepEqual(getLibrary(actor), snapshot); assert.equal(actor.writes, 1);
});

test("an existing move pool absorbs legacy pools without losing conflicting entry IDs or folder references", async () => {
  const common = {id: "shared", type: "file", name: "Walk", path: "voice/walk.ogg"};
  const target = {id: "existing-move", name: "Move voices", category: "voice.move", entries: [common]};
  const legacy = {id: "old", name: "movement", category: "voice.movement", entries: [structuredClone(common),
    {...common, path: "voice/other.ogg"}, {id: "folder", type: "folder", path: "voice/folder", source: "forgevtt",
      excluded: ["hidden.ogg"], clips: [{name: "Folder clip", path: "voice/folder/a.wav"}]}]};
  const other = {id: "old-other", name: "Old marching", category: "voice.movement", entries: [
    {id: "extra", type: "file", name: "Extra", path: "voice/extra.mp3"}]};
  const actor = new Actor("Actor.merge", {schemaVersion: 1, groups: [target, legacy, other]});
  await ensureActorDefaults(actor);
  const library = getLibrary(actor), move = library.groups.find(group => group.category === "voice.move");
  assert.equal(move.id, "existing-move"); assert.equal(move.name, "Move voices");
  assert.equal(move.entries.length, 4); assert.equal(new Set(move.entries.map(entry => entry.id)).size, 4);
  assert.deepEqual(move.entries.find(entry => entry.id === "folder").excluded, ["hidden.ogg"]);
  assert.deepEqual(listClips(actor, {category: "voice.move"}).map(clip => clip.path).sort(),
    ["voice/walk.ogg", "voice/other.ogg", "voice/folder/a.wav", "voice/extra.mp3"].sort());
  assert.equal(library.groups.length, 7); assert(!library.groups.some(group => group.category === "voice.movement"));
  assert.equal(await ensureActorDefaults(actor), false);
});

test("unkeyed Movement names migrate while explicitly customized category keys stay intact", async () => {
  const unkeyed = {id: "unkeyed", name: "  MOVEMENT  ", category: "", entries: [{id: "walk", type: "file", name: "Walk", path: "walk.ogg"}]};
  const custom = {id: "custom", name: "movement", category: "custom.movement", entries: [{id: "custom-file", type: "file", name: "Custom", path: "custom.ogg"}]};
  const actor = new Actor("Actor.names", {schemaVersion: 1, groups: [unkeyed, custom]});
  await ensureActorDefaults(actor);
  assert.deepEqual(getLibrary(actor).groups[0], {...unkeyed, name: "move", category: "voice.move"});
  assert.deepEqual(getLibrary(actor).groups[1], custom);
  assert.equal(getRandomClip(actor, {category: "voice.move"}).path, "walk.ogg");
  assert.equal(getRandomClip(actor, {category: "custom.movement"}).path, "custom.ogg");
});

test("legacy API movement filters read move after migration and never borrow the run pool", async () => {
  const actor = new Actor("Actor.alias", {schemaVersion: 1, groups: [
    {id: "old", name: "movement", category: "voice.movement", entries: [{id: "walk", type: "file", name: "Walk", path: "walk.ogg"}]},
    {id: "run", name: "run", category: "voice.run", entries: [{id: "running", type: "file", name: "Run", path: "run.ogg"}]}]});
  assert.equal(getRandomClip(actor, {category: "voice.movement"}).path, "walk.ogg");
  await ensureActorDefaults(actor);
  const alias = getRandomClip(actor, {category: "voice.movement"});
  assert.equal(alias.path, "walk.ogg"); assert.equal(alias.category, "voice.move");
  assert.equal(getRandomClip(actor, {category: "voice.run"}).path, "run.ogg");
  const item = new Actor("Item.literal", getLibrary(actor)); item.documentName = "Item";
  assert.equal(getRandomClip(item, {category: "voice.movement"}), null);
  const raw = new Actor("Actor.legacy-priority", {schemaVersion: 1, groups: [
    {id: "old", name: "movement", category: "voice.movement", entries: [{id: "old-file", type: "file", name: "Old", path: "old.ogg"}]},
    {id: "new", name: "move", category: "voice.move", entries: [{id: "new-file", type: "file", name: "New", path: "new.ogg"}]}]});
  assert.equal(getRandomClip(raw, {category: "voice.movement"}).path, "old.ogg");
});

test("GM startup migrates world and unlinked token movement pools once", async () => {
  const legacy = {schemaVersion: 1, groups: [{id: "old", name: "movement", category: "voice.movement", entries: [
    {id: "sound", type: "file", name: "March", path: "march.ogg"}]}]};
  const world = new Actor("Actor.world-old", legacy), token = new Actor("Scene.s.Token.t.Actor.a", legacy);
  game.actors = [world]; game.scenes = [{tokens: [{actorLink: false, actor: token}]}];
  assert.deepEqual(await initializeActorDefaults(), {updated: 2, failed: 0});
  for (const actor of [world, token]) {
    assert.equal(getLibrary(actor).groups.length, 7);
    assert.equal(getRandomClip(actor, {category: "voice.move"}).path, "march.ogg");
    assert.equal(getRandomClip(actor, {category: "voice.run"}), null);
  }
  assert.deepEqual(await initializeActorDefaults(), {updated: 0, failed: 0});
  assert.equal(world.writes, 1); assert.equal(token.writes, 1);
});

test("a failed movement migration leaves the complete original archive available for retry", async () => {
  const actor = new Actor("Actor.retry-movement", {schemaVersion: 1, groups: [
    {id: "old", name: "movement", category: "voice.movement", entries: [{id: "sound", type: "file", name: "Walk", path: "walk.ogg"}]}]});
  const before = getLibrary(actor); actor.failWrite = true;
  await assert.rejects(ensureActorDefaults(actor), /write failed/);
  assert.deepEqual(getLibrary(actor), before);
  actor.failWrite = false; await ensureActorDefaults(actor);
  assert.equal(getRandomClip(actor, {category: "voice.move"}).path, "walk.ogg");
  assert.equal(getLibrary(actor).groups.length, 7);
});

test("permission and schema guards prevent any legacy archive from being renamed without authorization", async () => {
  const legacy = {schemaVersion: 1, groups: [{id: "old", name: "movement", category: "voice.movement", entries: []}]};
  const observer = new Actor("Actor.observer-old", legacy); observer.isOwner = false;
  const locked = new Actor("Actor.locked-old", legacy); locked.pack = "locked.old"; game.packs.set(locked.pack, {locked: true});
  for (const actor of [observer, locked]) {
    assert.equal(await ensureActorDefaults(actor), false); assert.deepEqual(getLibrary(actor), legacy); assert.equal(actor.writes, 0);
  }
  const future = {...structuredClone(legacy), schemaVersion: 99}, snapshot = structuredClone(future);
  assert.throws(() => addActorDefaults(future), /UnsupportedSchema/);
  assert.deepEqual(future, snapshot);
});

test("legacy Actor imports and duplicates migrate synchronously while keeping their source references", () => {
  const legacy = {schemaVersion: 1, groups: [{id: "old", name: "movement", category: "voice.movement", entries: [
    {id: "clip", type: "file", name: "Walk", path: "walk.ogg"}]}]};
  const imported = new Actor("Actor.imported-old", legacy); seedNewActor(imported);
  const library = getLibrary(imported);
  assert.equal(library.groups.length, 7); assert.equal(library.groups[0].id, "old");
  assert.equal(library.groups[0].category, "voice.move"); assert.deepEqual(library.groups[0].entries, legacy.groups[0].entries);
  const duplicate = new Actor("Actor.copy-new", library); seedNewActor(duplicate);
  assert.deepEqual(getLibrary(duplicate), library); assert.equal(duplicate.sourceUpdates, 0);
});
