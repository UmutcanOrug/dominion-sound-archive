import { readFile, stat, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const json = file => readFile(path.join(root, file), "utf8").then(JSON.parse);
const manifest = await json("module.json");
assert.equal(manifest.id, "dominion-sound-archive");
assert.equal(manifest.compatibility.minimum, "13");
assert.equal(manifest.compatibility.maximum, "13");
assert.equal(manifest.download, `https://github.com/UmutcanOrug/${manifest.id}/releases/download/v${manifest.version}/${manifest.id}.zip`);
assert.equal(manifest.manifest, `https://github.com/UmutcanOrug/${manifest.id}/releases/latest/download/module.json`);
for (const file of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(l => l.path), manifest.license, "templates/archive.hbs", "README.md"]) {
  assert((await stat(path.join(root, file))).isFile(), file);
}
for (const file of await readdir(path.join(root, "scripts"))) {
  if (!file.endsWith(".js")) continue;
  const filename = path.join(root, "scripts", file);
  execFileSync(process.execPath, ["--check", filename]);
  const source = await readFile(filename, "utf8");
  for (const match of source.matchAll(/from\s+["'](\.\/.+?)["']/g)) assert((await stat(path.resolve(path.dirname(filename), match[1]))).isFile());
}
const en = (await json("lang/en.json")).DSA;
const tr = (await json("lang/tr.json")).DSA;
assert.deepEqual(Object.keys(en).sort(), Object.keys(tr).sort());
const hbs = await readFile(path.join(root, "templates/archive.hbs"), "utf8");
for (const [, key] of hbs.matchAll(/DSA\.(\w+)/g)) assert(key in en, `Missing translation ${key}`);
for (const file of await readdir(path.join(root, "scripts"))) {
  const source = await readFile(path.join(root, "scripts", file), "utf8");
  for (const [, key] of source.matchAll(/\b(?:t|fmt)\("(\w+)"/g)) assert(key in en, `Missing translation ${key}`);
}
console.log("Manifest, module paths, ES module syntax/imports and EN/TR translations validated.");
