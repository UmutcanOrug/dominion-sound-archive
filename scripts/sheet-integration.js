import { canRead } from "./library-service.js";
import { t, report } from "./utils.js";

const ACTION = "dsaOpenArchive";

export function sheetDocument(app) {
  const document = app.document ?? app.object;
  if (!["Actor", "Item"].includes(document?.documentName)) return null;
  const classes = globalThis.foundry?.applications?.sheets;
  const isV2Sheet = [classes?.ActorSheetV2, classes?.ItemSheetV2].some(cls => cls && app instanceof cls);
  const isV1Sheet = [globalThis.ActorSheet, globalThis.ItemSheet].some(cls => cls && app instanceof cls);
  return isV2Sheet || isV1Sheet || document.sheet === app ? document : null;
}

export function registerSheetIntegration(openArchive) {
  const open = document => { Promise.resolve(openArchive(document)).catch(report); };
  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const document = sheetDocument(app);
    if (!document || !canRead(document) || controls.some(c => c.action === ACTION)) return;
    controls.push({action: ACTION, icon: "fa-solid fa-headphones", label: "DSA.Title",
      ownership: "OBSERVER", onClick: () => open(document)});
  });
  for (const hook of ["getActorSheetHeaderButtons", "getItemSheetHeaderButtons"]) {
    Hooks.on(hook, (app, buttons) => {
      const document = sheetDocument(app);
      if (!document || !canRead(document) || buttons.some(b => b.class === "dsa-open-archive")) return;
      buttons.unshift({label: t("Title"), class: "dsa-open-archive", icon: "fa-solid fa-headphones", onclick: () => open(document)});
    });
  }
  // V2's normal controls live in a dropdown. Expose our single control directly in
  // the window header, as requested, without changing system templates or classes.
  // Also acts as a fallback for custom sheets that omit the standard button hooks.
  const render = (app, html) => {
    const document = sheetDocument(app);
    if (!document) return;
    const root = app.element?.[0] ?? app.element ?? html?.[0] ?? html;
    const header = app.window?.header ?? root?.querySelector?.(":scope > .window-header");
    if (!header) return;
    if (!canRead(document)) {
      header.querySelector(".dsa-open-archive")?.remove();
      return;
    }
    const menuControl = header.querySelector(`[data-action='${ACTION}']`);
    if (header.querySelector(".dsa-open-archive")) {
      if (menuControl) (menuControl.closest("li") ?? menuControl).remove();
      return;
    }
    const button = globalThis.document.createElement("button");
    button.type = "button";
    button.className = "header-control dsa-open-archive";
    button.title = button.ariaLabel = t("Title");
    const icon = globalThis.document.createElement("i");
    icon.className = "fa-solid fa-headphones";
    button.append(icon, globalThis.document.createTextNode(` ${t("Title")}`));
    button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); open(document); });
    const anchor = header.querySelector("[data-action='toggleControls'], [data-action='close'], .close");
    header.insertBefore(button, anchor);
    // Remove our dropdown copy after creating the visible control.
    if (menuControl) (menuControl.closest("li") ?? menuControl).remove();
  };
  Hooks.on("renderApplicationV2", render);
  Hooks.on("renderActorSheet", render);
  Hooks.on("renderItemSheet", render);
}
