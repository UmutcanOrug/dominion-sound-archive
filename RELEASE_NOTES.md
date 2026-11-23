Dominion Sound Archive 1.0.5 for Foundry VTT v13 and SWADE adds Automatic Sound Matching.

In Configure Settings → Dominion Sound Archive → Automatic Sound Matching, create a set with the character's name and assign one or more clips for Attack, Hurt and Death. Save to apply it. A whole-name Actor match takes priority over the token name. Use the file picker or enter one path per line.

Attack plays on public native SWADE weapon rolls, Hurt when Wounds increase, and Death when the token becomes Dead or is marked Defeated. Sounds play on the current scene using Foundry's audio channel. Existing macros can continue using their own Sound Archive pools.

The Forge manifest and the installable ZIP are attached. Local checks cover 72 automated tests. Live Foundry/Forge playback validation is pending.

## From 1.0.4

GM: Configure Settings → Dominion Sound Archive → Prototype voice / Prototype weapon.

Manage group names and voice.* / weapon.* category keys, starting from the existing seven voice and nine weapon defaults. Add any number of rows and Save to apply missing groups to world sheets, embedded equipment and unlinked scene token sheets. New/imported/duplicated documents use the current prototype. No Forge refresh is normally required; a GM world reload retries incomplete application.

An existing category key or matching name is reused without duplicates. Existing IDs, local names/custom keys, audio files, linked folders, caches, labels and exclusions are preserved. Editing/removing a prototype never deletes or renames groups already on a sheet. Only names/keys are shared, not sounds/folders. Compendiums are not mass-scanned; imported documents receive defaults.

Validation: 61 automated module tests, browser checks with the real editor/template in a mocked Foundry shell, manifest/import/syntax/localization and ZIP checks. Not tested in a running Foundry 13.351/SWADE/Forge world.

Install/update manifest:
https://github.com/UmutcanOrug/dominion-sound-archive/releases/latest/download/module.json

Assets: module.json, dominion-sound-archive.zip (manifest at ZIP root), SHA256SUMS.txt.
