import { MODULE_ID, fmt, report } from "./utils.js";
import { createDefaultGroupService } from "./default-groups.js";

export const ACTOR_DEFAULT_GROUPS = Object.freeze([
  {name: "attack", category: "voice.attack"},
  {name: "take cover", category: "voice.take-cover"},
  {name: "enter building", category: "voice.enter-building"},
  {name: "movement", category: "voice.movement"},
  {name: "wounded", category: "voice.wounded"},
  {name: "retreat", category: "voice.retreat"}
].map(Object.freeze));

const defaults = createDefaultGroupService("Actor", ACTOR_DEFAULT_GROUPS);
export const addActorDefaults = defaults.add;
export const seedNewActor = defaults.seed;
export const ensureActorDefaults = defaults.ensure;

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
