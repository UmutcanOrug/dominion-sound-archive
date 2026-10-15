import test, {beforeEach} from "node:test";
import assert from "node:assert/strict";
import * as service from "../scripts/library-service.js";
import { scanFolder, selectAsset } from "../scripts/forge-browser.js";
import { AudioPreview } from "../scripts/audio-preview.js";
import { registerSheetIntegration } from "../scripts/sheet-integration.js";
import { escapeHTML, validatePath } from "../scripts/utils.js";

class Document {
  constructor(type = "Actor", uuid = "Actor.a") {
    this.documentName = type; this.uuid = uuid; this.name = "Soldier";
    this.isOwner = true; this.readable = true; this.updateable = true;
    this.flags = {}; this.writes = 0;
  }
  testUserPermission() { return this.readable; }
  canUserModify() { return this.updateable; }
  getFlag(namespace, key) { return this.flags[namespace]?.[key]; }
  async setFlag(namespace, key, value) {
    await new Promise(resolve => setTimeout(resolve, 1));
    this.flags[namespace] ??= {}; this.flags[namespace][key] = structuredClone(value); this.writes++;
  }
}

beforeEach(() => {
  globalThis.game = {user: {id: "gm"}, packs: new Map(), i18n: {localize: key => key, format: key => key}};
  globalThis.ForgeVTT = {usingTheForge: true};
  globalThis.foundry = {applications: {apps: {FilePicker: {implementation: {
    browse: async () => ({files: ["https://assets.forge-vtt.com/u/Attack%2001.ogg", "https://assets.forge-vtt.com/u/Fire_02.mp3", "image.png"], dirs: []})
  }}}}};
  globalThis.ui = {notifications: {error: () => {}, info: () => {}}};
});

test("Actor, world Item and embedded Item archives persist independently; cloned documents keep flags", async () => {
  const actor = new Document();
  const item = new Document("Item", "Item.i");
  const embedded = new Document("Item", "Actor.a.Item.i"); embedded.parent = actor;
  const [voice, fire, embeddedFire] = await Promise.all([
    service.addGroup(actor, {name: "Attack", category: "voice.attack"}),
    service.addGroup(item, {name: "Fire", category: "weapon.fire"}),
    service.addGroup(embedded, {name: "Fire", category: "weapon.fire"})
  ]);
  await service.addFile(actor, voice.id, {path: "voice/Attack 01.ogg"});
  await service.addFile(item, fire.id, {path: "weapons/Fire.mp3"});
  await service.addFile(embedded, embeddedFire.id, {path: "weapons/Embedded.wav"});
  actor.name = "Renamed";
  assert.equal(service.listClips(actor)[0].path, "voice/Attack 01.ogg");
  assert.equal(service.listClips(item)[0].path, "weapons/Fire.mp3");
  assert.equal(service.listClips(embedded)[0].documentUuid, "Actor.a.Item.i");
  const duplicate = new Document("Actor", "Actor.b"); duplicate.flags = structuredClone(actor.flags);
  assert.deepEqual(service.getLibrary(duplicate), service.getLibrary(actor));
  const reloaded = new Document(); reloaded.flags = JSON.parse(JSON.stringify(actor.flags));
  assert.deepEqual(service.getLibrary(reloaded), service.getLibrary(actor));
  service.getLibrary(actor).groups.length = 0;
  assert.equal(service.getLibrary(actor).groups.length, 1);
});

test("Forge folder scan uses a single recursive request, retains playable URLs and filters assets", async () => {
  const calls = [];
  const original = foundry.applications.apps.FilePicker.implementation.browse;
  foundry.applications.apps.FilePicker.implementation.browse = async (...args) => { calls.push(args); return original(...args); };
  const actor = new Document(); const group = await service.addGroup(actor, {name: "Attack"});
  const folder = await service.addFolder(actor, group.id, {name: "Normal", source: "forgevtt", path: "legion/attack", recursive: true});
  assert.deepEqual(calls, [["forgevtt", "legion/attack", {recursive: true}]]);
  assert.equal(folder.clips.length, 2);
  assert.equal(folder.clips[0].name, "Attack 01.ogg");
  assert.equal(service.listClips(actor)[0].folderId, folder.id);
  assert.match(service.getRandomClip(actor).path, /^https:/);
  assert.equal(service.listClips(actor, {search: "Attack 01"}).length, 1);
});

test("refresh replaces cache, sees new files, preserves exclusions and keeps old cache on failure", async () => {
  const actor = new Document(); const group = await service.addGroup(actor, {name: "Attack", category: "voice.attack"});
  const folder = await service.addFolder(actor, group.id, {source: "forgevtt", path: "voice"});
  const hidden = folder.clips[0].path;
  await service.removeFolderClip(actor, folder.id, hidden);
  foundry.applications.apps.FilePicker.implementation.browse = async () => ({files: [hidden, "new/Attack_03.ogg"]});
  await service.refreshFolder(actor, folder.id);
  assert.deepEqual(service.listClips(actor).map(c => c.path), ["new/Attack_03.ogg"]);
  const before = service.getLibrary(actor);
  foundry.applications.apps.FilePicker.implementation.browse = async () => { throw new Error("403"); };
  await assert.rejects(service.refreshFolder(actor, folder.id), /FolderUnavailable/);
  assert.deepEqual(service.getLibrary(actor), before);
  await service.removeEntry(actor, folder.id);
  assert.equal(service.listClips(actor).length, 0);
});

test("nonrecursive is default; non-Forge recursive browse walks each directory once", async () => {
  const calls = [];
  foundry.applications.apps.FilePicker.implementation.browse = async (source, path, options) => {
    calls.push({source, path, options});
    return path === "root" ? {files: ["root/a.ogg"], dirs: ["root/sub", "root/sub"]} : {files: ["root/sub/b.mp3"], dirs: []};
  };
  assert.equal((await scanFolder({source: "data", path: "root"})).length, 1);
  calls.length = 0;
  assert.equal((await scanFolder({source: "data", path: "root", recursive: true})).length, 2);
  assert.equal(calls.length, 2);
  assert(!("recursive" in calls[0].options));
});

test("empty groups and filters are safe; API returns metadata without playing audio", async () => {
  const actor = new Document();
  assert.deepEqual(service.listClips(actor), []); assert.equal(service.getRandomClip(actor), null);
  const group = await service.addGroup(actor, {name: "Fire", category: "weapon.fire"});
  assert.equal(service.getRandomClip(actor, {category: "weapon.fire"}), null);
  await service.addFile(actor, group.id, {path: "sounds/fire.webm?version=1", name: "Burst", label: "heavy"});
  const clip = service.getRandomClip(actor, {groupId: group.id, category: "weapon.fire"});
  assert.equal(clip.name, "Burst"); assert.equal(clip.label, "heavy"); assert.equal(clip.folderId, null);
  assert.equal(service.getRandomClip(actor, {category: "voice.attack"}), null);
});

test("ownership, update permission, locked packs, invalid inputs and newer schemas are enforced", async () => {
  const actor = new Document(); actor.isOwner = false;
  assert.deepEqual(service.getLibrary(actor).groups, []);
  await assert.rejects(service.addGroup(actor, {name: "Denied"}), /EditDenied/);
  actor.isOwner = true; actor.updateable = false;
  await assert.rejects(service.addGroup(actor, {name: "Denied"}), /EditDenied/);
  actor.updateable = true; actor.pack = "compendium.actors"; game.packs.set(actor.pack, {locked: true});
  await assert.rejects(service.addGroup(actor, {name: "Denied"}), /EditDenied/);
  actor.pack = null; actor.readable = false;
  assert.throws(() => service.getLibrary(actor), /ReadDenied/);
  actor.readable = true; actor.flags = {"dominion-sound-archive": {library: {schemaVersion: 99, groups: []}}};
  await assert.rejects(service.addGroup(actor, {name: "Denied"}), /UnsupportedSchema/);
  assert.equal(actor.writes, 0);
  assert.throws(() => service.getLibrary({}), /InvalidDocument/);
  assert.throws(() => validatePath("javascript:alert(1).ogg", true));
  assert.throws(() => validatePath("data:audio/ogg;base64,abc", true));
  assert.throws(() => validatePath("image.jpg", true));
  assert.equal(escapeHTML('<script a="x">'), "&lt;script a=&quot;x&quot;&gt;");
});

test("group names, unique category keys, same-client concurrent writes and ordering", async () => {
  const actor = new Document();
  const [a, b, c] = await Promise.all(["A", "B", "C"].map(name => service.addGroup(actor, {name, category: `group.${name}`})));
  assert.equal(service.getLibrary(actor).groups.length, 3);
  await assert.rejects(service.addGroup(actor, {name: "D", category: "group.A"}), /DuplicateCategory/);
  await assert.rejects(service.addGroup(actor, {name: ""}), /NameRequired/);
  await service.reorder(actor, {groupId: c.id, beforeId: a.id});
  assert.deepEqual(service.getLibrary(actor).groups.map(g => g.name), ["C", "A", "B"]);
  await service.reorder(actor, {groupId: c.id, offset: 1});
  assert.deepEqual(service.getLibrary(actor).groups.map(g => g.name), ["A", "C", "B"]);
  await service.editGroup(actor, b.id, {name: "Reload", category: "weapon.reload"});
  const file = await service.addFile(actor, a.id, {path: "audio/A.ogg"});
  await service.editEntry(actor, file.id, {name: "Altered", label: "custom"});
  assert.equal(service.listClips(actor)[0].label, "custom");
  await service.removeGroup(actor, a.id);
  assert.equal(service.listClips(actor).length, 0);
});

test("unavailable Forge rejects refresh without losing usable cache", async () => {
  const actor = new Document(); const group = await service.addGroup(actor, {name: "Voice"});
  const folder = await service.addFolder(actor, group.id, {source: "forgevtt", path: "voice"});
  ForgeVTT.usingTheForge = false;
  await assert.rejects(service.refreshFolder(actor, folder.id), /ForgeUnavailable/);
  assert.equal(service.listClips(actor).length, 2);
});

test("native picker uses Forge, disables upload and retains relative directory, source and bucket", () => {
  let options; let result;
  class Picker {
    constructor(config) { options = config; this.activeSource = "forgevtt"; this.sources = {forgevtt: {target: "voice/attack"}}; }
    render() { return Promise.resolve(); }
  }
  foundry.applications.apps.FilePicker.implementation = Picker;
  selectAsset("folder", selection => { result = selection; });
  assert.equal(options.activeSource, "forgevtt"); assert.equal(options.allowUpload, false);
  options.callback("https://assets.forge-vtt.com/u/voice/attack");
  assert.equal(result.target, "voice/attack"); assert.equal(result.source, "forgevtt");
});

test("local preview stops previous audio across windows and ends on close, cancellation is safe", async () => {
  const audios = [];
  globalThis.Audio = class {
    constructor(path) { this.path = path; audios.push(this); }
    play() { this.played = true; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() {} load() {}
  };
  const preview = new AudioPreview(); const first = {}, second = {};
  await preview.toggle("voice/a.ogg", first);
  await preview.toggle("weapon/b.mp3", second);
  assert.equal(audios[0].paused, true); assert.equal(preview.owner, second);
  preview.stop(first); assert.equal(preview.path, "weapon/b.mp3");
  await preview.toggle("weapon/b.mp3", second); assert.equal(preview.path, null);
  let errors = 0; ui.notifications.error = () => errors++;
  globalThis.Audio.prototype.play = () => Promise.reject(new Error("codec"));
  const log = console.error; console.error = () => {};
  try { await preview.toggle("unsupported.webm", first); } finally { console.error = log; }
  assert.equal(preview.path, null); assert.equal(errors, 1);
});

test("V1 and V2 header hooks support Actors and embedded Items without duplicate controls", () => {
  const callbacks = new Map(); const opened = [];
  globalThis.Hooks = {on: (name, fn) => callbacks.set(name, fn)};
  registerSheetIntegration(document => { opened.push(document.uuid); });
  const actor = new Document(); const app = {document: actor}; actor.sheet = app;
  const controls = [{action: "systemControl"}];
  const v2 = callbacks.get("getHeaderControlsApplicationV2");
  for (let i = 0; i < 5; i++) v2(app, controls);
  assert.equal(controls.length, 2); controls[1].onClick(); assert.deepEqual(opened, [actor.uuid]);
  const item = new Document("Item", "Actor.a.Item.b"); const sheet = {object: item}; item.sheet = sheet;
  const buttons = [{class: "existing"}]; const v1 = callbacks.get("getItemSheetHeaderButtons");
  v1(sheet, buttons); v1(sheet, buttons);
  assert.equal(buttons.length, 2); assert.equal(buttons[1].class, "existing");
  buttons[0].onclick(); assert.equal(opened[1], item.uuid);
  actor.readable = false; const denied = []; v2(app, denied); assert.equal(denied.length, 0);
});
