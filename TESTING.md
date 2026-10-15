# Validation and remaining in-game tests

## Completed locally

`node --test` exercises 31 automated tests with mocked Foundry documents, permissions, FilePicker and HTMLAudioElement:

- Actor, world Item and embedded Item independence; rename, serialized reload and flag duplication.
- Flat macro results, category/group/search filters, empty results and random metadata.
- Forge recursion uses one request; User Data recursion visits each folder once; file filtering and encoded names.
- Folder refresh adds/removes clips, preserves exclusions, and retains cached flags on an error or unavailable Forge source.
- Ownership, read permission, update permission, locked compendiums, schema guards and path validation.
- Same-client queued writes, category uniqueness, rename/removal and ordering.
- Native folder picker source/target handling and upload disabled.
- Local preview replacement, stop, and unsupported-playback errors.
- Repeated V1/V2 header-control hooks add one archive control and preserve existing controls.
- Six default Actor groups are seeded during creation and backfilled by the elected GM, including existing unlinked scene token Actors.
- Default initialization preserves existing data, avoids duplicate groups, respects permissions and recovers from write failures.

- Nine Item defaults cover world/embedded Items, initial inventories on new Actors, existing world/token inventories and newly created unlinked tokens.
- Item migration preserves legacy weapon.fire clips and custom keys, keeps Actor/Item defaults separate and returns distinct bolt-action/HMG/cannon pools through the API.

`node tools/validate.mjs` checks JSON, manifest links, referenced assets, relative ES imports, JavaScript syntax and English/Turkish key parity. The packaged ZIP is inspected for the root manifest and required files.

These are **not runtime Foundry/Forge tests**. No running Foundry V13 Build 351 world or actual SWADE sheet was available. The supplied attachment contained text only; the three referenced screenshots were not present. SWADE header behavior needs verification against the exact system version installed in your world.

## Manual acceptance tests (pending)

Use a test world on Foundry **13.351**, your installed SWADE version and The Forge. Record the SWADE version, browser and results.

1. **A — Actor:** open a soldier/squad Actor, click the single Sound Archive header control. Use the default `attack` group with key `voice.attack`, add a Forge audio file, save its label, close/reopen the archive and sheet, then reload Foundry. Confirm the group and file persist. Rename the Actor; confirm its archive persists.
2. **B — Item:** repeat with a world weapon and a weapon embedded in the Actor. Use key `weapon.fire`. Confirm all three libraries stay independent. Duplicate the Actor and world Item; confirm flags are copied.
3. **C — Folder:** link a Forge folder containing OGG/MP3/WAV/WEBM files plus a non-audio file. Confirm the count, expansion and individual URLs. Link a second folder to the same group. Check a path with spaces and Turkish characters. Confirm recursion is off by default, then attach a folder with recursion on and check nested clips.
4. **D — Refresh:** add a source file through Forge's Assets Library, remove a different source file there, then Refresh Folder. Confirm the list changes. Hide one cached clip and refresh; confirm it stays hidden. Test an inaccessible folder: confirm an error and retention of the previous cache.
5. **E — Playback:** preview clips with a second logged-in player present. Confirm only the initiating client hears sound, a new preview stops the old one (including from a different archive window), Stop works and closing the active window stops playback. Try a missing URL and an unsupported codec; confirm a meaningful error.
6. **F — Macro API:** run `examples/random-weapon-and-voice.js` as a Script macro with the squad token selected. Confirm the console shows playable weapon and Actor references. An empty voice group must return `null` without stopping weapon retrieval. Inspect `api.listClips(weapon)` for cached folder clips.
7. **G — Sheets:** open/close/rerender Actor, world Item and embedded Item sheets five times. Confirm exactly one header button, including for available legacy custom sheets. Verify SWADE and other modules' controls still work. Resize the archive and inspect scrolling, long paths, search and group/entry ordering.
8. **H — Permissions:** use a non-GM Observer: inspection and preview work, editing controls are absent and `refreshFolder` rejects. Use a Limited/no-access user: API reads reject. Test an owner with no file-browse permission and a locked compendium. Revoke ownership while an archive is open and check that the next write rejects.
9. **Install:** install using the public release manifest from a clean Forge test configuration. Confirm the module reports version 1.0.2 and assets load without 404 errors.

10. **I — Default Actor groups (pending):** update a 1.0.0 world to 1.0.1 and reload as a GM. Existing Actors must contain `attack`, `take cover`, `enter building`, `movement`, `wounded`, `retreat` (or their existing keyed equivalents), preserving all old sounds and custom groups. Check an Actor with an existing `voice.attack` group and one with an unkeyed `Attack` group: neither should gain a duplicate attack group. Create a new Actor, import one and duplicate one; check all six groups. Reload again with two GMs online and verify group counts and IDs remain stable. Check an unlinked token Actor on another scene. Confirm Actor defaults do not replace Item archive data. Test an Observer and a locked compendium without allowing unauthorized writes.

11. **J — Default Item weapon groups (pending):** update to 1.0.2 and reload as a GM. Check a world Item, an embedded squad Item and equipment on an unlinked tank token on another scene for `Bolt-Action`, `Semi-Auto`, `LMG`, `HMG`, `Sub-Machine`, `Pistol`, `Cannon`, `Reload`, `Explosion`. Existing sounds, IDs and custom groups, including legacy `weapon.fire`, must remain. Create/import/duplicate Items and import an Actor with initial equipment. Reload twice with two GMs connected: no duplicate groups or changed IDs. Add different audio to `weapon.bolt-action`, `weapon.hmg`, `weapon.cannon`, then use `getRandomClip` for each category on the correct embedded Item; the returned pools must stay separate. Confirm the Actor's six voice groups remain separate and ownership/locked-pack rules still apply.

If something fails, capture the browser console error, Foundry/SWADE versions and reproduction steps in a repository issue. No tests should be reported as passed in-game until these steps have actually been performed.


