import { openArchive } from "./archive-app.js";
import { getLibrary, listClips, getRandomClip, refreshFolder } from "./library-service.js";

export function createAPI() {
  return Object.freeze({version: "1.0.4", schemaVersion: 1, openArchive, getLibrary, listClips, getRandomClip, refreshFolder});
}
