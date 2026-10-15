# Changelog

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
