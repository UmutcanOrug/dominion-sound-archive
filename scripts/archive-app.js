import * as library from "./library-service.js";
import { MODULE_ID, t, fmt, escapeHTML, pathName, report } from "./utils.js";
import { selectAsset } from "./forge-browser.js";
import { preview } from "./audio-preview.js";
import { ensureActorDefaults } from "./actor-defaults.js";
import { ensureItemDefaults } from "./item-defaults.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const windows = new Map();

async function editDialog(title, fields, extra = "") {
  const content = fields.map(field => `<div class="form-group"><label>${escapeHTML(t(field.title))}</label>
    <input type="text" name="${field.key}" value="${escapeHTML(field.value)}" ${field.required ? "required" : ""} maxlength="200"></div>`).join("");
  return DialogV2.prompt({window: {title}, content: content + extra, rejectClose: false,
    ok: {label: t("Save"), callback: (_event, button) => Object.fromEntries(new FormData(button.form))}});
}

export class ArchiveApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dominion-sound-archive-{id}", classes: ["dominion-sound-archive"],
    window: {icon: "fa-solid fa-headphones", resizable: true},
    position: {width: 800, height: 660}
  };
  static PARTS = {archive: {template: `modules/${MODULE_ID}/templates/archive.hbs`, scrollable: [".dsa-library"]}};

  constructor(document) {
    super();
    this.document = document;
    this.query = "";
    this.collapsedGroups = new Set();
    this.openFolders = new Set();
    this.unsubscribe = preview.subscribe(() => this.updatePreview());
  }
  get title() { return `${this.document.name} — ${t("Title")}`; }

  async _prepareContext() {
    const data = library.getLibrary(this.document);
    const editable = library.canEdit(this.document);
    const groups = data.groups.map(group => {
      const entries = group.entries.map(entry => ({...entry, isFolder: entry.type === "folder", editable,
        expanded: this.openFolders.has(entry.id),
        count: entry.type === "folder" ? entry.clips.length : 1,
        clips: (entry.clips ?? []).map(clip => ({...clip, folderId: entry.id, editable}))}));
      return {...group, entries, editable, expanded: !this.collapsedGroups.has(group.id),
        count: entries.reduce((sum, entry) => sum + entry.count, 0)};
    });
    return {groups, editable, documentName: this.document.name, query: this.query,
      groupCount: groups.length, clipCount: groups.reduce((sum, group) => sum + group.count, 0)};
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.events?.abort();
    this.events = new AbortController();
    const config = {signal: this.events.signal};
    this.element.addEventListener("click", event => {
      const target = event.target.closest("[data-dsa-action]");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      this.handleAction(target).catch(report);
    }, config);
    this.element.querySelector(".dsa-search").addEventListener("input", event => {
      this.query = event.target.value;
      this.filter();
    }, config);
    this.element.querySelectorAll("details").forEach(details => details.addEventListener("toggle", () => {
      if (details.dataset.group) {
        if (details.open) this.collapsedGroups.delete(details.dataset.group);
        else this.collapsedGroups.add(details.dataset.group);
      } else if (details.dataset.folder) {
        if (details.open) this.openFolders.add(details.dataset.folder);
        else this.openFolders.delete(details.dataset.folder);
      }
    }, config));
    this.element.addEventListener("dragstart", event => {
      const handle = event.target.closest("[data-dsa-drag]");
      if (!handle || !library.canEdit(this.document)) return;
      event.dataTransfer.setData("application/x-dominion-sound-archive", JSON.stringify({
        documentUuid: this.document.uuid, type: handle.dataset.dsaDrag,
        groupId: handle.closest("[data-group]")?.dataset.group,
        entryId: handle.closest("[data-entry]")?.dataset.entry
      }));
      event.dataTransfer.effectAllowed = "move";
    }, config);
    this.element.addEventListener("dragover", event => {
      if (event.dataTransfer.types.includes("application/x-dominion-sound-archive")) event.preventDefault();
    }, config);
    this.element.addEventListener("drop", event => {
      const raw = event.dataTransfer.getData("application/x-dominion-sound-archive");
      if (!raw) return;
      event.preventDefault();
      this.onDrop(raw, event.target).catch(report);
    }, config);
    this.filter();
    this.updatePreview();
  }

  filter() {
    if (!this.element) return;
    const query = this.query.trim().toLocaleLowerCase();
    let matches = 0;
    this.element.querySelectorAll(".dsa-group").forEach(group => {
      let visibleEntries = 0;
      group.querySelectorAll(".dsa-entry").forEach(entry => {
        const rows = entry.querySelectorAll(".dsa-clip");
        let visible = 0;
        rows.forEach(row => {
          const hit = !query || row.dataset.search.toLocaleLowerCase().includes(query);
          row.hidden = !hit;
          if (hit) { visible++; matches++; }
        });
        const folderMatch = Boolean(query && entry.dataset.search?.toLocaleLowerCase().includes(query));
        if (folderMatch) rows.forEach(row => { row.hidden = false; });
        entry.hidden = Boolean(query && !visible && !folderMatch);
        if (!entry.hidden) visibleEntries++;
        if (query && !entry.hidden && entry.tagName === "DETAILS") entry.open = true;
      });
      group.hidden = Boolean(query && !visibleEntries);
      if (query && !group.hidden) group.open = true;
    });
    this.element.querySelector(".dsa-no-results").hidden = !query || matches > 0 || Boolean(this.element.querySelector(".dsa-entry:not([hidden])"));
  }

  updatePreview() {
    this.element?.querySelectorAll("[data-dsa-action='play']").forEach(button => {
      const playing = preview.path === button.dataset.path && preview.owner === this;
      button.innerHTML = `<i class="fa-solid ${playing ? "fa-stop" : "fa-play"}"></i>`;
      button.title = t(playing ? "Stop" : "Play");
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(playing));
      button.classList.toggle("playing", playing);
    });
  }

  async onDrop(raw, target) {
    const value = JSON.parse(raw);
    if (value.documentUuid !== this.document.uuid) return;
    const group = target.closest("[data-group]");
    const entry = target.closest("[data-entry]");
    if (value.type === "group" && group) await library.reorder(this.document, {groupId: value.groupId, beforeId: group.dataset.group});
    else if (value.type === "entry" && entry && group?.dataset.group === value.groupId) {
      await library.reorder(this.document, {groupId: value.groupId, entryId: value.entryId, beforeId: entry.dataset.entry});
    }
    await this.render({force: true});
  }

  async handleAction(button) {
    const action = button.dataset.dsaAction;
    library.requireRead(this.document);
    if (action === "play") return preview.toggle(button.dataset.path, this);
    if (action === "stop") return preview.stop();
    if (this.busy) return;
    library.requireEdit(this.document);
    const groupId = button.closest("[data-group]")?.dataset.group;
    const entryId = button.closest("[data-entry]")?.dataset.entry;
    const data = library.getLibrary(this.document);
    const group = data.groups.find(g => g.id === groupId);
    const entry = group?.entries.find(e => e.id === entryId);
    this.busy = true;
    try {
      switch (action) {
        case "add-group":
        case "edit-group": {
          const values = await editDialog(t(action === "add-group" ? "AddGroup" : "EditGroup"), [
            {key: "name", title: "Name", value: group?.name ?? "", required: true},
            {key: "category", title: "Category", value: group?.category ?? ""}
          ], `<p class="hint">${escapeHTML(t("CategoryHint"))}</p>`);
          if (values) {
            if (action === "add-group") await library.addGroup(this.document, values);
            else await library.editGroup(this.document, groupId, values);
          }
          break;
        }
        case "remove-group":
          if (await DialogV2.confirm({window: {title: t("RemoveGroup")}, rejectClose: false,
            content: `<p>${escapeHTML(fmt("ConfirmGroup", {name: group.name}))}</p>`})) await library.removeGroup(this.document, groupId);
          break;
        case "add-file":
        case "add-folder":
          selectAsset(action === "add-file" ? "audio" : "folder", selection => {
            this.addSelection(groupId, action, selection).catch(report);
          });
          break;
        case "edit-entry": {
          const values = await editDialog(t("EditEntry"), [
            {key: "name", title: "Name", value: entry.name, required: true},
            {key: "label", title: "Label", value: entry.label ?? ""}
          ]);
          if (values) await library.editEntry(this.document, entryId, values);
          break;
        }
        case "refresh-folder":
          button.disabled = true;
          await library.refreshFolder(this.document, entryId);
          ui.notifications.info(t("Refreshed"));
          break;
        case "remove-entry":
          await library.removeEntry(this.document, entryId);
          break;
        case "remove-clip":
          await library.removeFolderClip(this.document, entryId, button.dataset.path);
          break;
        case "group-up": case "group-down":
          await library.reorder(this.document, {groupId, offset: action === "group-up" ? -1 : 1});
          break;
        case "entry-up": case "entry-down":
          await library.reorder(this.document, {groupId, entryId, offset: action === "entry-up" ? -1 : 1});
          break;
      }
    } finally {
      this.busy = false;
      if (this.rendered) await this.render({force: true});
    }
  }

  async addSelection(groupId, action, selection) {
    library.requireEdit(this.document);
    const isFolder = action === "add-folder";
    const values = await editDialog(t(isFolder ? "AddFolder" : "AddFile"), [
      {key: "name", title: "Name", value: pathName(selection.target || selection.path), required: true},
      ...(!isFolder ? [{key: "label", title: "Label", value: ""}] : [])
    ], isFolder ? `<label><input type="checkbox" name="recursive"> ${escapeHTML(t("Recursive"))}</label>
      <p class="hint">${escapeHTML(t("FolderHint"))}</p>` : "");
    if (!values) return;
    if (isFolder) {
      await library.addFolder(this.document, groupId, {...values, path: selection.target, source: selection.source,
        bucket: selection.bucket, recursive: values.recursive === "on"});
    } else await library.addFile(this.document, groupId, {...values, path: selection.path});
    if (this.rendered) await this.render({force: true});
  }

  async close(options) {
    this.events?.abort();
    this.unsubscribe();
    preview.stop(this);
    if (windows.get(this.document.uuid) === this) windows.delete(this.document.uuid);
    return super.close(options);
  }
}

export async function openArchive(document) {
  library.requireRead(document);
  await ensureActorDefaults(document);
  await ensureItemDefaults(document);
  let app = windows.get(document.uuid);
  if (!app) {
    app = new ArchiveApp(document);
    windows.set(document.uuid, app);
  }
  try {
    await app.render({force: true});
    app.bringToFront();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

export function updateArchives(document, deleted = false) {
  for (const app of windows.values()) {
    if (app.document.uuid !== document.uuid && app.document.parent?.uuid !== document.uuid) continue;
    if (app.document.uuid === document.uuid) app.document = document;
    if (deleted || !library.canRead(app.document)) app.close().catch(report);
    else app.render({force: true}).catch(report);
  }
}
