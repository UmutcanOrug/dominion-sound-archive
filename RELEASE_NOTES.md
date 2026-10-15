First release of Dominion Sound Archive for Foundry VTT V13 (target build 351).

Create persistent audio groups for Actors, world Items and embedded weapon Items. Link files and entire Forge Assets folders, refresh cached contents, preview audio locally and retrieve random clips through the public API. Includes English and Turkish translations, documentation and an example macro.

Install manifest:
https://github.com/UmutcanOrug/dominion-sound-archive/releases/latest/download/module.json

Assets:
- `module.json`: Foundry/Forge installation manifest.
- `dominion-sound-archive.zip`: installable module, with module.json at the ZIP root.
- `SHA256SUMS.txt`: release asset checksums.

Validation: 11 automated tests using mocked Foundry/Forge/browser objects, plus manifest/import/syntax/localization/package checks. **Not tested inside a running Foundry 13.351/SWADE/Forge world.** See TESTING.md for the manual acceptance steps.
