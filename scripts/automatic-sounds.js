import { MODULE_ID, isAudioPath, validatePath } from "./utils.js";
import { chooseAutomaticSound, getAutomaticSounds, normalizeSoundName } from "./automatic-sound-data.js";
import { canRead, listClips } from "./library-service.js";
import { AUTOMATIC_VOICE_CATEGORIES } from "./prototype-data.js";

const snapshotKey = "dsaAutomaticSoundBefore";
const wrapped = Symbol("dsaAutomaticSoundRoll");
const localOrigin = userId => userId === game.user.id;
const wounds = actor => actor?._source?.system?.wounds?.value ?? actor?.system?.wounds?.value;
const deadStatus = () => CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
const hasDeathStatus = statuses => ["incapacitated", "dead", deadStatus()].some(id => statuses?.has(id));
const isDeathEffect = effect => Boolean(effect.active) && hasDeathStatus(effect.statuses);

function changedValue(change, path) {
  return change[path] ?? path.split(".").reduce((value, key) => value?.[key], change);
}

function recordBefore(document, options, value) {
  (options[snapshotKey] ??= {})[document.uuid] = value;
}

function currentToken(actor, speaker) {
  if (!actor || !canvas.scene) return;
  if (speaker?.scene && speaker.scene !== canvas.scene.id) return;
  if (speaker?.token) {
    const token = canvas.scene.tokens.get(speaker.token);
    return token?.actor?.uuid === actor.uuid ? token : undefined;
  }
  if (actor.isToken) return actor.token?.parent?.id === canvas.scene.id ? actor.token : undefined;
  const active = actor.getActiveTokens?.(true, true) ?? [];
  return active.find(token => token.object?.controlled)
    ?? active.find(token => !token.hidden) ?? active[0];
}

function personalSound(actor, event) {
  if (!canRead(actor)) return;
  try {
    const clips = listClips(actor).filter(clip => isAudioPath(clip.path));
    const byName = clip => normalizeSoundName(clip.groupName);
    let pool = clips.filter(clip => clip.category === AUTOMATIC_VOICE_CATEGORIES[event]);
    if (!pool.length) pool = clips.filter(clip => byName(clip) === event);
    if (!pool.length && event === "hurt") {
      pool = clips.filter(clip => clip.category === "voice.wounded" || byName(clip) === "wounded");
    }
    if (pool.length) {
      const paths = [...new Set(pool.map(clip => clip.path))];
      return validatePath(paths[Math.floor(Math.random() * paths.length)], true);
    }
  } catch (error) { logPlaybackError(error); }
}

function playSound(actor, token, event) {
  const {enabled, sets} = getAutomaticSounds();
  if (!enabled) return;
  const src = personalSound(actor, event) ?? chooseAutomaticSound(sets, actor.name, token.name, event);
  if (!src) return;
  const recipients = game.users.filter(user => user.active && user.id !== game.user.id
    && user.viewedScene === token.parent.id && (!token.hidden || user.isGM)).map(user => user.id);
  const audio = foundry.audio.AudioHelper.play({src, volume: 0.8, autoplay: true, loop: false},
    recipients.length ? {recipients} : false);
  if (audio?.catch) audio.catch(logPlaybackError);
}

function logPlaybackError(error) {
  console.warn(`${MODULE_ID} | Automatic sounds`, error);
}

function safePlay(actor, token, event) {
  try { playSound(actor, token, event); }
  catch (error) { logPlaybackError(error); }
}

function isDefeated(token) {
  return hasDeathStatus(token.actor?.statuses)
    || (game.combats ?? []).some(combat => combat.scene?.id === token.parent.id &&
      combat.combatants.some(combatant => combatant.tokenId === token.id && combatant.defeated));
}

function isWeaponRoll(options) {
  return options?.item?.type === "weapon" && !options.suppressChat;
}

function isNativeAttackMessage(message) {
  return message?.rolls?.some(roll => roll.options?.rollType === "attack" && !roll.options.rerollMode);
}

function toolsAttackToken(message) {
  // SWADE Tools 2.3.0 attaches these flags to the original ItemRoll chat
  // message. Its rerolls copy flags after create; damage uses a separate type.
  const flags = message.flags?.["swade-tools"];
  if (!flags?.itemroll || !["skill", "attribute"].includes(flags.rolltype)
    || !message.rolls?.some(roll => !roll.options?.rerollMode)) return;
  const scene = canvas.scene;
  if (!scene || (message.speaker?.scene && message.speaker.scene !== scene.id)) return;
  const speaker = message.speakerActor;
  const token = flags.usetoken && scene.tokens.get(flags.usetoken);
  if (flags.usetoken && !token) return;
  const actor = token?.actor ?? speaker ?? game.actors?.get(flags.useactor);
  if (!actor || (flags.useactor && actor.id !== flags.useactor)) return;
  const owner = flags.usevehicletoken ? scene.tokens.get(flags.usevehicletoken)?.actor
    : flags.usevehicle ? game.actors?.get(flags.usevehicle) : actor;
  const item = owner?.items?.get(flags.itemroll);
  if (item?.type !== "weapon") return;
  return token ?? currentToken(actor, message.speaker);
}

export function registerAutomaticSoundHooks() {
  if (game.system.id !== "swade") return;
  const hurtTimers = new Map();
  const recentDeaths = new Map();
  const playedAttacks = new WeakSet();

  function attack(message, actor, resolvedToken) {
    if (!message || message.blind || message.whisper?.length || message.isContentVisible === false || playedAttacks.has(message)) return;
    const token = resolvedToken ?? currentToken(actor ?? message.speakerActor, message.speaker);
    if (!token) return;
    playedAttacks.add(message);
    safePlay(token.actor, token, "attack");
  }

  // SWADE 5.1 weapon attacks can be serialized as ordinary trait rolls. The
  // native call identifies the weapon and returns the exact created message.
  const prototype = CONFIG.Actor.documentClass.prototype;
  for (const method of ["rollSkill", "rollAttribute"]) {
    const original = prototype[method];
    if (typeof original !== "function" || original[wrapped]) continue;
    const wrapper = async function (...args) {
      const options = args[1];
      const weaponRoll = isWeaponRoll(options);
      const result = await original.apply(this, args);
      if (weaponRoll) {
        try {
          const messageId = result?.options?.messageId;
          const message = messageId && game.messages.get(messageId);
          if (message) attack(message, this);
        } catch (error) { logPlaybackError(error); }
      }
      return result;
    };
    wrapper[wrapped] = true;
    prototype[method] = wrapper;
  }

  Hooks.on("createChatMessage", (message, _options, userId) => {
    if (!localOrigin(userId)) return;
    if (isNativeAttackMessage(message)) return attack(message);
    const token = toolsAttackToken(message);
    if (token) attack(message, token.actor, token);
  });

  function death(token) {
    if (!token || token.parent?.id !== canvas.scene?.id || !token.actor) return;
    const key = token.uuid;
    clearTimeout(hurtTimers.get(key));
    hurtTimers.delete(key);
    if (recentDeaths.has(key)) return;
    const expiry = setTimeout(() => recentDeaths.delete(key), 1500);
    expiry?.unref?.();
    recentDeaths.set(key, expiry);
    safePlay(token.actor, token, "death");
  }

  function resetDeath(token) {
    if (!token || isDefeated(token)) return;
    clearTimeout(recentDeaths.get(token.uuid));
    recentDeaths.delete(token.uuid);
  }

  function handleWounds(actor, changed, previous, userId) {
    const next = changedValue(changed, "system.wounds.value");
    if (!localOrigin(userId) || typeof next !== "number" || typeof previous !== "number" || next <= previous) return;
    const token = currentToken(actor);
    if (!token || recentDeaths.has(token.uuid) || isDefeated(token)) return;
    clearTimeout(hurtTimers.get(token.uuid));
    hurtTimers.set(token.uuid, setTimeout(() => {
      hurtTimers.delete(token.uuid);
      if (token.parent.id === canvas.scene?.id && !isDefeated(token)) safePlay(actor, token, "hurt");
    }, 220));
  }

  Hooks.on("preUpdateActor", (actor, changed, options) => {
    if (typeof changedValue(changed, "system.wounds.value") === "number") recordBefore(actor, options, wounds(actor));
  });
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    handleWounds(actor, changed, options.swade?.wounds?.value ?? options[snapshotKey]?.[actor.uuid], userId);
  });

  // Unlinked tokens persist their Actor changes through ActorDelta. Both
  // notifications can occur for one wound update and share the token's timer.
  Hooks.on("preUpdateActorDelta", (delta, changed, options) => {
    if (typeof changedValue(changed, "system.wounds.value") === "number") recordBefore(delta, options, wounds(delta.parent?.actor));
  });
  Hooks.on("updateActorDelta", (delta, changed, options, userId) => {
    const actor = delta.parent?.actor;
    if (actor) handleWounds(actor, changed, options.swade?.wounds?.value ?? options[snapshotKey]?.[delta.uuid], userId);
  });

  Hooks.on("preUpdateCombatant", (combatant, changed, options) => {
    if (typeof changed.defeated === "boolean") recordBefore(combatant, options, combatant.defeated);
  });
  Hooks.on("updateCombatant", (combatant, changed, options, userId) => {
    if (!localOrigin(userId) || typeof changed.defeated !== "boolean") return;
    if (changed.defeated && options[snapshotKey]?.[combatant.uuid] === false) death(combatant.token);
    if (!changed.defeated) resetDeath(combatant.token);
  });

  Hooks.on("createActiveEffect", (effect, _options, userId) => {
    if (localOrigin(userId) && effect.parent?.documentName === "Actor" && isDeathEffect(effect)) death(currentToken(effect.parent));
  });
  Hooks.on("preUpdateActiveEffect", (effect, _changed, options) => {
    if (effect.parent?.documentName === "Actor") recordBefore(effect, options, isDeathEffect(effect));
  });
  Hooks.on("updateActiveEffect", (effect, _changed, options, userId) => {
    if (!localOrigin(userId) || effect.parent?.documentName !== "Actor") return;
    const before = options[snapshotKey]?.[effect.uuid];
    if (before === false && isDeathEffect(effect)) death(currentToken(effect.parent));
    if (before && !isDeathEffect(effect)) resetDeath(currentToken(effect.parent));
  });
  Hooks.on("deleteActiveEffect", (effect, _options, userId) => {
    if (localOrigin(userId) && effect.parent?.documentName === "Actor" && isDeathEffect(effect)) resetDeath(currentToken(effect.parent));
  });
}
