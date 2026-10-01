# Private Killboard release implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Release the approved owner-only, high-value Killboard using three captured sessions, bounded five-minute collection, real names/images and explicit failure states.

**Architecture:** Reuse the existing Django report/parser/discovery domain and React intelligence desk. One private session is selected per pass; every game RPC is paced, and the verified `UserError/RequestTooOften` response stops the entire pass and establishes a shared cooldown. Bootstrap returns a latest-ID candidate under an explicit contiguous-ID assumption, not verified global coverage. Credentials, raw captures and exported sessions stay outside Git and release artifacts.

**Tech Stack:** Django/DRF, MySQL production, captured TCP/MessagePack protocol, systemd, React/Vite, shared GameData registry.

## Approved design and evidence

- The owner approved session reuse (not automatic password login), private access for `2235102484@qq.com`, all ship types with loss strictly above 20,000,000,000 ISK, sci-fi black UI, security labels/colors and five-minute triggers.
- The three-account capture has 5,523 complete records. Three different character selections completed auth4 and returned the real report `19748417`; all three outbound bundles validate structurally.
- A preceding capture independently confirmed the exact error envelope Ext10 -> Ext16 -> `["UserError", "RequestTooOften", null]`. It is not an empty report and must not advance the cursor.
- SDK/account-service traffic is TLS encrypted. Password login and automatic token refresh are not implemented or claimed.
- Missing character IDs do not establish NPC status. Preserve source data; never label the total source damage rows as a count of players.

## Task 1: Transport/session readiness (TDD)

**Files:** `backend/Killboard/collector_transport.py`, `session_bundle.py`, optional identity decoder; `scripts/killboard/extract_session_bundle.py`; their focused tests.

1. Add failing tests for the captured throttle envelope, malformed lookalikes, permanent failure latch, and no account fallback.
2. Implement only the exact observed throttle mapping and sanitized errors.
3. Inspect captured read-only character/corporation calls offline; add bounded optional identity templates/decoders only where the observed request and response schema are known. Preserve compatibility with the five required session templates.
4. Add tests for multiple complete connections, private export, duplicate/invalid session rejection and no secrets in output. Export three isolated bundles to an owner-readable non-repository directory.
5. Run focused transport/session/extractor tests. Independently review specification and quality before deployment.

## Task 2: Worker, bootstrap and health (TDD)

**Files:** `backend/Killboard/discovery.py`, `models.py`, management commands, views, migration; `scripts/deploy/run-killboard-collector.sh`, timer/service examples; focused tests.

1. Test client closure on every management-command exit, shared cooldown, unchanged cursor on rejection, bounded request/time budgets and crash lease recovery.
2. Add a production-paced worker, truthful configured/paused/failed status, and bounded candidate bootstrap command. Persist only verified report responses; the first release starts near the current candidate and does not promise historical backfill.
3. Use a five-minute start-to-start timer with a four-minute run limit; avoid overlapping workers. Select only one session per run and never change account to evade a rejection.
4. Review and test migration compatibility; strict value threshold and owner permissions remain enforced by the API.

## Task 3: Frontend and shared assets

**Files:** `front-codex/src/pages/Killboard.jsx`, access hook/API/layout, `styles/killboard.css`, component/unit/e2e tests; existing shared GameData source and assets.

1. Audit the already implemented black two-column layout and shared image registry.
2. Test owner/ordinary-user navigation and direct access, authorization revocation clearing private data, scroll containment, images and security colors.
3. Fix only confirmed gaps with failing tests first. Keep market/tactical/community behavior unchanged; use the latest master when resolving overlapping changes.

## Task 4: Release verification and packaging

1. Baseline: all 130 current focused Killboard tests pass before new implementation.
2. Run complete focused backend suites, migration checks, script safety tests, frontend unit/preview tests, build/bundle checks and relevant/full e2e workflows.
3. Add Killboard/GameData/extractor safety coverage to CI. Inspect the staged file list and packaged manifest; exclude PCAPs, session bundles, passwords, private keys and unrelated ZIP/output files.
4. Commit only task files, integrate current `origin/master`, obtain independent code review and use the existing PR/production release workflow.

## Task 5: Controlled Linux rollout

1. Read production service/runtime/database configuration without logging secrets. Prepare compatible migrations after a private verified database backup; do not bypass release migration checks.
2. Install the collector runtime/config and sessions in a private persistent directory with dedicated ownership, mode 0600 files and 0700 directories. Do not modify the rollback runtime in place.
3. Perform one bounded authorized known-report check from Linux, then candidate bootstrap. Stop on auth/rate/network/format rejection; do not rotate to another account after failure.
4. Publish through the existing verified release process, check frontend/backend SHAs, owner access, ordinary-user denial, report threshold, security and images.
5. Enable the timer last, observe a real bounded run and its persisted status/cursor. If session reuse fails, release the private UI only with collection visibly paused and report the external blocker rather than claiming active collection.

## Verification commands

```powershell
# backend: enumerate modules explicitly (test discovery for the app alone is insufficient)
$modules = @(rg --files Killboard/tests | Where-Object { $_ -match 'test_[^\\/]+\.py$' } | ForEach-Object { ($_ -replace '\.py$', '') -replace '[\\/]', '.' })
python manage.py test $modules --settings=EVE_MDjango.killboard_test_settings -v 1
python manage.py makemigrations Killboard --check --dry-run --settings=EVE_MDjango.killboard_test_settings
# repository root
python -m unittest discover -s scripts/killboard/tests -v
python -m unittest discover -s scripts/deploy/tests -v
# frontend
node --test tests/unit/*.test.mjs tests/preview/*.test.mjs
npm run build
npm run test:e2e
```

## Rollback

Keep the previous application release and database backup. Disable the new collector timer before rollback. Application rollback does not undo additive migrations or collected reports. Private sessions and captures are never served through Nginx or included in rollback artifacts.
