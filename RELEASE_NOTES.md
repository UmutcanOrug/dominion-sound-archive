Dominion Sound Archive 1.0.3 for Foundry VTT V13 (target build 351).

The Actor default `movement` is replaced by two independent groups:
- move (`voice.move`)
- run (`voice.run`)

After updating, reload the world as a GM. Existing default movement files and linked folders migrate into move; run starts empty unless you already populated it. Existing move pools receive the legacy references without losing sounds. Existing world and unlinked scene token Actors are migrated, and new/imported/duplicated Actors receive the new defaults. Owners can also open their archive to initialize it. Item weapon groups remain unchanged.

Legacy Actor listClips/getRandomClip filters using voice.movement fall back to voice.move after migration. New macros and direct readers of raw library groups should use voice.move and voice.run. Custom category keys are preserved.

Install/update manifest:
https://github.com/UmutcanOrug/dominion-sound-archive/releases/latest/download/module.json

Assets:
- `module.json`: Foundry/Forge installation manifest.
- `dominion-sound-archive.zip`: installable module, with module.json at the ZIP root.
- `SHA256SUMS.txt`: release asset checksums.

Validation: 39 module tests using mocked Foundry/Forge/browser objects, plus manifest/import/syntax/localization/package checks. **Not tested inside a running Foundry 13.351/SWADE/Forge world.** See TESTING.md for the manual acceptance steps.
