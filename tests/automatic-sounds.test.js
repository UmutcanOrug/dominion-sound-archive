import assert from "node:assert/strict";
import test, {beforeEach} from "node:test";
import { chooseAutomaticSound, validateSoundSets } from "../scripts/automatic-sound-data.js";
import { registerAutomaticSoundHooks } from "../scripts/automatic-sounds.js";

const userId = "gm";
const weapon = {type: "weapon"};
let audio, callbacks, scene, actor, token, state, calls;

function fire(name, ...params) { callbacks.get(name)?.(...params); }

function message(id, extra = {}) {
  const msg = {id, speaker: {scene: scene.id, token: token.id}, speakerActor: actor,
    rolls: [{options: {rollType: "trait"}}], whisper: [], ...extra};
  game.messages.set(id, msg);
  return msg;
}

beforeEach(() => {
  audio = [];
  callbacks = new Map();
  calls = [];
  state = {schemaVersion: 1, enabled: true, sets: [
    {name: "İzci", attack: ["attack.ogg"], hurt: ["hurt.ogg"], death: ["death.ogg"]},
    {name: "Squad 2", attack: ["token.ogg"], hurt: [], death: []}
  ]};
  class Actor {
    async rollSkill(...args) { calls.push(args); return this.result; }
    async rollAttribute(...args) { calls.push(args); return this.result; }
    getActiveTokens() { return [token]; }
  }
  actor = Object.assign(new Actor(), {name: " izci  ", documentName: "Actor", uuid: "Actor.a",
    statuses: new Set(), system: {wounds: {value: 1}}});
  scene = {id: "s", tokens: new Map()};
  token = {id: "t", uuid: "Scene.s.Token.t", name: "Squad 2", parent: scene, actor};
  scene.tokens.set(token.id, token);
  globalThis.CONFIG = {Actor: {documentClass: Actor}, specialStatusEffects: {DEFEATED: "dead"}};
  globalThis.canvas = {scene};
  globalThis.Hooks = {on: (name, callback) => callbacks.set(name, callback)};
  globalThis.foundry = {audio: {AudioHelper: {play: (data, socket) => audio.push({src: data.src, socket})}}};
  const users = [
    {id: userId, active: true, viewedScene: "s", isGM: true},
    {id: "player", active: true, viewedScene: "s"},
    {id: "gm2", active: true, viewedScene: "s", isGM: true},
    {id: "offscene", active: true, viewedScene: "other"},
    {id: "offline", active: false, viewedScene: "s"}
  ];
  globalThis.game = {user: users[0], users, system: {id: "swade"}, messages: new Map(), combats: [],
    i18n: {localize: key => key}, settings: {get: () => state}};
  registerAutomaticSoundHooks();
});

test("normalizes whole Actor names, prefers them over the token label and chooses within the requested pool", () => {
  const sets = validateSoundSets([{name: " İzci   Takımı ", attack: ["a.ogg", "a.ogg", "b.wav"], hurt: [], death: []}, state.sets[1]]);
  assert.deepEqual(sets[0].attack, ["a.ogg", "b.wav"]);
  assert.equal(chooseAutomaticSound(sets, "İZCİ takımı", "Squad 2", "attack", () => 0.9), "b.wav");
  assert.equal(chooseAutomaticSound(sets, "Some actor", "SQUAD 2", "attack"), "token.ogg");
  assert.equal(chooseAutomaticSound(sets, "İzci", "", "attack"), undefined);
  assert.equal(chooseAutomaticSound(sets, "İzci Takımı", "Squad 2", "hurt"), undefined);
  assert.throws(() => validateSoundSets([sets[0], {...sets[0], name: "İZCİ takımı"}]), /AutoDuplicateName/);
  assert.throws(() => validateSoundSets([{...sets[0], hurt: ["javascript:test.ogg"]}]), /InvalidPath/);
});

test("completed native SWADE weapon trait and attribute rolls play once and preserve the return value", async () => {
  const msg = message("m");
  actor.result = {options: {messageId: msg.id}, total: 3};
  assert.equal(await actor.rollSkill("fighting", {item: weapon}), actor.result);
  assert.equal(await actor.rollAttribute("agility", {item: weapon}), actor.result);
  assert.deepEqual(audio, [{src: "attack.ogg", socket: {recipients: ["player", "gm2"]}}]);
  assert.equal(calls.length, 2);
  await actor.rollAttribute("agility");
  assert.equal(calls[2].length, 1);
});

test("native attack-tagged messages broadcast from their originator once and skip rerolls", async () => {
  const msg = message("m", {rolls: [{options: {rollType: "attack"}}]});
  fire("createChatMessage", msg, {}, "other");
  assert.equal(audio.length, 0);
  fire("createChatMessage", msg, {}, userId);
  actor.result = {options: {messageId: msg.id}};
  await actor.rollSkill("unskilled", {item: weapon});
  fire("createChatMessage", message("r", {rolls: [{options: {rollType: "attack", rerollMode: "benny"}}]}), {}, userId);
  assert.equal(audio.length, 1);
});

test("cancellation, silent rolls, nonweapon actions, damage dice, private rolls and offscene messages do not play Attack", async () => {
  const msg = message("m");
  actor.result = null;
  await actor.rollSkill("fighting", {item: weapon});
  actor.result = {options: {messageId: msg.id}};
  await actor.rollSkill("fighting", {item: weapon, suppressChat: true});
  await actor.rollSkill("test", {item: {type: "power"}});
  for (const [id, extra] of [["private", {whisper: ["gm"]}], ["blind", {blind: true}],
    ["offscene", {speaker: {scene: "other", token: token.id}}], ["invisible", {isContentVisible: false}]]) {
    actor.result = {options: {messageId: message(id, extra).id}};
    await actor.rollSkill("fighting", {item: weapon});
  }
  fire("createChatMessage", message("d", {rolls: [{options: {rollType: "damage"}}]}), {}, userId);
  assert.deepEqual(audio, []);
});

test("disabled or unmatched sets remain silent and hidden tokens only send to other GMs", async () => {
  state.enabled = false;
  actor.result = {options: {messageId: message("disabled").id}};
  await actor.rollSkill("fighting", {item: weapon});
  state.enabled = true;
  token.hidden = true;
  actor.name = "Other";
  token.name = "Unmatched";
  actor.result = {options: {messageId: message("missing").id}};
  await actor.rollSkill("fighting", {item: weapon});
  assert.equal(audio.length, 0);
  token.name = "Squad 2";
  actor.result = {options: {messageId: message("hidden").id}};
  await actor.rollSkill("fighting", {item: weapon});
  assert.deepEqual(audio, [{src: "token.ogg", socket: {recipients: ["gm2"]}}]);
});

function updateWounds(next, changes = {"system.wounds.value": next}, user = userId) {
  const options = {};
  fire("preUpdateActor", actor, changes, options, user);
  actor.system.wounds.value = next;
  fire("updateActor", actor, changes, options, user);
}

function changeDefeat(combatant, defeated) {
  const options = {};
  fire("preUpdateCombatant", combatant, {defeated}, options, userId);
  combatant.defeated = defeated;
  fire("updateCombatant", combatant, {defeated}, options, userId);
}

test("increasing Wounds plays Hurt for the exact synthetic token and ignores healing, fatigue and remote updates", async () => {
  actor.isToken = true;
  actor.token = token;
  actor.getActiveTokens = () => { throw Error("Synthetic token should resolve directly"); };
  updateWounds(0);
  updateWounds(0, {system: {fatigue: {value: 1}}});
  updateWounds(1, {system: {wounds: {value: 1}}}, "player");
  updateWounds(2, {system: {wounds: {value: 2}}});
  await new Promise(resolve => setTimeout(resolve, 245));
  assert.deepEqual(audio.map(a => a.src), ["hurt.ogg"]);
});

test("Actor and ActorDelta wound notifications for one unlinked token share one Hurt sound", async () => {
  actor.isToken = true;
  actor.token = token;
  const delta = {uuid: token.uuid + ".ActorDelta.t", parent: token};
  const changed = {system: {wounds: {value: 2}}};
  const options = {};
  fire("preUpdateActorDelta", delta, changed, options, userId);
  actor.system.wounds.value = 2;
  fire("updateActorDelta", delta, changed, options, userId);
  fire("updateActor", actor, changed, {swade: {wounds: {value: 1}}}, userId);
  await new Promise(resolve => setTimeout(resolve, 245));
  assert.deepEqual(audio.map(a => a.src), ["hurt.ogg"]);
});

test("Defeated and Dead in the same update sequence play Death once, suppress Hurt and allow a second death after recovery", async () => {
  const combatant = {uuid: "Combat.c.Combatant.a", token, tokenId: token.id, defeated: false};
  game.combats = [{scene, combatants: [combatant]}];
  const effect = {uuid: "Actor.a.ActiveEffect.dead", parent: actor, active: true, statuses: new Set(["dead"])};
  updateWounds(2);
  changeDefeat(combatant, true);
  actor.statuses.add("dead");
  fire("createActiveEffect", effect, {}, userId);
  changeDefeat(combatant, true);
  await new Promise(resolve => setTimeout(resolve, 245));
  assert.deepEqual(audio.map(a => a.src), ["death.ogg"]);
  changeDefeat(combatant, false);
  actor.statuses.delete("dead");
  fire("deleteActiveEffect", effect, {}, userId);
  changeDefeat(combatant, true);
  assert.deepEqual(audio.map(a => a.src), ["death.ogg", "death.ogg"]);
});

test("Incapacitated, item effects, disabled effects and remote clients do not trigger Death", () => {
  const effect = {uuid: "e", parent: actor, active: true, statuses: new Set(["incapacitated"])};
  fire("createActiveEffect", effect, {}, userId);
  effect.statuses = new Set(["dead"]);
  fire("createActiveEffect", {...effect, parent: {documentName: "Item"}}, {}, userId);
  fire("createActiveEffect", effect, {}, "other");
  effect.active = false;
  fire("createActiveEffect", effect, {}, userId);
  assert.equal(audio.length, 0);
  const options = {};
  fire("preUpdateActiveEffect", effect, {disabled: false}, options, userId);
  effect.active = true;
  fire("updateActiveEffect", effect, {disabled: false}, options, userId);
  assert.deepEqual(audio.map(a => a.src), ["death.ogg"]);
});

test("outside SWADE no roll or document handlers are registered", () => {
  game.system.id = "pf2e";
  callbacks.clear();
  registerAutomaticSoundHooks();
  assert.equal(callbacks.size, 0);
});

test("the GM settings menu saves named pools separately from document archives and reopens the saved data", async () => {
  class Application {
    async close() { this.closed = true; }
  }
  foundry.applications = {api: {ApplicationV2: Application, HandlebarsApplicationMixin: Base => Base}};
  const {registerAutomaticSoundSettings, AutomaticSoundSettings} = await import("../scripts/automatic-sound-settings.js");
  let config, menu;
  game.settings.register = (_scope, _key, value) => { config = value; };
  game.settings.registerMenu = (_scope, _key, value) => { menu = value; };
  game.settings.set = (_scope, _key, value) => { state = value; };
  globalThis.ui = {notifications: {info() {}}};
  registerAutomaticSoundSettings();
  assert.equal(config.scope, "world");
  assert.equal(menu.restricted, true);
  assert.equal(menu.type, AutomaticSoundSettings);
  state = config.default;
  const editor = new AutomaticSoundSettings();
  const paths = {attack: "forge/a.ogg\nforge/b.ogg", hurt: "hurt.wav", death: ""};
  editor.element = {
    querySelector() { return {checked: true}; },
    querySelectorAll(selector) {
      if (selector !== "[data-auto-set]") return [];
      return [{querySelector(field) {
        if (field === "[data-auto-name]") return {value: "Scout"};
        return {value: paths[Object.keys(paths).find(event => field.includes(event))]};
      }}];
    }
  };
  editor.draft.sets.push({name: "", attack: [], hurt: [], death: []});
  await editor.perform({dataset: {autoAction: "save"}, closest() {}});
  assert.equal(editor.closed, true);
  const reopened = new AutomaticSoundSettings();
  assert.deepEqual((await reopened._prepareContext()).sets[0].pools.map(pool => pool.paths),
    ["forge/a.ogg\nforge/b.ogg", "hurt.wav", ""]);
  assert.equal(actor.getFlag, undefined);
  game.user.isGM = false;
  await assert.rejects(reopened._prepareContext(), /AutoGMOnly/);
});
