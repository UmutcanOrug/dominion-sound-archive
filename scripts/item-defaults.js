import { MODULE_ID, fmt, report } from "./utils.js";
import { createDefaultGroupService } from "./default-groups.js";

export const ITEM_DEFAULT_GROUPS = Object.freeze([
  {name: "Bolt-Action", category: "weapon.bolt-action"},
  {name: "Semi-Auto", category: "weapon.semi-auto"},
  {name: "LMG", category: "weapon.lmg"},
  {name: "HMG", category: "weapon.hmg"},
  {name: "Sub-Machine", category: "weapon.sub-machine"},
  {name: "Pistol", category: "weapon.pistol"},
  {name: "Cannon", category: "weapon.cannon"},
  {name: "Reload", category: "weapon.reload"},
  {name: "Explosion", category: "weapon.explosion"}
].map(Object.freeze));

const defaults = createDefaultGroupService("Item", ITEM_DEFAULT_GROUPS);
export const addItemDefaults = defaults.add;
export const seedNewItem = defaults.seed;
export const ensureItemDefaults = defaults.ensure;

async function initializeItems(items) {
  const summary = {updated: 0, failed: 0};
  const seen = new Set();
  for (const item of items) {
    if (!item || seen.has(item.uuid)) continue;
    seen.add(item.uuid);
    try { if (await ensureItemDefaults(item)) summary.updated++; }
    catch (error) {
      summary.failed++;
      console.error(`${MODULE_ID} | Default Item groups: ${item.uuid}`, error);
    }
  }
  if (summary.failed) ui.notifications.warn(fmt("ItemDefaultsFailed", {count: summary.failed}));
  return summary;
}

/** Covers Items supplied inside newly created/imported Actors, where the system
 * may not dispatch separate preCreateItem hooks for the initial inventory. */
export async function initializeActorItems(actor) {
  return initializeItems(actor?.items ?? []);
}

/** One elected GM backfills world Items and equipment on all world/token Actors. */
export async function initializeItemDefaults() {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return {updated: 0, failed: 0};
  const items = [...game.items];
  for (const actor of game.actors) items.push(...actor.items);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) if (!token.actorLink && token.actor) items.push(...token.actor.items);
  }
  return initializeItems(items);
}

export function registerItemDefaults() {
  Hooks.on("preCreateItem", document => {
    try { seedNewItem(document); }
    catch (error) { report(error); }
  });
  const initializeInventory = (actor, userId) => {
    // Creation hooks run on every connected client. Only the elected GM, or the
    // initiating user when no GM is connected, should write the new inventory.
    if ((game.users.activeGM?.id ?? userId) !== game.user.id) return;
    return initializeActorItems(actor).catch(report);
  };
  Hooks.on("createActor", (actor, _options, userId) => initializeInventory(actor, userId));
  Hooks.on("createToken", (token, _options, userId) => {
    if (!token.actorLink) return initializeInventory(token.actor, userId);
  });
}
