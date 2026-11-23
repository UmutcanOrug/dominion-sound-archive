import { MODULE_ID, escapeHTML, pathName, report, t, validatePath } from "./utils.js";
import { scanFolder, selectAsset } from "./forge-browser.js";
import { preview } from "./audio-preview.js";
import { AUTOMATIC_SOUND_KEY, AUTOMATIC_SOUND_SCHEMA, SOUND_EVENTS, getAutomaticSounds, validateSoundSets } from "./automatic-sound-data.js";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;
const eventLabels = {attack: "AutoAttack", hurt: "AutoHurt", death: "AutoDeath"};

export class AutomaticSoundSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dsa-automatic-sound-matching",
    classes: ["dominion-sound-archive", "dsa-automatic"],
    window: {icon: "fa-solid fa-volume-high", resizable: true},
    position: {width: 800, height: 660}
  };
  static PARTS = {settings: {template: `modules/${MODULE_ID}/templates/automatic-sounds.hbs`, scrollable: [".dsa-library"]}};

  constructor(options = {}) {
    super(options);
    this.original = getAutomaticSounds();
    this.draft = structuredClone(this.original);
    this.collapsedPools = new WeakSet();
    this.openFolders = new WeakSet();
    this.busy = false;
    this.editorClosed = false;
  }

  get title() { return t("AutoMenu"); }

  async _prepareContext() {
    if (!game.user.isGM) throw new Error(t("AutoGMOnly"));
    const sets = this.draft.sets.map(set => ({
      name: set.name,
      pools: SOUND_EVENTS.map(event => {
        const entries = set[event].map(entry => typeof entry === "string"
          ? {path: entry, name: pathName(entry), count: 1}
          : {...entry, isFolder: true, count: entry.clips.length, expanded: this.openFolders.has(entry)});
        return {event, label: t(eventLabels[event]), entries, expanded: !this.collapsedPools.has(set[event]),
          count: entries.reduce((total, entry) => total + entry.count, 0)};
      })
    }));
    return {sets, enabled: this.draft.enabled};
  }

  capture() {
    this.draft.enabled = this.element.querySelector("[data-auto-enabled]").checked;
    for (const field of this.element.querySelectorAll("[data-auto-name]")) {
      const {autoSet} = field.closest("[data-auto-set]").dataset;
      this.draft.sets[Number(autoSet)].name = field.value;
    }
    for (const details of this.element.querySelectorAll("details[data-event]")) {
      const pool = this.poolAt(details);
      if (details.open) this.collapsedPools.delete(pool);
      else this.collapsedPools.add(pool);
      for (const folder of details.querySelectorAll("details[data-auto-entry]")) {
        const entry = pool[Number(folder.dataset.autoEntry)];
        if (folder.open) this.openFolders.add(entry);
        else this.openFolders.delete(entry);
      }
    }
  }

  poolAt(element) {
    const {autoSet} = element.closest("[data-auto-set]").dataset;
    return this.draft.sets[Number(autoSet)][element.closest("[data-event]").dataset.event];
  }

  applyBusy() {
    // Disable controls rather than a fieldset. A newly rendered fieldset can
    // otherwise keep descendants disabled after the app leaves its busy state.
    this.element?.querySelectorAll(".dsa-shell input, .dsa-shell button").forEach(control => {
      control.disabled = this.busy;
    });
  }

  async runEdit(operation) {
    this.busy = true;
    try {
      this.applyBusy();
      await operation();
    } finally {
      this.busy = false;
      this.applyBusy();
    }
  }

  async folderOptions(selection) {
    const name = pathName(selection.target || "/") || "/";
    return DialogV2.prompt({
      window: {title: t("AddFolder")}, rejectClose: false,
      content: `<div class="form-group"><label for="dsa-auto-folder-name">${escapeHTML(t("Name"))}</label>
        <input id="dsa-auto-folder-name" type="text" name="name" maxlength="200" required value="${escapeHTML(name)}"></div>
        <p><label><input type="checkbox" name="recursive"> ${escapeHTML(t("Recursive"))}</label></p>`,
      ok: {label: t("AddFolder"), callback: (_event, button) => ({
        name: button.form.elements.namedItem("name").value.trim() || name,
        recursive: button.form.elements.namedItem("recursive").checked
      })}
    });
  }

  async addSelection(set, event, kind, selection) {
    if (this.editorClosed || this.busy || !this.draft.sets.includes(set)) return;
    if (!game.user.isGM) throw new Error(t("AutoGMOnly"));
    this.capture();
    const pool = set[event];
    await this.runEdit(async () => {
      if (kind === "audio") {
        const path = validatePath(selection.path, true);
        if (pool.includes(path)) return;
        pool.push(path);
      } else {
        const options = await this.folderOptions(selection);
        if (!options || this.editorClosed) return;
        const folder = {type: "folder", path: selection.target || "/", source: selection.source,
          ...(selection.bucket ? {bucket: selection.bucket} : {}), ...options, excluded: []};
        if (pool.some(entry => entry.type === "folder" && entry.path === folder.path && entry.source === folder.source &&
          entry.bucket === folder.bucket && entry.recursive === folder.recursive)) return;
        folder.clips = await scanFolder(folder);
        if (this.editorClosed) return;
        pool.push(folder);
        this.openFolders.add(folder);
      }
      this.collapsedPools.delete(pool);
      await this.render({force: true});
    });
  }

  async perform(button) {
    if (this.busy || this.editorClosed || !this.element) return;
    if (!game.user.isGM) throw new Error(t("AutoGMOnly"));
    const {autoAction: action, path} = button.dataset;
    if (action === "cancel") return this.close();
    if (action === "play") return preview.toggle(path, this);
    if (action === "stop") return preview.stop(this);

    this.capture();
    const setIndex = Number(button.closest("[data-auto-set]")?.dataset.autoSet);
    const set = this.draft.sets[setIndex];
    const event = button.closest("[data-event]")?.dataset.event;
    const pool = SOUND_EVENTS.includes(event) ? set?.[event] : undefined;
    const entryIndex = Number(button.closest("[data-auto-entry]")?.dataset.autoEntry);
    const entry = pool?.[entryIndex];

    if (pool && ["add-file", "add-folder"].includes(action)) {
      const kind = action === "add-file" ? "audio" : "folder";
      selectAsset(kind, selection => this.addSelection(set, event, kind, selection).catch(report));
      return;
    }

    await this.runEdit(async () => {
      if (action === "save") {
        const data = {...this.draft, sets: validateSoundSets(this.draft.sets)};
        if (JSON.stringify(getAutomaticSounds()) !== JSON.stringify(this.original)) throw new Error(t("AutoConflict"));
        if (JSON.stringify(data) !== JSON.stringify(this.original)) await game.settings.set(MODULE_ID, AUTOMATIC_SOUND_KEY, data);
        ui.notifications.info(t("AutoSaved"));
        return this.close({force: true});
      }
      if (action === "add") this.draft.sets.push({name: "", attack: [], hurt: [], death: []});
      else if (action === "remove" && set) this.draft.sets.splice(setIndex, 1);
      else if (action === "remove-entry" && entry !== undefined) pool.splice(entryIndex, 1);
      else if (action === "remove-clip" && entry?.type === "folder") {
        entry.excluded = [...new Set([...entry.excluded, path])];
        entry.clips = entry.clips.filter(clip => clip.path !== path);
      } else if (action === "refresh-folder" && entry?.type === "folder") {
        const clips = await scanFolder(entry);
        if (this.editorClosed) return;
        const excluded = new Set(entry.excluded);
        entry.clips = clips.filter(clip => !excluded.has(clip.path));
        ui.notifications.info(t("Refreshed"));
      } else return;
      await this.render({force: true});
    });
    if (action === "add" && !this.editorClosed) this.element?.querySelector("[data-auto-set]:last-of-type [data-auto-name]")?.focus();
  }

  updatePreview() {
    for (const button of this.element?.querySelectorAll("[data-auto-action='play']") ?? []) {
      const playing = preview.owner === this && preview.path === button.dataset.path;
      button.classList.toggle("playing", playing);
      button.setAttribute("aria-pressed", String(playing));
      button.setAttribute("aria-label", t(playing ? "Stop" : "Play"));
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.editorClosed = false;
    this.events?.abort();
    this.events = new AbortController();
    this.unsubscribe ??= preview.subscribe(() => this.updatePreview());
    this.element.addEventListener("click", event => {
      const button = event.target.closest("[data-auto-action]");
      if (!button) return;
      event.preventDefault();
      this.perform(button).catch(report);
    }, {signal: this.events.signal});
    this.applyBusy();
    this.updatePreview();
  }

  async close(options) {
    if (this.busy && !options?.force) return this;
    this.editorClosed = true;
    this.events?.abort();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    preview.stop(this);
    return super.close(options);
  }
}

export function registerAutomaticSoundSettings() {
  game.settings.register(MODULE_ID, AUTOMATIC_SOUND_KEY, {
    scope: "world", config: false, type: Object, default: {schemaVersion: AUTOMATIC_SOUND_SCHEMA, enabled: true, sets: []}
  });
  game.settings.registerMenu(MODULE_ID, "automaticSoundMatchingMenu", {
    name: "DSA.AutoMenu", label: "DSA.AutoMenu", hint: "DSA.AutoMenuHint",
    icon: "fa-solid fa-volume-high", type: AutomaticSoundSettings, restricted: true
  });
}
