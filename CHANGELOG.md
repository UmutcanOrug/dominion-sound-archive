# Changelog

## 1.0.2

- Item archives now start with `Bolt-Action`, `Semi-Auto`, `LMG`, `HMG`, `Sub-Machine`, `Pistol`, `Cannon`, `Reload` and `Explosion`, each with a separate `weapon.*` category key.
- New world/embedded Items initialize automatically. One elected GM backfills world Items and equipment on all world Actors and unlinked scene token Actors. Initial equipment on newly created/imported Actors and new unlinked tokens is also initialized.
- Existing groups, IDs, sound references and `weapon.fire` compatibility are preserved. Actor and Item defaults share an additive initialization service.
- Added eleven automated tests for Item creation, migrations, permissions, recovery and mixed squad/tank sound pools; all 31 module tests pass locally with mocks.

## 1.0.1

- Actors now start with `attack`, `take cover`, `enter building`, `movement`, `wounded` and `retreat` groups, each with a macro category key.
- New/imported/duplicated Actors receive defaults during creation. One elected GM backfills world Actors and existing unlinked scene token Actors when the world opens; owners can also initialize missing defaults by opening an archive.
- Existing matching groups and all archived sounds are preserved. Repeated initialization does not duplicate groups; Item libraries remain unchanged.
- Added nine automated tests for creation, migration, permissions, duplicate prevention and failure recovery.

## 1.0.0

- Independent, persistent Actor and Item audio archives with versioned document flags.
- Legacy and ApplicationV2 sheet header controls, including embedded Items.
- Custom groups and machine keys; file/folder selection, refresh, search and ordering.
- Forge Assets priority and single-request recursive folder scans with cached playable URLs.
- Local-only preview shared across archive windows; source assets remain untouched.
- Ownership checks, English/Turkish localization and a documented public macro API.
- Automated mocked service/adapter tests and an explicit manual Foundry acceptance checklist.
