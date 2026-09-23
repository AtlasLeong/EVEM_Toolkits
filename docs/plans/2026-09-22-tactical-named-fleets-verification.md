# Named fleet intelligence — local acceptance, 2026-09-22

## Delivered

- Uniform map star names (live computed style `13px / 400`), no oversized duplicate system count.
- Content-sized, horizontally/vertically centered fleet badges: name + count, three rows plus overflow; real geometry, density focus, ambiguous destination choice and direct force dragging retained.
- New fleet / update existing fleet / system total modes; preset or custom names. Stable fleet IDs, pinned reviewed versions, immediate visibility, source author/time and historical observations. Own edits cannot change report type/link, replace newer sources or reverse a commander move.
- Explicit system totals remain separate and are never added to fleets. Scout/friendly-data separation and force management permissions remain in place.
- Long unbroken 80-character fleet names wrap inside selection/detail containers while counts stay visible.

## Fresh verification

Commands ran in `.worktrees/tactical-collaboration` (frontend commands in `front-codex`):

| Check | Result |
| --- | --- |
| `.venv/Scripts/python.exe backend/manage.py test TacticalCollaboration TacticalBoard --settings=EVE_MDjango.ci_settings --noinput` | 101 passed |
| `node --test "tests/unit/tactical*.test.mjs"` | 87 passed |
| `.venv/Scripts/python.exe -m unittest discover -s scripts/tactical/tests -v` | 13 passed |
| `npx playwright test --config tests/tactical-e2e/playwright.config.js` | 55 passed, final run 3.1 minutes |
| `npx playwright test tests/e2e/specs/starmap.spec.js tests/e2e/specs/starmap-summary.spec.js tests/e2e/specs/starmap-more.spec.js tests/e2e/specs/starmap-guards.spec.js --workers=1` | 7 passed |
| `.venv/Scripts/python.exe scripts/tactical/smoke_board.py --base-url http://127.0.0.1:8001 --fresh-owner` | Real HTTP/WS PASS, root run organization 14; independent run 13 |
| `npm run build` | Passed; existing main bundle ~503 kB warning remains |
| `.venv/Scripts/python.exe backend/manage.py makemigrations TacticalCollaboration --check --dry-run --verbosity 2 --settings=EVE_MDjango.ci_settings` | No changes detected |
| `git diff --check` | Passed; Windows LF/CRLF notices only |

Test-first evidence: payload/three-row, named form, source attribution, map layout and long-name overflow cases failed before their corresponding changes. The first full browser run had one legacy test missing the newly required fleet name; after updating the interaction to select a preset, 54/54 passed. Added/reproduced/fixed the review finding, then final full run 55/55 passed.

Independent spec then quality reviews covered backend, map and form/page integration. The only important quality finding was the long-name overflow, fixed and re-reviewed. No remaining important findings in these scoped reviews. These are scoped checks, not a claim of every application test or production readiness.

## Actual local trial

- Guarded isolated SQLite backed up using its backup API to `.venv/tactical-pre-named-fleets-20260922.sqlite3` before migration; `0005_named_fleet_observations` applied successfully. Existing records were retained.
- Exact isolated backend restarted, frontend kept running. URL: `http://127.0.0.1:4194/tactical?organization=7`; API/WS only `127.0.0.1:8001`.
- Used actual login form as `scout@tactical.local`, then actual report forms (no API mocks) to add 大航队 100人 and 远炮战列队 50人 at real system 玛斯帕. Both immediately appeared as independent labels, with 前线斥候 attribution. Existing system snapshot 24 remained separate.
- Actual UI checked badge anchor/central baseline, consistent live font weights, existing-fleet update selection and source details. Page console after fresh tactical navigation contained only the React development info, no errors.
- Screenshots: `front-codex/output/playwright/tactical-named-fleets-live.png`, `tactical-named-fleets-detail.png`, `tactical-named-fleets-report.png`. These are browser screenshots of the running local app, not generated mockups. Demo military data is fictional; map uses the previously imported real static snapshot.

## Boundaries and remaining release gates

No merge, push, deployment, production database access or global navigation redesign. All work is in the existing tactical worktree, preserving earlier uncommitted edits. The local-only accounts/passwords are documented in `scripts/tactical/README.md`.

An unrestricted all-app CI migration dry-run suggests initial state migrations for legacy unmanaged `TacticalBoard` models; the scoped tactical collaboration migration check is clean. No unrelated initial migration was generated. This does not replace production schema review.

Still required before production: isolated MySQL concurrency tests, ASGI/proxy/Origin deployment decision and checks, production backup/migration plan and explicit deployment approval. No new 100-user capacity claim is made by this feature's SQLite/UI tests.
