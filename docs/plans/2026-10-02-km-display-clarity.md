# KM Display Clarity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> to implement this plan task-by-task in the current session.

**Goal:** Present readable, truth-backed participants, corporation tags, grouped
equipment and uncropped ship imagery on the private production KM page.

**Architecture:** Reuse the isolated managed worktree on a fresh
`codex/km-display-clarity` branch. Separate additive backend tag persistence from
frontend presentation. Keep existing collection/permissions untouched and verify
actual image geometry using CLI-driven browser QA, not CSS regex alone.

**Tech Stack:** Django/MySQL, React/Vite, Node test runner, Playwright CLI.

## Task 1: Preserve verified corporation tickers

Files: `backend/Killboard/models.py`, `parser.py`, `services.py`, `serializers.py`,
new `migrations/0009_corporation_tickers.py`, parser/services/serializers/API tests.

1. Write a failing parser test using the existing verified fixture: victim GCG1
   and participant KOFR ticker are retained, absent/malformed values are blank.
2. Run `manage.py test Killboard.tests.test_parser` with
   `EVE_MDjango.killboard_test_settings`; confirm expected assertion failure.
3. Add blank-default max-255 ticker strings to existing models. Extend verified
   `_enrich_identity` output and additive serializers; do not add a game RPC.
4. Add failing persistence tests for known-ticker preservation during same-corp
   partial refresh and no stale tag after changed corporation ID.
5. Implement minimal persistence semantics; run parser/services/serializer/API
   modules. Generate the single additive migration, check no other pending model
   changes, and self-review.
6. Obtain independent specification review, then quality review before commit.

## Task 2: Participant names and grouped equipment

Files: `front-codex/src/utils/killboardPresentation.js`,
`components/killboard/KillParticipantRow.jsx`, `pages/Killboard.jsx`,
`tests/unit/killboardPresentation.test.mjs`, participant/page unit tests.

1. Add failing tests proving a plain unnamed ship-evidence row uses
   `混乱风暴发射器`, not an ID/missing-identity phrase. Prove named and verified
   source/NPC/camouflage display names still have priority.
2. Run affected Node unit modules and confirm the behavioral failures.
3. Make corporation text optional; add true ticker display support. Suppress NPC
   captions, absent corp line and duplicate hull caption. Preserve final/top
   badges and the first-seven visibility contract.
4. Add failing actual-component tests for section order high/mid/low/rig/other,
   per-group heading/count and drop-only removing empty groups. Keep tabs and
   resetting filters when the KM changes.
5. Render nonempty filtered groups as sections in the existing scroll pane.
   Unknown slots stay other; item drop data and labels are unchanged.
6. Run full frontend unit suite; independent spec then quality review.

## Task 3: Hero geometry and visual hierarchy

Files: `front-codex/src/styles/killboard.css`, `pages/Killboard.jsx`, page tests,
untracked CLI QA harness/evidence under `front-codex/output/playwright/km-clarity`.

1. Reproduce the current failure with actual CSS/component and real complete
   PNGs, recording natural dimensions, image rect, asset rect and clipping hero.
2. Create a failing browser-bound assertion for tall, wide and diagonal assets.
3. Apply a minimal definite viewport/intrinsic sizing fix backed by the measured
   root cause. Remove contradictory hero rules where necessary; no shared image
   component behavior changes outside KM.
4. Add clear corporation/ticker and hull-class typography using existing system
   fonts, readable cyan/white contrast and explicit metadata labels.
5. Verify desktop/tablet/mobile screenshots and bounds, no horizontal page
   overflow, usable scroll panes and equipment controls. Run unit/build checks.
6. Obtain independent final spec and quality review across all tasks.

## Task 4: Verify and release

1. Run all explicit Killboard + GameData backend labels and full frontend unit
   suite/build. Run deployment contract tests and migration dry-run check.
2. Commit only reviewed code/tests/docs; exclude operational outputs, captures,
   credentials and artifacts. Push using existing production workflow.
3. Wait for successful CI exact artifact, stage it with the installed reviewed
   publisher. Take and verify a fresh private full database backup.
4. Apply only the additive ticker migration under release and collector locks.
   Publish via normal production mechanism; do not reset source cooldowns.
5. Verify production SHA, owner 200/non-owner 403/anonymous 401, new serializer
   fields, timer unchanged and no pending transaction. Record truthful caveats
   for historical tag absence and provide screenshot/report links to the user.

## Progress checklist

- [x] Root-cause evidence and delegated design decisions documented.
- [x] Reused isolated worktree, fresh branch, baseline frontend 515/515 passes.
- [ ] Backend tickers: red/green, spec review, quality review.
- [ ] Participant/group presentation: red/green, spec review, quality review.
- [ ] Real browser image geometry and visual QA verified.
- [ ] Complete regression suite and production release verified.
