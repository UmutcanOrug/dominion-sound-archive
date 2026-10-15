# Dominion Sound Archive

Persistent audio libraries for individual Foundry VTT **Actors and Items**, including Items embedded inside Actors and synthetic token Actors. Built for **Foundry V13 (target build 351)** and SWADE, with The Forge Assets Library as the preferred file source. No combat modules or API keys are required.

**Testing status:** automated service and adapter tests pass against mocks. The module has **not** been tested inside a running Foundry V13.351/SWADE/Forge world. `compatibility.verified` declares the intended core target, not a claim of completed in-game testing. Follow [TESTING.md](TESTING.md) before relying on it in a campaign.

## Install on The Forge

1. Open [The Forge Bazaar](https://forge-vtt.com/bazaar) and click **Install From Manifest** (or Foundry Setup → Add-on Modules → Install Module, if available for your hosting configuration).
2. Paste this **manifest URL**, then install:

   ```text
   https://github.com/UmutcanOrug/dominion-sound-archive/releases/latest/download/module.json
   ```

3. Launch your world. In **Game Settings → Manage Modules**, enable **Dominion Sound Archive** and save.
4. Open an Actor or Item sheet and click **Sound Archive** in its window header. The same button works for an inventory Item opened from its Actor sheet.

The [release](https://github.com/UmutcanOrug/dominion-sound-archive/releases/latest) includes `module.json` and `dominion-sound-archive.zip`. The manifest's `manifest` URL points to the latest release asset; its `download` URL points to the versioned ZIP. You do not need to download and re-upload audio files.

For local Foundry installation, extract the ZIP into `Data/modules/dominion-sound-archive/`. The ZIP has `module.json` at its root. Do not use GitHub's automatically generated **Source code (zip)** as the installation manifest or package.

## Use the archive

Starting with **1.0.1**, Actors receive six default groups:

| Group | Macro category key |
| --- | --- |
| `attack` | `voice.attack` |
| `take cover` | `voice.take-cover` |
| `enter building` | `voice.enter-building` |
| `movement` | `voice.movement` |
| `wounded` | `voice.wounded` |
| `retreat` | `voice.retreat` |

After updating, reload the world as a GM. One active GM automatically adds missing groups to every world Actor and existing unlinked scene token Actor. Newly created, imported and duplicated Actors receive them during creation. Items retain their own custom groups.

Existing groups, IDs, labels, cached folders and sound references are preserved. A matching category key, or a matching name ignoring case/extra spaces, is reused. Matching groups without a category receive the key above; existing custom keys are preserved. Owner-opened archives also fill missing defaults. Default groups remain editable; if removed, missing defaults return the next time an owner opens the archive or a GM reloads the world. Unopened compendium packs are not scanned or unlocked; imported Actors receive defaults normally.

- **Add Group:** enter a display name and, optionally, a unique machine key such as `weapon.fire`, `weapon.reload`, `voice.attack`, or `voice.reload`.
- **Add Audio File:** opens the host's native audio FilePicker. Select an existing file in **The Forge Assets**. Choose its display name and optional label, then save.
- **Add Folder:** opens the native folder FilePicker. Navigate into the directory and select it. Name it and optionally enable **Include subfolders**. Recursion is off by default.
- Expand a folder to see and preview each clip. Counts show the number of cached, visible audio files. Multiple folders and individual clips can share a group.
- **Refresh Folder:** replaces the cached list with the current directory contents. Failed scans preserve the previous cache. No background scans occur when reopening a sheet.
- Use the pencil to rename a group, entry or custom label. Use arrows or drag handles to reorder groups or entries within their current group.
- **Play** previews locally; clicking again stops it. Starting another preview stops the previous one across all archive windows. Closing the preview's window also stops it.
- Search matches clip names, labels and paths, and folder names. Changes save automatically to the associated document.
- Removing an entry removes its reference only. Hiding a folder clip records an exclusion that survives refreshes. To restore excluded clips, remove and reattach that folder. Removing a group requires confirmation.

The module never uploads, moves or deletes assets. The original files remain in the Assets Library. All clip references are independent per document, so an Actor and its embedded weapon may organize the same file differently. Normal Foundry duplication/export retains flags.

English labels are the default. Turkish translations are included and follow Foundry's language setting.

## Permissions and limitations

**Observer** or higher is required to inspect and preview an archive. Editing also requires document ownership, Foundry's `canUserModify(user, "update")`, and an unlocked compendium. Asset browsing permissions remain governed by Foundry and Forge. Owners without FilePicker access cannot add or refresh folders until granted the appropriate native permission.

Supported filename extensions: OGG/OGA, MP3, WAV, WEBM, M4A, AAC, FLAC and OPUS. A matching extension does not guarantee that a browser supports the file's codec. Missing, inaccessible or unsupported assets produce an error on playback.

Folder scans are limited to 5,000 audio references per folder and 100 directories per recursive User Data scan. Forge recursion uses one `browse` request; User Data scans are sequential with a visited-directory guard. Link narrower folders for large archives. Cached flags are part of each document and count toward its storage size.

Writes within one client are queued and re-read current flags. Simultaneous edits by different users follow Foundry's normal last-write-wins behavior; coordinate editing of the same archive. Future schema versions are rejected without overwriting data. No earlier schema needs migration in this first release.

No attack detection, automatic playback, recording, broadcasting or spatial sound is included.

## Public macro API

Available after Foundry's `ready` hook:

```js
const api = game.modules.get("dominion-sound-archive").api;
```

All document arguments must be saved **Actor or Item instances**, not IDs or names. Embedded Items are fully supported: use `actor.items.get(itemId)` or `actor.items.find(...)`. Their own flags are read and updated through Foundry's embedded-document methods. For a synthetic token Actor, pass `token.actor` and that Actor's Items.

| Method | Result |
| --- | --- |
| `await api.openArchive(document)` | Opens/reuses the document's archive window; resolves to its application. |
| `api.getLibrary(document)` | Independent copy of `{schemaVersion: 1, groups: [...]}`. Does not modify flags. |
| `api.listClips(document, options = {})` | Flat array of individual playable clip references, including cached folder clips. |
| `api.getRandomClip(document, options = {})` | Uniformly selected clip reference or `null` for an empty result. Does not play it. |
| `await api.refreshFolder(document, entryId)` | Rescans a folder and saves its refreshed cache; returns the updated folder entry. Requires ownership. |

`listClips` and `getRandomClip` accept `{groupId, category, search}`. Filters combine; `groupId` is the stable generated group ID, while `category` is the optional user-defined machine key. A missing category returns `[]`/`null`. `search` is case-insensitive.

Clip metadata:

```js
{
  documentUuid: "Actor.ACTOR_ID.Item.ITEM_ID",
  groupId: "stable-group-id",
  groupName: "Weapon Fire",
  category: "weapon.fire",
  entryId: "stable-file-or-folder-id",
  folderId: null, // folder entry ID for a clip resolved from a folder
  name: "Fire_01.ogg",
  path: "https://assets.forge-vtt.com/USER_ID/weapons/Fire_01.ogg",
  label: ""
}
```

Example (also provided as [an importable Script macro](examples/random-weapon-and-voice.js)):

```js
const api = game.modules.get("dominion-sound-archive").api;
const soldier = canvas.tokens.controlled[0]?.actor;
const weapon = soldier?.items.find(i => i.name === "Valterion Mk.2");
if (soldier && weapon) {
  const fire = api.getRandomClip(weapon, {category: "weapon.fire"});
  const voice = api.getRandomClip(soldier, {category: "voice.attack"});
  console.log({fire, voice}); // either may be null; no audio is played
}
```

Methods throw descriptive errors for invalid documents, insufficient permissions, unavailable sources and unsupported schemas. Catch errors in macros. Audio references are cached; the API does not verify asset existence on every read.

## Development and releases

No build step or runtime npm dependencies are needed. Use Node 22+:

```sh
node --test
node tools/validate.mjs
```

For a new release, update `version`, the versioned `download` URL, package version, release notes and changelog together. Run the tests and validator, then package the module with `module.json` at the ZIP root and upload both files to a new versioned GitHub release.

Architecture: `sheet-integration.js` handles V1/V2 hooks and a header-only fallback; `archive-app.js` owns the V2 application; `library-service.js` enforces permissions and persists flags; `forge-browser.js` resolves the configured V13 picker implementation and scans files; `audio-preview.js` manages one local HTML audio element; `api.js` exposes the read/refresh interface.

## API references used

- [Foundry V13 header control entries](https://foundryvtt.com/api/v13/interfaces/foundry.applications.types.ApplicationHeaderControlsEntry.html)
- [Foundry V13 FilePicker and its configured implementation](https://foundryvtt.com/api/v13/classes/foundry.applications.apps.FilePicker.html)
- [Foundry V13 ApplicationV2](https://foundryvtt.com/api/v13/classes/foundry.applications.api.ApplicationV2.html)
- [The Forge: FilePicker Assets Library integration and recursive browsing](https://forums.forge-vtt.com/t/using-the-filepicker-to-interact-with-the-assets-library/98008)

This module contains no Foundry or SWADE proprietary assets and is not an official Pinnacle or Foundry product.

