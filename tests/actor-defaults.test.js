import test, {beforeEach} from "node:test";
import assert from "node:assert/strict";
import { ACTOR_DEFAULT_GROUPS, addActorDefaults, seedNewActor, ensureActorDefaults,
  initializeActorDefaults, registerActorDefaults } from "../scripts/actor-defaults.js";
import { getLibrary, addFile } from "../scripts/library-service.js";

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

test("new Actors receive exactly six keyed groups before persistence, including an unsaved Actor", () => {
  const actor = new Actor(undefined); actor.uuid = undefined;
  seedNewActor(actor);
  const groups = actor.getFlag(namespace, "library").groups;
  assert.deepEqual(groups.map(group => group.name), ["attack", "take cover", "enter building", "movement", "wounded", "retreat"]);
  assert.deepEqual(groups.map(group => group.category), ACTOR_DEFAULT_GROUPS.map(group => group.category));
  assert.equal(new Set(groups.map(group => group.id)).size, 6);
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
  assert.equal(library.groups.length, 7);
  assert.deepEqual(library.groups[0], {...attack, category: "voice.attack"});
  assert.deepEqual(library.groups.slice(1, 4), [movement, retreat, custom]);
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
  assert.equal(getLibrary(actor).groups.length, 7);
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
  assert.deepEqual(duplicate.getFlag(namespace, "library").groups.slice(0, 5), library.groups);
  assert.equal(duplicate.getFlag(namespace, "library").groups[5].name, "attack");
  const future = new Actor("Actor.future", {schemaVersion: 2, groups: []});
  assert.throws(() => seedNewActor(future), /UnsupportedSchema/);
  assert.equal(future.sourceUpdates, 0);
});

test("one group cannot satisfy two defaults when its name and category disagree", () => {
  const library = {schemaVersion: 1, groups: [{id: "renamed", name: "movement", category: "voice.attack", entries: []}]};
  assert.equal(addActorDefaults(library), true);
  assert.equal(library.groups.length, 6);
  assert.equal(library.groups.filter(group => group.category === "voice.movement").length, 1);
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
  assert.deepEqual([...hooks.keys()], ["preCreateActor"]);
  const actor = new Actor("Actor.new");
  assert.equal(hooks.get("preCreateActor")(actor), undefined);
  assert.equal(actor.sourceUpdates, 1); assert.equal(actor.writes, 0);
});
