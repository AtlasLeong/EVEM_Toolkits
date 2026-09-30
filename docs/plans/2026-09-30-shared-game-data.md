# Shared game data implementation plan

**Goal:** Remove the Killboard target inspector and make the verified client catalog reusable by all site modules, with reproducible provenance and retained client revisions.

**Architecture:** A model-independent `GameData` package reads an immutable versioned catalog selected by a small current-version pointer. A validated offline importer publishes exact ID/name/image associations, merges retained historical records, and records the static-table, logical-icon, package, conversion and checksum chain. Killboard and Market consume the same catalog; bounded read-only HTTP lookup is available for Tactical and future modules. Character/corporation identities remain live report data.

**Tech stack:** Python standard library, Django/DRF read-only views, React/Vite existing frontend.

1. Add importer regression tests using temporary client exports: invalid PNG hashes refuse publication, two revisions retain removed records, changed records can still be read in the previous revision, and repeated imports are idempotent.
2. Add `scripts/sync_game_data.py` and `backend/GameData/registry.py`. Store source versions and deduplicated image/table evidence; publish assets before atomically switching `data/current.json`. Keep old immutable revisions and image files.
3. Add bounded item lookup/search/status under `/api/game-data/`. Return names, known catalog classification, image URL/role/warning and revision, without machine-local source paths.
4. Make Killboard catalog/image helpers compatibility adapters. Add shared image rendering/utilities and connect Market image payloads to them. Remove the inspector and its unused CSS; keep panel scrolling.
5. Import the verified local snapshot and check all images/checksums. Run focused backend/unit/API/import tests, frontend unit tests/build, and inspect local desktop/mobile layout.
6. Preserve the client extraction toolchain under `scripts/game_data/client_assets/`, with explicit input/output paths, pinned decoder evidence, THX-bound routing overrides, and an independent portable verifier. Eliminate hardcoded research/worktree dependencies from the supported update commands; do not publish raw client packages or credentials.

Update procedure and provenance fields are documented in `docs/game-data.md`. Generated raw-client exports remain outside the deployed web root. New ships arrive through subsequent verified catalog imports; old revisions remain available by revision ID. No periodic emulator extraction is introduced in this change.

## Local verification — 2026-09-30

All six tasks are implemented locally; no production deployment or Git push was performed in this change.

- Backend shared-data/Killboard regression: 71 tests passed; Market regression: 118 tests passed.
- Frontend unit regression: 380 tests passed; production build and bundle checks passed.
- Maintained extraction tooling: 16 tests passed; versioned importer: 12 tests passed. Independent review found no outstanding P1/P2 issue.
- Full source verification reopened 101 tables, checked 44,833 records and 2,702 PNG hashes, and independently decoded all 2,702 source textures to compare pixels; no errors. Repeated import preserved the same revision.
- Local API integration confirmed the Killboard and shared catalog return the identical exact hull name/image URL. Desktop/mobile layout checks confirmed the target inspector is absent and there is no horizontal overflow.

The local preview database contains explicitly labelled `local-preview` layout fixtures, not authenticated live KM reports. Those fixtures are not evidence of real participant, fitting or drop data, and are excluded from deployment.
