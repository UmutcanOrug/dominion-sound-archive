Dominion Sound Archive 1.0.1 for Foundry VTT V13 (target build 351).

Actors now receive six default audio groups:
- attack (`voice.attack`)
- take cover (`voice.take-cover`)
- enter building (`voice.enter-building`)
- movement (`voice.movement`)
- wounded (`voice.wounded`)
- retreat (`voice.retreat`)

After updating, reload the world as a GM to initialize existing world Actors and unlinked scene token Actors. New, imported and duplicated Actors receive defaults during creation. Existing matching groups and all archived sounds are preserved; Item archives remain unchanged. Owners can also open an Actor's archive to fill missing defaults.

Install/update manifest:
https://github.com/UmutcanOrug/dominion-sound-archive/releases/latest/download/module.json

Assets:
- `module.json`: Foundry/Forge installation manifest.
- `dominion-sound-archive.zip`: installable module, with module.json at the ZIP root.
- `SHA256SUMS.txt`: release asset checksums.

Validation: 20 module tests using mocked Foundry/Forge/browser objects, plus manifest/import/syntax/localization/package checks. **Not tested inside a running Foundry 13.351/SWADE/Forge world.** See TESTING.md for the manual acceptance steps.
