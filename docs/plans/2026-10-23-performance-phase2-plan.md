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

## Concrete verification commands

From `backend/`, using existing isolated dependencies (no production settings):

```text
python manage.py test Market GameSessions.tests --settings=EVE_MDjango.ci_settings --noinput
python manage.py makemigrations Market --check --dry-run --settings=EVE_MDjango.ci_settings
python manage.py test AnomalyHotspots --settings=EVE_MDjango.anomaly_test_settings --noinput
python manage.py test ControlCenter --settings=EVE_MDjango.control_center_test_settings --noinput
```

Confirm the ControlCenter settings filename from the existing CI before running;
never combine app-specific isolated settings that omit the selected app.
Baseline Market/GameSessions: 256 pass. Anomaly: 78 pass, 6 platform skips on
Windows. An initial combined baseline invocation used the wrong settings;
its missing-app errors were resolved by running the existing separate suites,
without any code/config changes.

From `front-codex/`:

```text
node --test tests/unit/*.test.mjs
npm run build
npx playwright test tests/e2e/specs/market-collection-health.spec.js tests/e2e/specs/market-capacity.spec.js tests/e2e/specs/hotspot-changes.spec.js tests/e2e/specs/starmap-performance.spec.js --workers=1
```

Use separate local ports/output directories for parallel browser verification.
Final CI still runs the complete main-browser, preview, tactical and MySQL gates.

## Review and local evidence (before release)

- Tasks 1–4 implemented as small domain commits. No session material, timer
  settings, coordinator policy, dependency lockfiles or production credentials
  are part of the change.
- Independent hotspot specification and quality reviews passed. Independent
  Market specification review passed after fixing two presentation gaps: show
  public tier/target as a non-guarantee, and avoid estimating actual rotation
  from the configured cap when stored effective-plan evidence is available.
- Root independently reran 287 Market/GameSessions/settings tests, 90 anomaly
  tests (6 existing Windows/POSIX skips), 42 ControlCenter tests and clean Market
  migration drift. Focused Market browsers: 33 passed; hotspot reviewers ran
  44/31 focused browsers independently with no failures.
- Isolated unchanged-old-code downgrade rehearsal passed: old latest reads
  become unavailable until the next old-format success; old history read/append
  rejects v2, leaving every sample and manifest hash unchanged. Temporarily
  setting `ANOMALY_HISTORY_DIR` empty for both the web and collector runtimes
  disables history safely during an operational downgrade. Preserve the store;
  a compatible forward fix is required before enabling history again.
- Full frontend units/build and full browser regression, final independent
  Market quality review, PR/master CI and protected production acceptance are
  release gates, not implied by the focused results above.
