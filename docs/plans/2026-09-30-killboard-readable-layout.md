# Killboard Readable Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Correct client-localized names, special locations and source combat badges while rebuilding the approved readable private Killboard desk.

**Architecture:** Extend the existing verified immutable GameData pipeline with localized names and exact geography/camouflage evidence. Extend bounded Killboard parsing/persistence with source final summary and damage totals. Render a larger summary and contained personnel/fitting panels, without changing collection or permission behavior.

**Tech Stack:** Python/Django/DRF, offline safe client-resource readers, React/Vite, Node tests, Playwright.

---

## Task 1: Client display data

**Files:** `scripts/game_data/client_assets/`, `scripts/sync_game_data.py`, `backend/GameData/registry.py`, `backend/GameData/data/`, `backend/GameData/tests/test_registry.py`, `docs/game-data.md`.

1. Add failing tests for exact template -> zhcn translations, retained tier names, snapshot-bound geography and missing security, verified camouflage names, and immutability/provenance.
2. Run `python -m unittest discover -s scripts/game_data/client_assets/tests -v` and focused Django GameData tests; confirm intended failures.
3. Decode local resources without executing game code. Implement deterministic localized exports and independent validation; import a new immutable revision without modifying existing version bytes.
4. Expose model-independent `location_record(id)` (system/constellation/region names and verified system security) and `camouflaged_identity(faction_id, feat_score)` (only verified client display identity). Preserve raw names/source evidence for audits.
5. Run toolchain/import tests and GameData tests. Independently inspect outputs, then commit only task files.

## Task 2: Source combat metadata

**Files:** `backend/Killboard/parser.py`, `models.py`, `services.py`, `serializers.py`, `security.py`, `migrations/`, focused tests; importer/collector contract tests if required.

1. Add failing cases where final_character_id=None but final ship/weapon/damage identify a source summary; unique match vs ambiguous match; cf/fs; total damage; incomplete lists; DB round-trip; existing 19748417.
2. Run focused tests and verify failure before implementation.
3. Preserve nullable source metadata through additive migrations. Match final rows only by unambiguous source identity/attributes, preserve a separate verified summary when necessary, and avoid duplicate damage. Resolve localized/anonymous actor names using verified client rules, not inferred NPC status.
4. Determine top damage only from explicit source metadata or a complete source-damage reconciliation, never visible-first-seven maximum. Calculate percentages from verified source total.
5. Prefer trusted client locations when unmanaged ordinary-space tables lack the special ID. Keep batched lookups. Rename Killboard nullsec label only.
6. Run parser/services/API/security/worker tests and migration checks. Independent spec review, then quality review before commit.

## Task 3: Readable desk

**Files:** `front-codex/src/pages/Killboard.jsx`, `src/components/killboard/KillParticipantRow.jsx`, `src/utils/killboardPresentation.js`, `src/utils/securityColor.js`, `src/styles/killboard.css`, unit and e2e tests.

1. Add failing semantic/DOM tests for removed stat cards, merged victim/location summary, independent final/top badges, verified source highlights, readable localized equipment names and canonical slot labels (including client-confirmed rig flags).
2. Implement the approved asymmetric panels: index about 240px; hero about 150–165px with 180×112 ship; participant hull 88×56, equipment 56×56; body names about 15px. Long names may wrap to two lines. Preserve drop state/counts and exact images.
3. Use accessible personnel/fitting tabs when actual details width is below ~720px. Desktop panels scroll internally; mobile retains bounded usable panels. Keep async selection/403 fencing unchanged.
4. Run `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs`, `npm run build`, relevant Playwright suites.
5. Review actual screenshots at 1920×1080,1440×900,1024×768,390px and 125% scaling. Fix any clipping/overflow from evidence.

## Task 4: Integrated verification and handoff

1. Run all focused Killboard/GameData suites, offline tooling/deployment packaging safety tests, frontend unit/build and relevant/full e2e tests.
2. Use real sanitized captured report metadata and client artwork for local preview; do not use synthetic preview DB identities as game evidence. Do not query game during shared rate-limit cooldown or bypass the timer lock.
3. Final independent specification review then code-quality review. Resolve P1/P2 findings before completion.
4. Keep source/captures/session files private and outside Git/public assets. Report local preview and verification, with any data boundary explicitly stated. No push/merge/deploy in this development-only request.

## Commands

```powershell
# backend working directory
python manage.py test Killboard.tests.test_parser Killboard.tests.test_services Killboard.tests.test_api Killboard.tests.test_security GameData.tests --settings=EVE_MDjango.killboard_test_settings -v 1
python manage.py makemigrations Killboard --check --dry-run --settings=EVE_MDjango.killboard_test_settings
# repository root
python -m unittest discover -s scripts/game_data/client_assets/tests -v
python -m unittest discover -s scripts/game_data/tests -v
# frontend working directory
node --test tests/unit/*.test.mjs tests/preview/*.test.mjs
npm run build
npm run test:e2e -- --grep killboard
```
