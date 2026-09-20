# Static Data Import and Corporation MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This session uses superpowers:subagent-driven-development with spec review followed by quality review per task.

**Goal:** Preserve the full SWEET snapshot in an isolated online MySQL schema, then implement reviewed corporation profiles and three PNG poster templates.

**Architecture:** A standalone fail-closed importer creates a new versioned raw-data schema, outside existing business tables and Django migrations. A new Community Django app owns corporation claims, immutable review revisions and private/approved media. React pages reuse existing auth, shell and warm-neutral tokens; fixed canvas poster layouts avoid extra design-service dependencies.

**Tech Stack:** Python 3.10+, sqlite3, existing MySQL driver, Django 4.2/DRF, React 18, Vite, Canvas, unittest/Django tests/Playwright.

---

## Task 1: Lossless isolated importer

Files: `scripts/game_data/import_sweet.py`, `scripts/game_data/tests/test_import_sweet.py`, `scripts/game_data/README.md`.

1. Write fixture-driven failing unittest cases: exact row digests distinguish NULL/empty/duplicate/float, BIGINT IDs, text including NUL/Unicode, preserve rowid, invalid schema name, wrong source hash, existing target refuses mutation.
2. Run `python -m unittest discover -s scripts/game_data/tests -v`; confirm missing implementation fails.
3. Implement pinned-source inspection, safe identifier quoting, native column mapping BIGINT/DOUBLE/LONGTEXT utf8mb4 binary collation (BLOB if needed), source rowid, loading/verified metadata and ordered canonical digests. Reject mixed unrepresentable storage types rather than silently coerce. Stream bounded batches; no REPLACE/TRUNCATE/DROP/update existing raw rows. Write only new versioned schema prefixed `evem_sweet_`.
4. Run unit tests and local full snapshot inspection (22 tables, 899630 rows); independently spec-review then quality-review.
5. Commit only importer/tests/docs, never archive data or secrets.

## Task 2: Online rehearsal and import

Files: `docs/plans/2026-09-20-sweet-mysql-rollout.md` (non-secret evidence).

1. Verify SSH fingerprint, current database identity, privileges, strict SQL mode, packet size, disk, target absence, and online service health read-only.
2. Upload private archive/manifest/pinned reviewed importer into a new root-only directory; verify source SHA after extraction.
3. Run full import to new rehearsal schema; compare every table count and canonical digest with SQLite and source manifest. Never use existing business schema even for rehearsal.
4. Run import to new production static version schema; verify a second time and mark verified. Retain original private archive as recoverable source, do not change any live application alias or restart.
5. Record counts/digests, times, schema identifiers, service health, limitations. Leave rehearsal identifiable; remove only with explicit scope and verified exact target if appropriate, not automatically.

## Task 3: Corporation backend

Files: new `backend/Community/{apps,models,serializers,services,views,urls,media,tests,admin}.py`, migration; `backend/EVE_MDjango/{settings,urls,ci_settings,ci_urls}.py`.

1. Add failing API/model tests with real Django DB: anonymous public reads only approved profiles; login creation/claim; staff approval sets ownership; owner edits draft; submit snapshots draft; outsider denied; pending cannot leak; approving immutable revision changes published pointer, subsequent drafts leave public content intact; reject reason and audit trail; safe duplicate/race handling.
2. Run `python manage.py test Community --settings=EVE_MDjango.ci_settings --noinput` and witness missing behavior.
3. Implement managed Corporation/Claim/Revision/Media/Review models and service transactions. Keep normalized corporation identity separate from draft payload; one pending claim per applicant/corp, owner transfer only staff-reviewed. Add limits, pagination, closed enum/length validation, correct status codes and safe error messages. Add server capabilities and staff queue.
4. Add failing upload tests then image sanitizer and access endpoints: owner/staff private, approved-associated public only, no arbitrary file path or raw SVG, bounded image bytes/pixels, cleaned WebP/PNG output, ownership and revision references validated.
5. Generate migration and check drift; run Community plus existing 85-test isolated suite. Record real MySQL migration rehearsal separately before any production migration.
6. Spec review, then quality review; commit scoped changes.

## Task 4: Corporation UI and posters

Files: `front-codex/src/pages/Corporations.jsx`, corporation components / `src/services/corporations.js` / `src/utils/corporationPoster.js`, `App.jsx`, `AppShell.jsx`, scoped CSS; `tests/e2e/specs/corporations.spec.js`, poster unit tests.

1. Write failing browser tests for public list/empty/error/detail, auth gate, create/claim application, owner edit/submit, staff review, and poster template switching/download. Use existing mocked API conventions and assert accessible labels / user-visible results.
2. Run focused tests; implement responsive pages matching existing design. Server returned capabilities determine buttons, not JWT role. Preserve navigation and mobile starmap policy.
3. Add text wrapping/overflow tests then deterministic fixed portrait canvas templates (recruitment / introduction / event), await fonts and image decode, clamp text visually, show errors instead of blank exports, fetch controlled media with auth when private. Never render unsanitized HTML or fetch arbitrary image URLs.
4. Draft image has permanent 未审核 marker. Published poster uses server-approved payload; customizing a published payload makes it draft/unreviewed. Export filenames safe, loading and retry states visible.
5. Run focused e2e, all relevant regressions, build; spec and quality review. Capture desktop/mobile and all three poster previews with a clearly labelled local fixture, not public fake corporations.

## Task 5: Integration verification and handoff

1. Fresh full backend isolated tests; importer tests; frontend e2e/build. Review diff and migration/packaging (no private raw data/assets/.env in git or release).
2. Verify DB import using actual target queries. Rehearse Community migration on isolated MySQL with matching actual auth model; document deployment commands/gates and backout.
3. Final independent review; fix Critical/Important findings with failing regression tests first.
4. Update roadmap: raw snapshot imported != current-CN complete catalog. Corporation implementation status must distinguish local tested vs online released. Keep remaining three tasks unchecked.
5. Hand off branch, screenshots, verification evidence; do not implicitly push master or deploy corporation app before release scope is confirmed.

## Execution checklist

- [ ] Task 1 importer + two reviews
- [ ] Task 2 rehearsal + online static data import
- [ ] Task 3 backend + two reviews
- [ ] Task 4 UI/poster + two reviews
- [ ] Task 5 final evidence / review / handoff

Baseline: clean branch `codex/community-corp`, worktree `.worktrees/community-corp`; 85 existing backend tests pass under isolated `ci_settings`. Node dependencies are reused via an ignored junction, not added to git. Canonical raw snapshot remains under root `.local-data/` and is not copied into the repository.
