# Starsea Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Current session executes independent file-owned work with subagent-driven implementation and independent review.

**Goal:** Deliver locally usable, reviewed story/announcement publishing and fast two-sided battle reports.

**Architecture:** Separate Django Starsea app with immutable reviewed revisions and private media; React lazy routes and structured editor; pinned read-only local ship catalog; isolated loopback runtime.

**Tech Stack:** Django/DRF/SQLite/Pillow, React/Vite, Node test runner, Playwright.

## Safety / baseline

Continue existing `.worktrees/tactical-collaboration` because it contains the user's accepted but uncommitted corporation/tactical work. Preserve those changes. Do not commit unrelated work, push, deploy, import production settings, or use production databases. No new worktree from HEAD that would omit that work. Previous full audit baseline is recorded separately; rerun affected checks here. No commits in this local-only delivery.

## Task 1 — Backend publishing boundary (backend agent)

Files: create `backend/Starsea/{apps,models,validation,services,views,urls,media}.py`, migrations and `tests.py`; add app/URL to `backend/EVE_MDjango/{ci_settings,ci_urls,settings,urls}.py` only. Do not edit catalog or local runtime files owned by others.

1. Write API tests for blank draft, three kinds, auth/owner, submission requirements, revision conflict and reviewed publication. Run `../.venv/Scripts/python.exe manage.py test Starsea --settings=EVE_MDjango.ci_settings --noinput` and observe missing behavior.
2. Implement models/migration and transactional mutations according to the approved API contract. Lock Post before Revision consistently; preserve old published revision during editing.
3. Write failing media ownership, bounded decoding, visibility and request idempotency tests. Implement sanitized private media, upload quota reservations and protected read URLs.
4. Write aggregation/unknown ship/ISK null/location/corporation validation tests, implement server normalization through catalog interfaces.
5. Run Starsea and Community tests. Independently review spec first, then code quality. Do not commit.

## Task 2 — Frontend module (frontend agent)

Files: create `front-codex/src/pages/Starsea*.jsx`, `components/starsea/*`, `services/apiStarsea.js`, `utils/starsea.js`, `styles/starsea.css`; add lazy routes/AppShell navigation. Own `tests/unit/starsea.test.mjs` and `tests/e2e/specs/starsea.spec.js`. Do not edit Vite config/Login/local runtime.

1. Write/run failing Node tests for loss totals, null ISK, strict pasted rows and source/custom labels.
2. Implement utilities and API client per contract; publication feed/detail/mine/review, no unsafe HTML; stable cache keys and stale-response protection.
3. Write browser tests before editor implementation, then build two-side loss editor, searchable model selector, quick rows, bulk paste preview, gallery upload/retry and dirty navigation guard.
4. Style compact warm-white page, responsive card/list and stacked mobile editor, consistent input heights/focus and typography. No large hero or generated decorative images.
5. Run unit and browser regression on an unused port after coordination with root; independent spec/code reviews. Do not commit or build concurrently with root.

## Task 3 — Catalog adapter (catalog agent)

Files: create `backend/Starsea/catalog.py`, `backend/Starsea/tests_catalog.py`, optional `scripts/starsea/catalog_audit.py` + tests. Do not create/overwrite Starsea __init__, URLs or other agent files.

1. Inspect pinned local SQLite and manifests read-only. Derive real ship selection rules and localized names; no source file copied to served/Git directories.
2. Write failing tests for filtering actual ships, safe read-only path/version, bounded search, canonical known-ID lookup, missing catalog graceful error, real Board geography validation.
3. Implement functions `search_ships(q='',ship_class='',page=1)`, `resolve_ship(ship_id)`, `search_locations(kind,parent_id=None,q='')`, `resolve_location(ids)` and return shapes in design. Configuration `STARSEA_SHIP_DB` absolute path; pinned SHA/version validation cached by stat. Unknown/disconnected data does not silently fabricate real records.
4. Run tests plus real read-only audit and report source/version/coverage limitations. Root and backend agent review integration.

## Task 4 — Local runtime and integration (root)

Files: new `backend/EVE_MDjango/starsea_local_{settings,urls}.py`, local seed command under `Starsea/management`, `scripts/starsea/*`, new runtime safety tests; Vite starsea-local mode and package script; Login safe same-origin return path support if needed.

1. Write failing safety tests proving settings cannot import production/.env, only loopback addresses and separate SQLite; deterministic account setup refuses non-local settings and never resets existing data.
2. Implement isolated API port 8002 / UI 4195 after checking availability. New private files outside served/backend BASE_DIR; absolute pinned ship DB path only in local setup. Seed fictional posts clearly labelled with real ship/location metadata, no automatic production contact.
3. Run migrations explicitly under starsea_local_settings; start hidden local servers. Verify real login, draft/save/upload/submit/admin/public edit transitions using HTTP and browser.
4. Independently check specs, then code quality with agents; fix confirmed issues under TDD. Run combined backend and Node tests, Starsea browser tests and existing corp/tactical/navigation suites; build and diff check.
5. Save verification report with exact evidence, limitations and local credentials; show preview/screenshot if useful. Keep local servers running for user. No deployment.
