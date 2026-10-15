// Foundry Script macro. Returns references only; no playback or combat hooks.
const api = game.modules.get("dominion-sound-archive")?.api;
if (!api) return ui.notifications.warn("Enable Dominion Sound Archive first.");
const soldier = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!soldier) return ui.notifications.warn("Select a soldier/squad token first.");
const weapon = soldier.items.find(item => item.name === "Valterion Mk.2");
if (!weapon) return ui.notifications.warn("This Actor has no Valterion Mk.2 Item.");
try {
  const weaponClip = api.getRandomClip(weapon, {category: "weapon.fire"});
  const voiceClip = api.getRandomClip(soldier, {category: "voice.attack"});
  console.log("Dominion audio references", {weaponClip, voiceClip});
  ui.notifications.info(`Weapon: ${weaponClip?.name ?? "none"}; voice: ${voiceClip?.name ?? "none"}`);
  // weaponClip?.path and voiceClip?.path are ready for a future sound system.
} catch (error) { ui.notifications.error(error.message); }
