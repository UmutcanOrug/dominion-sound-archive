Dominion Sound Archive 1.0.2 for Foundry VTT V13 (target build 351).

Items now receive nine default weapon audio groups:
- Bolt-Action (`weapon.bolt-action`)
- Semi-Auto (`weapon.semi-auto`)
- LMG (`weapon.lmg`)
- HMG (`weapon.hmg`)
- Sub-Machine (`weapon.sub-machine`)
- Pistol (`weapon.pistol`)
- Cannon (`weapon.cannon`)
- Reload (`weapon.reload`)
- Explosion (`weapon.explosion`)

After updating, reload the world as a GM to initialize world Items and equipment on existing world Actors and unlinked scene token Actors. Newly created/imported/duplicated Items initialize automatically, including initial equipment on newly created/imported Actors. Existing matching groups, legacy `weapon.fire` pools and all archived sounds are preserved. Actor voice groups remain separate.

The separate category keys support future mixed squad macros (for example four bolt-action and two HMG shots) and tank macros using HMG and cannon pools on the same Item. Macros choose the category and equipment counts.

Install/update manifest:
https://github.com/UmutcanOrug/dominion-sound-archive/releases/latest/download/module.json

Assets:
- `module.json`: Foundry/Forge installation manifest.
- `dominion-sound-archive.zip`: installable module, with module.json at the ZIP root.
- `SHA256SUMS.txt`: release asset checksums.

Validation: 31 module tests using mocked Foundry/Forge/browser objects, plus manifest/import/syntax/localization/package checks. **Not tested inside a running Foundry 13.351/SWADE/Forge world.** See TESTING.md for the manual acceptance steps.
