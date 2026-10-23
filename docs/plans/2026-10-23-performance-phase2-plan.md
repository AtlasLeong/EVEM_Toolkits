# Performance phase 2 implementation plan

> Use test-driven development and subagent-driven development. The approved
> design is `2026-10-23-performance-phase2-design.md`.

## Task 1: hotspot backend metric contract

Write failing tests for v2 grade bounds/metadata, v1 compatibility without file
rewrites, grade comparison versus legacy/mixed incomparable intervals, failure
fallback, safe public/private API projection. Implement a pure contract plus
minimal snapshot/history/publication/view changes. Keep physical safety checks,
retention, protocol/auth transport, permissions, timing and budgets unchanged.
Tests: anomaly_test_settings AnomalyHotspots; ControlCenter isolated suite;
web import separation and immutable bytes/hash assertions. Commit explicit files.

## Task 2: hotspot presentation

Write failing frontend unit and browser tests; accept explicit v2 and legacy
contracts. Grade/range system labels, peak-grade/hot-system region ranking,
grade-change wording, incomparable legacy history, metadata-preserving fallback.
Preserve search/focus/palette and authorization. Update old synthetic count
fixtures as explicit legacy fixtures, not silently converted grade fixtures.
Tests: units, hotspot change and map performance browsers, desktop/mobile visual.

## Task 3: market bounded tiers and private observability

Write failing tests for nullable flag migration/backward inserts, strict admin
validation/permissions, ordinary-only stable order, priority/ordinary reservation,
donation/no duplicates, repeated-pass fairness at effective shared cap, and
unchanged authentication/refusal/rate-limit stop behavior. Implement one additive
migration and narrow selector, additive age/tier payloads, bounded private health
projection and safe reason descriptions from stored runs/config only. Preserve
public quality diagnostic exclusion and two-hour stale status. Include snapshot
coverage, age and timestamped observed throughput/effective limits; don't infer
unobserved account states or increase collection. Commit explicit files.

## Task 4: market admin and freshness presentation

Test-first existing admin UI priority toggle and private health display; render
actual age/target/tier without redefining stale or promising impossible refresh
times. Keep layouts compact and accessible at mobile and desktop widths. Render
safe actionable collection reasons, not raw failures. Existing permissions guard
all writes. Test unit and market admin/quality/capacity browser regressions.

## Task 5: independent review, integrated tests, protected release

For each domain: independent spec review, fix and re-review, then independent
quality review. Independently verify all changed files against the approved
scope and no credential/config/private output staging. Run full relevant backend
suites, migration drift and isolated upgrade/rollback compatibility, frontend
unit/build/browser tests. Push PR, attach it to this chat, require all gates green,
merge to master, require master CI and normal Production success. Verify exact
runtime metadata/SHAs, private denials, fresh scheduled v2 snapshots, frontend
layout/function, phase-1 gzip, unchanged timer policy/KM disabled. Record evidence
and report results/limitations. Do not force-publish or skip gates.
