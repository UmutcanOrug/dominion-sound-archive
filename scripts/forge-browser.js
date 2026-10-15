import { isAudioPath, pathName, t, validatePath } from "./utils.js";

export const onForge = () => Boolean(globalThis.ForgeVTT?.usingTheForge);

export function pickerClass() {
  // implementation is the V13 extension point used by host providers.
  const core = globalThis.foundry?.applications?.apps?.FilePicker;
  return core?.implementation ?? globalThis.FilePicker?.implementation ?? globalThis.FilePicker ?? core;
}

export function preferredSource() { return onForge() ? "forgevtt" : "data"; }

export function selectAsset(type, callback) {
  const Picker = pickerClass();
  if (!Picker) throw new Error(t("PickerUnavailable"));
  const picker = new Picker({
    type, activeSource: preferredSource(), allowUpload: false,
    callback: path => {
      // Keep source and target separately: Forge folder selection may return a CDN URL,
      // while browse expects the source-relative directory from the picker's source.
      const source = picker.activeSource;
      const target = picker.sources?.[source]?.target;
      callback({path, source, bucket: picker.sources?.[source]?.bucket,
        target: type === "folder" ? (target ?? path) : path});
    }
  });
  Promise.resolve(picker.render(true)).catch(error => {
    console.error("dominion-sound-archive | FilePicker", error);
    ui.notifications.error(t("PickerUnavailable"));
  });
  return picker;
}

const MAX_FILES = 5000;
const MAX_DIRECTORIES = 100;

export async function scanFolder({source, path, recursive = false, bucket}) {
  const Picker = pickerClass();
  if (!Picker) throw new Error(t("PickerUnavailable"));
  if (source === "forgevtt" && !onForge()) throw new Error(t("ForgeUnavailable"));
  validatePath(path || "/");
  if (!["forgevtt", "data", "public", "s3"].includes(source)) throw new Error(t("SourceUnavailable"));
  const options = bucket ? {bucket} : {};
  let files;
  try {
    if (source === "forgevtt") {
      // Forge returns flat CDN file URLs in one request, even for recursive scans.
      const result = await Picker.browse(source, path || "/", {...options, recursive: Boolean(recursive)});
      if (!Array.isArray(result?.files)) throw new Error(t("FolderUnavailable"));
      files = result.files;
    } else {
      const queue = [path || "/"];
      const seen = new Set();
      files = [];
      while (queue.length) {
        const directory = queue.shift();
        if (seen.has(directory)) continue;
        if (seen.size >= MAX_DIRECTORIES) throw new Error(t("ScanLimit"));
        seen.add(directory);
        const result = await Picker.browse(source, directory, options);
        if (!Array.isArray(result?.files)) throw new Error(t("FolderUnavailable"));
        files.push(...result.files);
        if (files.length > MAX_FILES) throw new Error(t("ScanLimit"));
        if (recursive) queue.push(...(result.dirs ?? []));
      }
    }
    const paths = [...new Set(files.filter(isAudioPath).map(p => validatePath(p, true)))].sort((a, b) => a.localeCompare(b));
    if (paths.length > MAX_FILES) throw new Error(t("ScanLimit"));
    return paths.map(path => ({path, name: pathName(path)}));
  } catch (cause) {
    throw new Error(`${t("FolderUnavailable")} ${cause.message}`, {cause});
  }
}
