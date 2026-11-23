import { MODULE_ID, t, report, validatePath } from "./utils.js";
import { selectAsset } from "./forge-browser.js";
import { preview } from "./audio-preview.js";
import { AUTOMATIC_SOUND_KEY, SOUND_EVENTS, getAutomaticSounds, validateSoundSets } from "./automatic-sound-data.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const eventLabels = {attack: "AutoAttack", hurt: "AutoHurt", death: "AutoDeath"};

export class AutomaticSoundSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dsa-automatic-sound-matching",
    classes: ["dominion-sound-archive", "dsa-automatic"],
    window: {icon: "fa-solid fa-volume-high", resizable: true},
    position: {width: 760, height: 620}
  };
  static PARTS = {settings: {template: `modules/${MODULE_ID}/templates/automatic-sounds.hbs`, scrollable: [".dsa-library"]}};

  constructor(options = {}) {
    super(options);
    this.original = getAutomaticSounds();
    this.draft = structuredClone(this.original);
    this.busy = false;
  }

  get title() { return t("AutoMenu"); }

  async _prepareContext() {
    if (!game.user.isGM) throw new Error(t("AutoGMOnly"));
    const sets = this.draft.sets.map(set => ({
      name: set.name,
      pools: SOUND_EVENTS.map(event => ({event, label: t(eventLabels[event]), paths: set[event].join("\n")}))
    }));
    return {sets, enabled: this.draft.enabled, busy: this.busy};
  }

  capture() {
    this.draft.enabled = this.element.querySelector("[data-auto-enabled]").checked;
    for (const [index, fieldset] of Array.from(this.element.querySelectorAll("[data-auto-set]")).entries()) {
      const set = this.draft.sets[index];
      set.name = fieldset.querySelector("[data-auto-name]").value;
      for (const event of SOUND_EVENTS) {
        set[event] = fieldset.querySelector(`textarea[data-event="${event}"]`).value.split(/\r?\n/).map(path => path.trim()).filter(Boolean);
      }
    }
  }

  async perform(button) {
    if (this.busy || !this.element) return;
    if (!game.user.isGM) throw new Error(t("AutoGMOnly"));
    const action = button.dataset.autoAction;
    if (action === "cancel") return this.close();
    this.capture();
    const index = Number(button.closest("[data-auto-set]")?.dataset.autoSet);
    const set = this.draft.sets[index];
    const event = button.dataset.event;
    if (action === "browse" && set && SOUND_EVENTS.includes(event)) {
      const field = button.closest(".dsa-auto-pool").querySelector("textarea");
      selectAsset("audio", ({path}) => {
        if (!field.isConnected || this.busy) return;
        try {
          const selected = validatePath(path, true);
          const paths = field.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
          if (!paths.includes(selected)) field.value = [...paths, selected].join("\n");
        } catch (error) { report(error); }
      });
      return;
    }
    if (action === "preview" && set && SOUND_EVENTS.includes(event)) {
      const pool = set[event];
      if (pool.length) await preview.toggle(pool[Math.floor(Math.random() * pool.length)], this);
      return;
    }
    if (action === "stop") return preview.stop(this);
    this.busy = true;
    this.element.querySelectorAll("input, textarea, button").forEach(control => { control.disabled = true; });
    try {
      if (action === "save") {
        const data = {...this.draft, sets: validateSoundSets(this.draft.sets)};
        if (JSON.stringify(getAutomaticSounds()) !== JSON.stringify(this.original)) throw new Error(t("AutoConflict"));
        if (JSON.stringify(data) !== JSON.stringify(this.original)) await game.settings.set(MODULE_ID, AUTOMATIC_SOUND_KEY, data);
        ui.notifications.info(t("AutoSaved"));
        this.busy = false;
        return await this.close();
      }
      if (action === "add") this.draft.sets.push({name: "", attack: [], hurt: [], death: []});
      else if (action === "remove" && set) this.draft.sets.splice(index, 1);
      else return;
      await this.render({force: true});
    } finally {
      this.busy = false;
      this.element?.querySelectorAll("input, textarea, button").forEach(control => { control.disabled = false; });
    }
    if (action === "add") this.element?.querySelector("[data-auto-set]:last-of-type [data-auto-name]")?.focus();
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.events?.abort();
    this.events = new AbortController();
    this.element.addEventListener("click", event => {
      const button = event.target.closest("[data-auto-action]");
      if (!button) return;
      event.preventDefault();
      this.perform(button).catch(report);
    }, {signal: this.events.signal});
  }

  async close(options) {
    if (this.busy && !options?.force) return this;
    this.events?.abort();
    preview.stop(this);
    return super.close(options);
  }
}

export function registerAutomaticSoundSettings() {
  game.settings.register(MODULE_ID, AUTOMATIC_SOUND_KEY, {
    scope: "world", config: false, type: Object, default: {schemaVersion: 1, enabled: true, sets: []}
  });
  game.settings.registerMenu(MODULE_ID, "automaticSoundMatchingMenu", {
    name: "DSA.AutoMenu", label: "DSA.AutoMenu", hint: "DSA.AutoMenuHint",
    icon: "fa-solid fa-volume-high", type: AutomaticSoundSettings, restricted: true
  });
}
