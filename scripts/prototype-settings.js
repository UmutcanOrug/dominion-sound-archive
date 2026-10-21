import { MODULE_ID, clone, t, fmt, report } from "./utils.js";
import { builtinPrototype, getPrototype, prototypeKey } from "./prototype-data.js";
import { savePrototype, synchronizePrototypes } from "./prototype-sync.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PrototypeSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dominion-sound-archive", "dsa-prototype"],
    window: {icon: "fa-solid fa-layer-group", resizable: true},
    position: {width: 760, height: 650}
  };
  static PARTS = {prototype: {template: `modules/${MODULE_ID}/templates/prototype.hbs`, scrollable: [".dsa-prototype-rows"]}};

  constructor(options = {}) {
    super(options);
    this.kind = this.constructor.kind;
    this.original = getPrototype(this.kind);
    this.rows = clone(this.original.groups);
    this.busy = false;
  }
  get title() { return t(this.kind === "voice" ? "PrototypeVoice" : "PrototypeWeapon"); }
  async _prepareContext() {
    if (!game.user.isGM) throw new Error(t("PrototypeGMOnly"));
    return {rows: this.rows, title: this.title, prefix: `${this.kind}.`, busy: this.busy};
  }
  captureRows() {
    if (!this.element) return;
    this.rows = Array.from(this.element.querySelectorAll(".dsa-prototype-row"), row => ({
      name: row.querySelector("[data-field='name']").value,
      category: row.querySelector("[data-field='category']").value
    }));
  }
  async perform(action, index) {
    if (this.busy) return;
    if (!game.user.isGM) throw new Error(t("PrototypeGMOnly"));
    if (action === "cancel") return this.close();
    this.captureRows();
    if (action === "add") this.rows.push({name: "", category: `${this.kind}.`});
    else if (action === "remove") {
      if (!Number.isInteger(index) || index < 0 || index >= this.rows.length) return;
      this.rows.splice(index, 1);
    } else if (action === "save") {
      this.busy = true;
      this.element?.querySelectorAll("button, input").forEach(control => { control.disabled = true; });
      try {
        ui.notifications.info(t("PrototypeSaving"));
        const result = await savePrototype(this.kind, {schemaVersion: 1, groups: this.rows}, this.original);
        this.original = getPrototype(this.kind);
        this.rows = clone(this.original.groups);
        ui.notifications[result.failed ? "warn" : "info"](result.failed
          ? fmt("PrototypePartial", result) : result.delegated ? t("PrototypeDelegated") : fmt("PrototypeSaved", result));
        this.busy = false;
        return await this.close();
      } finally {
        this.busy = false;
        this.element?.querySelectorAll("button, input").forEach(control => { control.disabled = false; });
      }
    } else return;
    this.busy = true;
    this.element?.querySelectorAll("button, input").forEach(control => { control.disabled = true; });
    try { await this.render({force: true}); }
    finally {
      this.busy = false;
      this.element?.querySelectorAll("button, input").forEach(control => { control.disabled = false; });
    }
    if (action === "add") this.element?.querySelector(".dsa-prototype-row:last-child input")?.focus();
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.events?.abort(); this.events = new AbortController();
    this.element.addEventListener("click", event => {
      const button = event.target.closest("[data-prototype-action]");
      if (!button) return;
      event.preventDefault();
      this.perform(button.dataset.prototypeAction, Number(button.dataset.index)).catch(report);
    }, {signal: this.events.signal});
  }
  async close(options) {
    if (this.busy && !options?.force) return this;
    this.events?.abort();
    return super.close(options);
  }
}

export class PrototypeVoiceSettings extends PrototypeSettings { static kind = "voice"; }
export class PrototypeWeaponSettings extends PrototypeSettings { static kind = "weapon"; }

export function registerPrototypeSettings() {
  for (const [kind, type] of [["voice", PrototypeVoiceSettings], ["weapon", PrototypeWeaponSettings]]) {
    const key = prototypeKey(kind), name = kind === "voice" ? "DSA.PrototypeVoice" : "DSA.PrototypeWeapon";
    game.settings.register(MODULE_ID, key, {scope: "world", config: false, type: Object, default: builtinPrototype(kind),
      onChange: () => {
        if (game.ready) return synchronizePrototypes().catch(report);
      }});
    game.settings.registerMenu(MODULE_ID, `${key}Menu`, {name, label: name, hint: "DSA.PrototypeMenuHint",
      icon: "fa-solid fa-layer-group", type, restricted: true});
  }
}
