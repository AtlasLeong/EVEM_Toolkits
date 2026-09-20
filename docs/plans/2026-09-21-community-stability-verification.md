# Stability fixes and release checks — local verification

## Scope and boundary

Implements the five approved review fixes and automated release checks on
`codex/community-corp`, based on `aefa8c5`. No push, merge, SSH, deployment,
production migration, media writes, backups or cleanup were performed.

## Regression-first evidence

- Authentication: the real bundled request module initially failed 7 of 9 cases;
  session fencing made them pass. Three further retry/cross-tab cases bring this
  focused suite to 12 passing cases.
- Backend identity/Unicode: 13 initial API scenarios exposed 35 expected assertion
  failures. Historical non-string text added four failing subcases; the final
  focused suite has 14 scenarios. Tests use isolated SQLite, not production MySQL.
- Preview contract: three new tests first failed for candidate claim identity,
  invalid Unicode writes and historical text display; all now pass.
- Editor/cache: real-page API-boundary tests first reproduced saved-baseline loss,
  background-error unmount, remote-version replacement, missing navigation guard,
  stale approval cache and missing claim proposal display. Additional media/back
  navigation tests exposed a cancellation edge. Installing a small pop dispatcher
  before BrowserRouter preserves the editor; successful same-page navigation also
  updates its history index. All 10 focused regressions now pass.
- Release checks: missing preflight/readiness, CI gates, misleading QA label and
  lexical symlink-path validation were each covered by failing tests before fixes.

## Integration commands and results

| Check | Local result |
| --- | --- |
| `python manage.py test Community Feedback License ActivationCode TacticalBoard EVE_MDjango.tests_deployment --settings=EVE_MDjango.ci_settings --noinput` | 190 discovered: 189 passed, 1 Windows symlink-permission skip |
| `python manage.py makemigrations Feedback Community --check --dry-run --settings=EVE_MDjango.ci_settings` | No migration drift |
| `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs` | 65 passed |
| `python -m unittest discover -s scripts/deploy/tests -v` | 38 discovered: 30 passed, 8 Linux-only skips |
| `python -m unittest discover -s scripts/community/tests -v` | 6 passed |
| `npx playwright test --config tests/preview-e2e/playwright.config.js` | 4 passed, real local sandbox HTTP workflow |
| Full frontend browser regressions | 150/150 non-corporation + 61/61 corporation passed serially |
| `npm run build` | Passed; existing main-chunk >500 kB warning remains |

The ordinary browser suite uses real React pages with mocked API boundaries;
the separate preview suite uses the local sandbox service. Neither is proof of
a production API/DB deployment. Linux-only file-lock/symlink publish integration
and the real MySQL migration/concurrency rehearsal remain required before release.

The first concurrent attempt is not counted as a passing run: corporation and
preview tests stalled while three Vite servers shared one worktree. Focused
poster (6/6) and preview (4/4) reruns passed alone, followed by the serial 150 +
61 browser groups above without product-code changes. The evidence is consistent
with test-environment contention; it does not isolate the exact competing resource.
No product regression was reproduced in the serial runs.

## Independent review

Specification and quality reviewers inspected actual code separately and both
passed all workstreams. Their navigation cancellation/index finding was fixed and
re-reviewed. There are no unresolved confirmed review blockers. This is a local
code-review result, not a claim that the real Linux/MySQL deployment has passed.

## Future rollout prerequisites

1. Rehearse the additive `Community.0003_claim_identity_proposal` migration against
   the supported MySQL setup, then arrange its separately authorized deployment.
   Historical proposals remain null; never invent a backfill. A code rollback keeps
   the additive columns rather than reverse-migrating them away.
2. Upgrade the root-owned installed publisher before enabling its new gate. CI
   builds do not silently replace `/usr/local/lib/evem-deploy/release.py`.
3. Provision and verify private persistent Community storage under the actual
   service identity. The new preflight is read-only and will not create it.
4. Run Linux CI and an authorized deployment rehearsal. Read-only permissions
   cannot prove SELinux policy, capacity, quota or future upload success.

See `scripts/deploy/README.md` and the API contract for rollout details.
