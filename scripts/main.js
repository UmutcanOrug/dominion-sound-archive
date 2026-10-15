import { MODULE_ID, report } from "./utils.js";
import { createAPI } from "./api.js";
import { openArchive, updateArchives } from "./archive-app.js";
import { registerSheetIntegration } from "./sheet-integration.js";
import { registerActorDefaults, initializeActorDefaults } from "./actor-defaults.js";
import { registerItemDefaults, initializeItemDefaults } from "./item-defaults.js";

Hooks.once("init", () => {
  registerSheetIntegration(openArchive);
  registerActorDefaults();
  registerItemDefaults();
  for (const name of ["Actor", "Item"]) {
    Hooks.on(`update${name}`, document => updateArchives(document));
    Hooks.on(`delete${name}`, document => updateArchives(document, true));
  }
});

Hooks.once("ready", async () => {
  try {
    game.modules.get(MODULE_ID).api = createAPI();
    await initializeActorDefaults();
    await initializeItemDefaults();
  }
  catch (error) { report(error); }
});
