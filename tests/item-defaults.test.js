import test, {beforeEach} from "node:test";
import assert from "node:assert/strict";
import { ITEM_DEFAULT_GROUPS, addItemDefaults, seedNewItem, ensureItemDefaults,
  initializeItemDefaults, initializeActorItems, registerItemDefaults } from "../scripts/item-defaults.js";
import { ensureActorDefaults } from "../scripts/actor-defaults.js";
import { getLibrary, addFile, listClips, getRandomClip } from "../scripts/library-service.js";

const namespace = "dominion-sound-archive";
class Item {
  constructor(uuid = "Item.a", library) {
    this.documentName = "Item"; this.uuid = uuid; this.name = uuid;
    this.isOwner = true; this.readable = true; this.updateable = true;
    this.flags = {}; this.writes = 0; this.sourceUpdates = 0;
    if (library) this.flags[namespace] = {library: structuredClone(library)};
  }
  getFlag(scope, key) { return this.flags[scope]?.[key]; }
  testUserPermission() { return this.readable; }
  canUserModify() { return this.updateable; }
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
  globalThis.game = {user: {id: "gm", isGM: true}, users: {activeGM: {id: "gm"}}, items: [], actors: [], scenes: [],
    packs: new Map(), i18n: {localize: key => key, format: (key, values) => `${key} ${values.count}`}};
  globalThis.ui = {notifications: {warn() {}, error() {}}};
});

test("new world and embedded Items receive exactly nine named, keyed groups before persistence", () => {
  const world = new Item(); world.uuid = undefined;
  const embedded = new Item("Actor.a.Item.b"); embedded.parent = {documentName: "Actor"};
  for (const item of [world, embedded]) {
    seedNewItem(item);
    const library = item.getFlag(namespace, "library");
    assert.equal(library.schemaVersion, 1);
    assert.deepEqual(library.groups.map(group => group.name), ["Bolt-Action", "Semi-Auto", "LMG", "HMG", "Sub-Machine", "Pistol", "Cannon", "Reload", "Explosion"]);
    assert.deepEqual(library.groups.map(group => group.category), ITEM_DEFAULT_GROUPS.map(group => group.category));
    assert.equal(new Set(library.groups.map(group => group.id)).size, 9);
    assert(library.groups.every(group => group.entries.length === 0));
    const snapshot = structuredClone(library);
    seedNewItem(item);
    assert.deepEqual(item.getFlag(namespace, "library"), snapshot);
    assert.equal(item.sourceUpdates, 1); assert.equal(item.writes, 0);
  }
  assert.notEqual(world.getFlag(namespace, "library").groups[0].id, embedded.getFlag(namespace, "library").groups[0].id);
});

test("existing reload groups, mixed-case names, custom keys and legacy weapon.fire clips survive", async () => {
  const legacy = {id: "old-fire", name: "Weapon Fire", category: "weapon.fire", entries: [{id: "fire", type: "file", name: "Burst", path: "weapons/fire.ogg"}]};
  const reload = {id: "old-reload", name: "Magazine", category: "weapon.reload", entries: []};
  const hmg = {id: "old-hmg", name: "  hmg  ", category: "", entries: [{id: "folder", type: "folder", clips: [{name: "HMG", path: "hmg/a.mp3"}]}]};
  const custom = {id: "custom-cannon", name: "Cannon", category: "custom.cannon", entries: []};
  const item = new Item("Item.a", {schemaVersion: 1, note: "keep", groups: [legacy, reload, hmg, custom]});
  assert.equal(await ensureItemDefaults(item), true);
  const library = getLibrary(item);
  assert.equal(library.groups.length, 10);
  assert.deepEqual(library.groups[0], legacy); assert.deepEqual(library.groups[1], reload);
  assert.deepEqual(library.groups[2], {...hmg, category: "weapon.hmg"});
  assert.deepEqual(library.groups[3], custom); assert.equal(library.note, "keep");
  assert.equal(getRandomClip(item, {category: "weapon.fire"}).path, "weapons/fire.ogg");
  assert.equal(getRandomClip(item, {category: "weapon.hmg"}).path, "hmg/a.mp3");
  assert.equal(await ensureItemDefaults(item), false); assert.equal(item.writes, 1);
});

test("the elected GM migrates world Items and equipment on every world and unlinked scene Actor", async () => {
  const world = new Item("Item.world"), squad = new Item("Actor.squad.Item.gun"),
    tank = new Item("Scene.s.Token.t.Actor.tank.Item.gun"), other = new Item("Scene.other.Token.t.Actor.a.Item.gun"),
    ignoredLinked = new Item("Actor.linked.Item.gun");
  game.items = [world]; game.actors = [{items: [squad]}];
  game.scenes = [{tokens: [{actorLink: false, actor: {items: [tank, squad]}}, {actorLink: true, actor: {items: [ignoredLinked]}}]},
    {tokens: [{actorLink: false, actor: {items: [other]}}]}];
  game.users.activeGM.id = "other-gm";
  assert.deepEqual(await initializeItemDefaults(), {updated: 0, failed: 0});
  game.users.activeGM.id = "gm"; game.user.isGM = false;
  assert.deepEqual(await initializeItemDefaults(), {updated: 0, failed: 0});
  game.user.isGM = true;
  assert.deepEqual(await initializeItemDefaults(), {updated: 4, failed: 0});
  for (const item of [world, squad, tank, other]) { assert.equal(item.writes, 1); assert.equal(getLibrary(item).groups.length, 9); }
  assert.equal(ignoredLinked.writes, 0);
  assert.deepEqual(await initializeItemDefaults(), {updated: 0, failed: 0});
});

test("new/imported Actor inventories and newly created unlinked tokens initialize on one client", async () => {
  const hooks = new Map(); globalThis.Hooks = {on: (name, callback) => hooks.set(name, callback)};
  registerItemDefaults();
  assert.deepEqual([...hooks.keys()], ["preCreateItem", "createActor", "createToken"]);
  const created = new Item("Item.new");
  assert.equal(hooks.get("preCreateItem")(created), undefined); assert.equal(created.sourceUpdates, 1);
  const initial = new Item("Actor.imported.Item.gun");
  game.users.activeGM.id = "different-gm";
  assert.equal(hooks.get("createActor")({items: [initial]}, {}, "gm"), undefined); assert.equal(initial.writes, 0);
  game.users.activeGM = null; game.user.isGM = false;
  await hooks.get("createActor")({items: [initial]}, {}, "gm");
  assert.equal(initial.writes, 1);
  const tokenItem = new Item("Scene.s.Token.new.Actor.a.Item.gun");
  await hooks.get("createToken")({actorLink: false, actor: {items: [tokenItem]}}, {}, "gm");
  assert.equal(tokenItem.writes, 1);
  const linked = new Item("Actor.a.Item.linked");
  assert.equal(hooks.get("createToken")({actorLink: true, actor: {items: [linked]}}, {}, "gm"), undefined);
  assert.equal(linked.writes, 0);
});

test("concurrent Item initialization shares one write and preserves queued manual edits", async () => {
  const item = new Item("Item.concurrent", {schemaVersion: 1, groups: [{id: "custom", name: "Custom", category: "", entries: []}]});
  const first = ensureItemDefaults(item), second = ensureItemDefaults(item);
  assert.equal(first, second);
  await Promise.all([first, second, addFile(item, "custom", {path: "custom/a.wav"})]);
  assert.equal(item.writes, 2); assert.equal(getLibrary(item).groups.length, 10);
  assert.equal(listClips(item)[0].path, "custom/a.wav");
});

test("Observers, non-updateable Items and locked compendiums keep their original flags", async () => {
  const observer = new Item("Item.observer"); observer.isOwner = false;
  const readonly = new Item("Item.readonly"); readonly.updateable = false;
  const locked = new Item("Item.locked"); locked.pack = "locked.items"; game.packs.set(locked.pack, {locked: true});
  for (const item of [observer, readonly, locked]) {
    assert.equal(await ensureItemDefaults(item), false);
    assert.equal(item.writes, 0); assert.equal(item.getFlag(namespace, "library"), undefined);
  }
});

test("Actor and Item defaults remain separate after sharing the initialization service", async () => {
  const actor = new Item("Actor.a"); actor.documentName = "Actor";
  assert.equal(await ensureItemDefaults(actor), false);
  assert.equal(await ensureActorDefaults(actor), true);
  assert.equal(getLibrary(actor).groups.length, 7);
  assert(getLibrary(actor).groups.every(group => group.category.startsWith("voice.")));
  const item = new Item("Item.a");
  assert.equal(await ensureActorDefaults(item), false);
  assert.equal(await ensureItemDefaults(item), true);
  assert.equal(getLibrary(item).groups.length, 9);
  assert(getLibrary(item).groups.every(group => group.category.startsWith("weapon.")));
});

test("duplicates retain stable IDs and clips while filling missing groups; future schemas are untouched", async () => {
  const original = new Item("Item.original"); seedNewItem(original);
  const library = structuredClone(original.getFlag(namespace, "library")); library.groups.shift();
  library.groups[0].entries.push({id: "semi", type: "file", name: "Shot", path: "semi/a.ogg"});
  const duplicate = new Item("Item.copy", library); seedNewItem(duplicate);
  assert.deepEqual(getLibrary(duplicate).groups.slice(0, 8), library.groups);
  assert.equal(getLibrary(duplicate).groups[8].name, "Bolt-Action");
  const future = new Item("Item.future", {schemaVersion: 99, groups: []});
  assert.throws(() => seedNewItem(future), /UnsupportedSchema/);
  await assert.rejects(ensureItemDefaults(future), /UnsupportedSchema/);
  assert.equal(future.sourceUpdates, 0); assert.equal(future.writes, 0);
});

test("a conflicting group name/key cannot satisfy two default weapon categories", () => {
  const library = {schemaVersion: 1, groups: [{id: "renamed", name: "Cannon", category: "weapon.hmg", entries: []}]};
  assert.equal(addItemDefaults(library), true); assert.equal(library.groups.length, 9);
  assert.equal(library.groups.filter(group => group.category === "weapon.cannon").length, 1);
  assert.equal(addItemDefaults(library), false);
});

test("one failed Item write preserves its archive, does not block others, and can be retried", async () => {
  const broken = new Item("Item.broken", {schemaVersion: 1, groups: [{id: "old", name: "Old", category: "weapon.fire", entries: []}]});
  const before = getLibrary(broken); broken.failWrite = true;
  const healthy = new Item("Item.healthy"); const warnings = [];
  ui.notifications.warn = message => warnings.push(message);
  const log = console.error; console.error = () => {};
  try { assert.deepEqual(await initializeActorItems({items: [broken, healthy]}), {updated: 1, failed: 1}); }
  finally { console.error = log; }
  assert.deepEqual(getLibrary(broken), before); assert.equal(warnings.length, 1);
  broken.failWrite = false; assert.equal(await ensureItemDefaults(broken), true);
});

test("mixed squad and tank categories return their own playable pools through the existing API", async () => {
  const squad = new Item("Actor.squad.Item.equipment"), tank = new Item("Actor.tank.Item.armament");
  await Promise.all([ensureItemDefaults(squad), ensureItemDefaults(tank)]);
  for (const [item, category, path] of [[squad, "weapon.bolt-action", "bolt/a.ogg"], [squad, "weapon.hmg", "hmg/a.ogg"],
    [tank, "weapon.hmg", "tank/hmg.mp3"], [tank, "weapon.cannon", "tank/cannon.wav"]]) {
    const group = getLibrary(item).groups.find(group => group.category === category);
    await addFile(item, group.id, {path});
  }
  const squadShots = [...Array.from({length: 4}, () => getRandomClip(squad, {category: "weapon.bolt-action"})),
    ...Array.from({length: 2}, () => getRandomClip(squad, {category: "weapon.hmg"}))];
  assert.deepEqual(squadShots.map(clip => clip.path), ["bolt/a.ogg", "bolt/a.ogg", "bolt/a.ogg", "bolt/a.ogg", "hmg/a.ogg", "hmg/a.ogg"]);
  assert.equal(getRandomClip(tank, {category: "weapon.hmg"}).path, "tank/hmg.mp3");
  assert.equal(getRandomClip(tank, {category: "weapon.cannon"}).path, "tank/cannon.wav");
  assert.equal(getRandomClip(squad, {category: "weapon.cannon"}), null);
  assert.equal(getRandomClip(tank, {category: "weapon.bolt-action"}), null);
});
