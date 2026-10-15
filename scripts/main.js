import { MODULE_ID, report } from "./utils.js";
import { createAPI } from "./api.js";
import { openArchive, updateArchives } from "./archive-app.js";
import { registerSheetIntegration } from "./sheet-integration.js";

Hooks.once("init", () => {
  registerSheetIntegration(openArchive);
  for (const name of ["Actor", "Item"]) {
    Hooks.on(`update${name}`, document => updateArchives(document));
    Hooks.on(`delete${name}`, document => updateArchives(document, true));
  }
});

Hooks.once("ready", () => {
  try { game.modules.get(MODULE_ID).api = createAPI(); }
  catch (error) { report(error); }
});
