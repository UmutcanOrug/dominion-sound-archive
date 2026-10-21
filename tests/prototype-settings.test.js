import test, {beforeEach} from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/utils.js";
import { builtinPrototype, getPrototype, validatePrototype } from "../scripts/prototype-data.js";
import { savePrototype, synchronizePrototypes } from "../scripts/prototype-sync.js";
import { seedNewActor, ensureActorDefaults, registerActorDefaults } from "../scripts/actor-defaults.js";
import { seedNewItem, ensureItemDefaults, registerItemDefaults } from "../scripts/item-defaults.js";
import { getLibrary, addFile, listClips } from "../scripts/library-service.js";

// Only the Application shell is mocked. The menus, draft handlers, settings
// validation, document service and queued bulk synchronization are real code.
class Application {
  constructor() { this.closed = false; this.renders = 0; }
  async render() { this.renders++; return this; }
  _onRender() {}
  async close() { this.closed = true; return this; }
}
globalThis.foundry = {applications: {api: {ApplicationV2: Application, HandlebarsApplicationMixin: Base => Base}}};
const { registerPrototypeSettings, PrototypeVoiceSettings, PrototypeWeaponSettings } = await import("../scripts/prototype-settings.js");

class Document {
  constructor(type, uuid, groups = []) {
    Object.assign(this, {documentName: type, uuid, name: uuid, isOwner: true, readable: true, updateable: true,
      items: [], writes: 0, sourceUpdates: 0, data: {schemaVersion: 1, metadata: {keep: true}, groups: structuredClone(groups)}});
  }
  getFlag() { return this.data; }
  testUserPermission() { return this.readable; }
  canUserModify() { return this.updateable; }
  updateSource(changes) { this.data = structuredClone(changes[`flags.${MODULE_ID}.library`]); this.sourceUpdates++; }
  async setFlag(_scope, _key, value) {
    await Promise.resolve();
    if (this.fail) throw new Error("write failed");
    this.data = structuredClone(value); this.writes++;
  }
}

let registered, menus, values, notifications;
beforeEach(() => {
  registered = new Map(); menus = new Map(); values = new Map(); notifications = [];
  globalThis.game = {ready: true, user: {id: "gm", isGM: true}, users: {activeGM: {id: "gm"}},
    actors: [], items: [], scenes: [], packs: new Map(), i18n: {localize: key => key, format: (key, data) => `${key}:${JSON.stringify(data)}`},
    settings: {
      register: (scope, key, config) => { assert.equal(scope, MODULE_ID); registered.set(key, config); },
      registerMenu: (scope, key, config) => { assert.equal(scope, MODULE_ID); menus.set(key, config); },
      get: (_scope, key) => structuredClone(values.get(key) ?? registered.get(key)?.default),
      set: async (_scope, key, value) => {
        if (game.settings.fail) throw new Error("setting failed");
        values.set(key, structuredClone(value));
        // Foundry broadcasts onChange independently of the Save handler.
        registered.get(key).onChange();
        return structuredClone(value);
      }
    }};
  globalThis.ui = {notifications: Object.fromEntries(["info", "warn", "error"].map(level => [level, message => notifications.push({level, message})]))};
  registerPrototypeSettings();
});

const group = (id, name, category) => ({id, name, category, entries: [
  {id: `${id}-file`, type: "file", name: "My voice", path: "voice/a.ogg", label: "private"},
  {id: `${id}-folder`, type: "folder", name: "My folder", source: "forgevtt", path: "voice/a", recursive: true,
    bucket: "bucket", refreshedAt: "2026-10-15", excluded: ["voice/a/hidden.ogg"], clips: [{name: "One", path: "voice/a/one.ogg"}]}
]});
const draft = (kind, name, key) => { const value = getPrototype(kind); value.groups.push({name, category: key}); return value; };

test("Configure Settings registers two world settings and GM-only ApplicationV2 menus with the current defaults", () => {
  assert.equal(registered.size, 2); assert.equal(menus.size, 2);
  for (const [kind, key, Type, count] of [["voice", "prototypeVoice", PrototypeVoiceSettings, 7], ["weapon", "prototypeWeapon", PrototypeWeaponSettings, 9]]) {
    const config = registered.get(key), menu = menus.get(`${key}Menu`);
    assert.equal(config.scope, "world"); assert.equal(config.type, Object); assert.equal(config.config, false);
    assert.equal(menu.restricted, true); assert.equal(menu.type, Type);
    assert.deepEqual(getPrototype(kind), builtinPrototype(kind)); assert.equal(getPrototype(kind).groups.length, count);
    getPrototype(kind).groups.pop(); assert.equal(getPrototype(kind).groups.length, count);
  }
});

test("saving voice additions reaches world Actors and unlinked token Actors while retaining every original group and folder byte-for-byte", async () => {
  const originals = [group("local", "Battle cry", "voice.battle-cry"), group("attack", "My Attack", "voice.attack")];
  const world = new Document("Actor", "Actor.world", originals), token = new Document("Actor", "Scene.s.Token.t.Actor.a", originals);
  const ignored = new Document("Actor", "Actor.ignored");
  game.actors = [world]; game.scenes = [{tokens: [{actorLink: false, actor: token}, {actorLink: false, actor: token}, {actorLink: true, actor: ignored}]}];
  const before = getPrototype("voice"); await savePrototype("voice", draft("voice", "Dig in", "voice.dig-in"), before);
  for (const doc of [world, token]) {
    assert.deepEqual(getLibrary(doc).groups.slice(0, 2), originals);
    assert.equal(getLibrary(doc).groups.filter(g => g.category === "voice.dig-in").length, 1);
    assert.deepEqual(getLibrary(doc).metadata, {keep: true}); assert.equal(doc.writes, 1);
  }
  assert.equal(ignored.writes, 0); assert.equal(world.data.groups.some(g => g.category.startsWith("weapon.")), false);
});

test("weapon prototypes reach world, embedded and synthetic inventory Items; voice and weapon pools stay separate", async () => {
  const old = group("old", "Custom Cannon", "weapon.cannon");
  const world = new Document("Item", "Item.world", [old]), embedded = new Document("Item", "Actor.a.Item.gun", [old]),
    synthetic = new Document("Item", "Scene.s.Token.t.Actor.a.Item.gun", [old]);
  const actor = new Document("Actor", "Actor.a"); actor.items = [embedded];
  const tank = new Document("Actor", "Scene.s.Token.t.Actor.a"); tank.items = [synthetic];
  game.items = [world]; game.actors = [actor]; game.scenes = [{tokens: [{actorLink: false, actor: tank}]}];
  await savePrototype("weapon", draft("weapon", "Mortar", "weapon.mortar"), getPrototype("weapon"));
  for (const item of [world, embedded, synthetic]) {
    assert.deepEqual(item.data.groups[0], old);
    assert.equal(item.data.groups.filter(g => g.category === "weapon.mortar").length, 1);
    assert(item.data.groups.every(g => g.category.startsWith("weapon.")));
  }
  assert(actor.data.groups.every(g => g.category.startsWith("voice.")));
});

test("existing category or normalized name reuses the original group without removing folders, labels, exclusions or custom keys", async () => {
  const categoryMatch = group("key", "My personal callout", "voice.charge"),
    nameMatch = group("name", "  CHARGE   NOW  ", "custom.charge"),
    noKey = group("unkeyed", "Charge now", "");
  const actors = [categoryMatch, nameMatch, noKey].map((g, i) => new Document("Actor", `Actor.${i}`, [g]));
  game.actors = actors;
  await savePrototype("voice", draft("voice", "Charge now", "voice.charge"), getPrototype("voice"));
  for (const [i, actor] of actors.entries()) {
    assert.equal(actor.data.groups.length, 8);
    const initial = [categoryMatch, nameMatch, noKey][i];
    assert.deepEqual(actor.data.groups[0], i === 2 ? {...initial, category: "voice.charge"} : initial);
    assert.equal(actor.data.groups.filter(g => g.category === "voice.charge" || /charge\s+now/i.test(g.name)).length, 1);
  }
  const snapshots = actors.map(a => structuredClone(a.data));
  await synchronizePrototypes();
  actors.forEach((actor, i) => { assert.equal(actor.writes, 1); assert.deepEqual(actor.data, snapshots[i]); });
});

test("same-name weapon groups keep their custom key and cached folder without duplicates", async () => {
  const old = group("mine", "  MORTAR ", "custom.mortar"); const item = new Document("Item", "Item.mine", [old]); game.items = [item];
  await savePrototype("weapon", draft("weapon", "Mortar", "weapon.mortar"), getPrototype("weapon"));
  assert.equal(item.data.groups.length, 10); assert.deepEqual(item.data.groups[0], old);
  assert.equal(item.data.groups.filter(g => g.name.trim().toLowerCase() === "mortar").length, 1);
});

test("editing or removing prototype rows never renames or deletes existing sheet groups or audio", async () => {
  const actor = new Document("Actor", "Actor.a", [group("private", "Personal", "voice.personal")]); game.actors = [actor];
  await savePrototype("voice", draft("voice", "Charge", "voice.charge"), getPrototype("voice"));
  const charge = actor.data.groups.find(g => g.category === "voice.charge"); await addFile(actor, charge.id, {path: "charge/a.ogg"});
  const before = structuredClone(actor.data);
  let original = getPrototype("voice"), edited = structuredClone(original); edited.groups.at(-1).name = "New charge name";
  await savePrototype("voice", edited, original); assert.deepEqual(actor.data, before);
  original = getPrototype("voice"); edited = structuredClone(original); edited.groups.at(-1).category = "voice.new-charge";
  await savePrototype("voice", edited, original);
  // Matching name on this sheet does not exist: it receives a distinct new key,
  // while the old group's ID, local name and audio remain untouched.
  assert.deepEqual(actor.data.groups.slice(0, before.groups.length), before.groups);
  original = getPrototype("voice"); await savePrototype("voice", {schemaVersion: 1, groups: []}, original);
  const snapshot = structuredClone(actor.data); await ensureActorDefaults(actor); assert.deepEqual(actor.data, snapshot);
  const newcomer = new Document("Actor", "Actor.new"); seedNewActor(newcomer); assert.equal(newcomer.data.groups.length, 0);
});

test("new, imported and duplicated Actors and Items read the latest saved prototype at creation", async () => {
  await savePrototype("voice", draft("voice", "Salute", "voice.salute"), getPrototype("voice"));
  await savePrototype("weapon", draft("weapon", "Mortar", "weapon.mortar"), getPrototype("weapon"));
  const hooks = new Map(); globalThis.Hooks = {on: (name, fn) => hooks.set(name, fn)}; registerActorDefaults(); registerItemDefaults();
  for (let i = 0; i < 3; i++) {
    const actor = new Document("Actor", `Actor.${i}`, i ? [group("imported", "Imported", "voice.imported")] : []);
    hooks.get("preCreateActor")(actor); assert(actor.data.groups.some(g => g.category === "voice.salute"));
    const item = new Document("Item", `Actor.${i}.Item.gun`); actor.items = [item];
    await hooks.get("createActor")(actor, {}, "gm"); assert(item.data.groups.some(g => g.category === "weapon.mortar"));
    const newItem = new Document("Item", `Item.${i}`); hooks.get("preCreateItem")(newItem);
    assert(newItem.data.groups.some(g => g.category === "weapon.mortar"));
  }
});

test("owner-opened archives add current prototypes without a GM pass; read-only and locked documents stay unchanged", async () => {
  values.set("prototypeVoice", draft("voice", "Salute", "voice.salute"));
  const own = new Document("Actor", "Actor.own"); game.user.isGM = false;
  await ensureActorDefaults(own); assert(own.data.groups.some(g => g.category === "voice.salute"));
  const locked = new Document("Actor", "Actor.locked"); locked.pack = "locked"; game.packs.set("locked", {locked: true});
  const observer = new Document("Item", "Item.observer"); observer.isOwner = false;
  const denied = new Document("Actor", "Actor.denied"); denied.updateable = false;
  for (const doc of [locked, observer, denied]) {
    const before = structuredClone(doc.data); await ensureActorDefaults(doc); await ensureItemDefaults(doc);
    assert.deepEqual(doc.data, before); assert.equal(doc.writes, 0);
  }
});

test("new unlinked token Actors use the current voice prototype on one authorized client", async () => {
  values.set("prototypeVoice", draft("voice", "Salute", "voice.salute"));
  const hooks = new Map(); globalThis.Hooks = {on: (name, fn) => hooks.set(name, fn)}; registerActorDefaults();
  const actor = new Document("Actor", "Scene.s.Token.new.Actor.a", [group("personal", "Personal", "voice.personal")]);
  const original = structuredClone(actor.data.groups[0]);
  game.users.activeGM.id = "other";
  assert.equal(hooks.get("createToken")({actorLink: false, actor}, {}, "gm"), undefined); assert.equal(actor.writes, 0);
  game.users.activeGM.id = "gm";
  await hooks.get("createToken")({actorLink: false, actor}, {}, "gm");
  assert(actor.data.groups.some(g => g.category === "voice.salute")); assert.deepEqual(actor.data.groups[0], original);
  const linked = new Document("Actor", "Actor.linked");
  assert.equal(hooks.get("createToken")({actorLink: true, actor: linked}, {}, "gm"), undefined); assert.equal(linked.writes, 0);
});

test("repeat saves, two-GM broadcasts and concurrent manual edits do not duplicate groups or lose a local file", async () => {
  const actor = new Document("Actor", "Actor.concurrent", [group("local", "Mine", "voice.local")]); game.actors = [actor];
  const initial = getPrototype("voice"), next = draft("voice", "Salute", "voice.salute");
  await Promise.all([savePrototype("voice", next, initial), addFile(actor, "local", {path: "mine/new.ogg"}), synchronizePrototypes()]);
  assert(listClips(actor).some(c => c.path === "mine/new.ogg"));
  const snapshot = structuredClone(actor.data), writes = actor.writes;
  await savePrototype("voice", next, next); await synchronizePrototypes();
  assert.deepEqual(actor.data, snapshot); assert.equal(actor.writes, writes);
  game.user.id = "second-gm";
  assert.deepEqual(await synchronizePrototypes(), {updated: 0, failed: 0, delegated: true}); assert.equal(actor.writes, writes);
});

test("invalid, duplicate, blank, wrong-prefix or reserved keys reject the entire draft before any setting or archive write", async () => {
  const actor = new Document("Actor", "Actor.a"); game.actors = [actor];
  const invalids = [
    {schemaVersion: 2, groups: []}, {schemaVersion: 1, groups: [null]},
    {schemaVersion: 1, groups: [{name: "", category: "voice.a"}]},
    {schemaVersion: 1, groups: [{name: "a".repeat(201), category: "voice.a"}]},
    {schemaVersion: 1, groups: [{name: "A", category: "weapon.a"}]},
    {schemaVersion: 1, groups: [{name: "A", category: "voice."}]},
    {schemaVersion: 1, groups: [{name: "A", category: "voice.bad key"}]},
    {schemaVersion: 1, groups: [{name: "A", category: "voice." + "x".repeat(100)}]},
    {schemaVersion: 1, groups: [{name: "A", category: "voice.movement"}]},
    {schemaVersion: 1, groups: [{name: "A", category: "voice.a"}, {name: "B", category: "voice.a"}]},
    {schemaVersion: 1, groups: [{name: " Take  Cover ", category: "voice.a"}, {name: "take cover", category: "voice.b"}]}
  ];
  for (const invalid of invalids) assert.throws(() => savePrototype("voice", invalid, getPrototype("voice")));
  assert.equal(values.size, 0); assert.equal(actor.writes, 0);
});

test("settings write failure leaves all sheet flags and the saved prototype unchanged, then retry succeeds", async () => {
  const actor = new Document("Actor", "Actor.a", [group("old", "Old", "voice.old")]); game.actors = [actor];
  const before = structuredClone(actor.data), original = getPrototype("voice"), next = draft("voice", "Salute", "voice.salute");
  game.settings.fail = true;
  await assert.rejects(savePrototype("voice", next, original), /setting failed/);
  assert.deepEqual(actor.data, before); assert.deepEqual(getPrototype("voice"), original); assert.equal(actor.writes, 0);
  game.settings.fail = false; await savePrototype("voice", next, original); assert.equal(actor.writes, 1);
});

test("one failed document and a future archive schema preserve their data and do not block other sheets; retry uses saved settings", async () => {
  const broken = new Document("Actor", "Actor.broken", [group("local", "Local", "voice.local")]); broken.fail = true;
  const future = new Document("Actor", "Actor.future"); future.data.schemaVersion = 9;
  const healthy = new Document("Actor", "Actor.healthy"); game.actors = [broken, future, healthy];
  const snapshots = [structuredClone(broken.data), structuredClone(future.data)]; const log = console.error; console.error = () => {};
  try {
    const result = await savePrototype("voice", draft("voice", "Salute", "voice.salute"), getPrototype("voice"));
    assert.equal(result.failed, 2);
  } finally { console.error = log; }
  assert.deepEqual(broken.data, snapshots[0]); assert.deepEqual(future.data, snapshots[1]); assert.equal(healthy.writes, 1);
  broken.fail = false; await ensureActorDefaults(broken); assert(broken.data.groups.some(g => g.category === "voice.salute"));
});

test("invalid stored prototypes fail before bulk writes and do not silently reset to built-in defaults", async () => {
  const actor = new Document("Actor", "Actor.a"); game.actors = [actor]; values.set("prototypeWeapon", {schemaVersion: 99, groups: []});
  await assert.rejects(synchronizePrototypes(), /UnsupportedPrototype/); assert.equal(actor.writes, 0);
  values.delete("prototypeWeapon"); await synchronizePrototypes(); assert.equal(actor.writes, 1);
});

test("stale editor saves and non-GM writes reject without overwriting another GM's settings", async () => {
  const stale = getPrototype("voice"); await savePrototype("voice", draft("voice", "Salute", "voice.salute"), stale);
  const current = getPrototype("voice"); await assert.rejects(savePrototype("voice", stale, stale), /PrototypeConflict/);
  assert.deepEqual(getPrototype("voice"), current);
  game.user.isGM = false; await assert.rejects(savePrototype("voice", current, current), /PrototypeGMOnly/);
  assert.deepEqual(getPrototype("voice"), current);
});

test("more than 500 prototype rows persist and propagate without a fixed group limit", async () => {
  const groups = Array.from({length: 600}, (_, i) => ({name: `Command ${i}`, category: `voice.command-${i}`}));
  const actor = new Document("Actor", "Actor.large", [group("private", "Private", "voice.private")]); game.actors = [actor];
  await savePrototype("voice", {schemaVersion: 1, groups}, getPrototype("voice"));
  assert.equal(getPrototype("voice").groups.length, 600); assert.equal(actor.data.groups.length, 601);
  const snapshot = structuredClone(actor.data); await synchronizePrototypes(); assert.deepEqual(actor.data, snapshot);
});

test("repeated prototype synchronization preserves rich archives over many template additions and removals", async () => {
  const actors = Array.from({length: 24}, (_, i) => new Document("Actor", `Actor.fuzz-${i}`, [group(`local-${i}`, `Mine ${i}`, `voice.mine-${i}`)]));
  game.actors = actors; const originals = actors.map(a => structuredClone(a.data.groups[0]));
  for (let n = 0; n < 8; n++) {
    const current = getPrototype("voice"), next = draft("voice", `Action ${n}`, `voice.action-${n}`);
    if (n % 2) next.groups.shift();
    await savePrototype("voice", next, current);
    for (const [i, actor] of actors.entries()) {
      assert.deepEqual(actor.data.groups[0], originals[i]);
      const ids = actor.data.groups.map(g => g.id); assert.equal(new Set(ids).size, ids.length);
      const keys = actor.data.groups.map(g => g.category); assert.equal(new Set(keys).size, keys.length);
    }
  }
});

function mockElement(rows) {
  const controls = [{disabled: false}];
  return {controls, querySelectorAll(selector) {
    if (selector === "button, input") return controls;
    if (selector === ".dsa-prototype-row") return rows.map(row => ({querySelector: selector => ({value: selector.includes("name") ? row.name : row.category})}));
    return [];
  }, querySelector: () => ({focus() {}})};
}

test("editor drafts capture typed values on add/remove, Cancel leaves settings unchanged, Save persists then closes", async () => {
  const editor = new PrototypeVoiceSettings(), initial = getPrototype("voice"); assert.equal((await editor._prepareContext()).rows.length, 7);
  const typed = [...initial.groups, {name: "Fresh input", category: "voice.fresh"}]; editor.element = mockElement(typed);
  await editor.perform("add"); assert.deepEqual(editor.rows.slice(0, -1), typed);
  editor.element = mockElement(editor.rows); await editor.perform("remove", editor.rows.length - 1); assert.deepEqual(editor.rows, typed);
  await editor.perform("cancel"); assert.equal(editor.closed, true); assert.deepEqual(getPrototype("voice"), initial);
  const saving = new PrototypeVoiceSettings(); saving.element = mockElement(typed); await saving.perform("save");
  assert.equal(saving.closed, true); assert.equal(saving.busy, false); assert.deepEqual(getPrototype("voice").groups, typed);
  assert(saving.element.controls.every(c => !c.disabled));
});

test("validation and setting failures keep editor draft open and restore controls; duplicate clicks are ignored while saving", async () => {
  const editor = new PrototypeVoiceSettings(); const bad = [...editor.rows, {name: "", category: "voice."}];
  editor.element = mockElement(bad); await assert.rejects(editor.perform("save"), /PrototypeNameInvalid/);
  assert.equal(editor.closed, false); assert.deepEqual(editor.rows, bad); assert.equal(editor.busy, false);
  assert(editor.element.controls.every(c => !c.disabled));
  editor.busy = true; await editor.perform("add"); assert.deepEqual(editor.rows, bad);
  await editor.close(); assert.equal(editor.closed, false);
  editor.busy = false; const valid = [...getPrototype("voice").groups, {name: "Fresh", category: "voice.fresh"}];
  editor.element = mockElement(valid); game.settings.fail = true;
  await assert.rejects(editor.perform("save"), /setting failed/); assert.equal(editor.closed, false); assert.equal(editor.busy, false);
  assert.deepEqual(editor.rows, valid); assert(editor.element.controls.every(c => !c.disabled));
});

test("non-GMs cannot render or mutate either prototype editor even if constructed manually", async () => {
  game.user.isGM = false;
  for (const Type of [PrototypeVoiceSettings, PrototypeWeaponSettings]) {
    const app = new Type(); await assert.rejects(app._prepareContext(), /PrototypeGMOnly/); await assert.rejects(app.perform("add"), /PrototypeGMOnly/);
  }
});

test("a slow editor redraw locks controls and ignores repeated add clicks without dropping typed rows", async () => {
  const app = new PrototypeVoiceSettings(), typed = [...app.rows, {name: "Typed draft", category: "voice.typed"}];
  app.element = mockElement(typed);
  let finish; app.render = () => new Promise(resolve => { finish = resolve; });
  const rendering = app.perform("add");
  assert.equal(app.busy, true); assert(app.element.controls.every(control => control.disabled));
  await app.perform("add"); assert.equal(app.rows.length, typed.length + 1); assert.deepEqual(app.rows.slice(0, -1), typed);
  finish(); await rendering;
  assert.equal(app.busy, false); assert(app.element.controls.every(control => !control.disabled));
});

test("identical pending broadcasts share a pass while a later settings revision still reaches already-processed Actors", async () => {
  const actor = new Document("Actor", "Actor.slow"); game.actors = [actor];
  const write = actor.setFlag.bind(actor); let finish;
  actor.setFlag = async (...args) => { await new Promise(resolve => { finish = resolve; }); return write(...args); };
  const first = synchronizePrototypes(); assert.equal(synchronizePrototypes(), first);
  // Let the first pass take its document snapshot, then revise the prototype.
  while (!finish) await Promise.resolve();
  values.set("prototypeVoice", draft("voice", "Later", "voice.later"));
  const next = synchronizePrototypes(); assert.notEqual(next, first);
  actor.setFlag = write; finish(); await Promise.all([first, next]);
  assert.equal(actor.data.groups.filter(g => g.category === "voice.later").length, 1);
});
