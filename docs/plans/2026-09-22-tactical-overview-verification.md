# Tactical strength overview — local verification

## Delivered scope

- Quick reporting defaults to enemy people only; no fleet name required. Optional new/existing named fleets retain stable identity and version checks.
- Current-warzone/all-organization strength estimates are independent of camera and search. Each enemy star takes its latest system-count observation, or fleet subtotal only if no system count exists; never both. Unknown and explicit zero remain distinct. Stale records are retained but marked, with age ticking every 15 seconds between snapshots.
- Enemy/friendly summary cards, grouped fleet/location/source rows, separate count-only rows and reporting history. List clicks locate actual stars; map selections reveal matching rows. Live updates never pan the camera.
- Compact member control shows active enabled memberships and distinct online users to commander/founder. Existing management dialog is preserved; scouts get neither roster nor friendly totals/member totals.
- Snapshot `in_scope` shares the map's drawable geometry; mobile gets correct scope statistics without downloading coordinates. No schema migration in this increment.
- Fixed bounded label placement to prioritize existing labels over star-name reservations in dense clusters; real coordinates and ordinary navigation unchanged.

## Test evidence (2026-09-22)

| Check | Result |
|---|---|
| Backend TacticalCollaboration + TacticalBoard, isolated `ci_settings` | 110 passed |
| All frontend Node unit suites | 144 passed (108 tactical) |
| Local-only script safeguards | 13 passed |
| Ordinary starmap E2E: starmap, more, summary, guards | 7 passed |
| Final full Tactical E2E after all refinements | 64 passed (3.8 minutes) |
| Final selection/count/scope targeted E2E | 12 passed |
| Production build | Passed; pre-existing main chunk >500 kB warning remains |
| `makemigrations TacticalCollaboration --check --dry-run` | No changes |
| `git diff --check` | Passed |
| Real HTTP/WS smoke, fresh isolated local owner | PASS, organization 15 |

New tests were observed failing before fixes for default count reporting, summary/member projection, mobile scope, map/list reveal, stale/outside labels and dense marker overlap. The final full tactical rerun passed after all code refinements.

## Review

Backend, aggregation and map passed independent specification and code-quality reviews. Frontend review findings were reproduced and fixed: mobile/outside metadata, stale row labels, explicit source precedence, and filtered count-row map selection. No outstanding actionable review finding remains.

## Local runtime and data

- Frontend 4194 remains in `tactical-local` mode; backend 8001 was restarted using isolated SQLite settings. No production database, push, merge or deployment.
- Real static stars in organization 7; forces and people are fictional local test records. Existing records are preserved.
- Separate scout browser submitted a count-only observation of 150 enemies in 尼尔比, alongside existing named fleets 100 + 50. No new fleet was created by this observation.
- Commander UI showed this report with the scout's name, enemy estimate 500 and friendly estimate 98, with 3 members and 3 distinct online users. The 150 observation replaced the same star's fleet subtotal rather than increasing the total. This manual pass did not measure synchronization latency; real HTTP/WS behavior was separately exercised by the passing smoke test.
- Test browsers hit the existing four-connections/account admission safeguard during repeated hot reloads; this was not bypassed or increased. Initial login redirects to unsupported local fraudlist, as documented; navigate to tactical afterward.
- SQLite/one-process HTTP+WS checks do not prove production MySQL concurrency or 100-client maximum-record performance. Existing production gates in `scripts/tactical/README.md` still apply.

## Screenshots

Under `front-codex/output/playwright/`, all captured from the actual isolated local UI and visually inspected:

- `tactical-overview-final.png`: commander desktop overview and map, 1600 × 1000.
- `tactical-overview-members.png`: separate member management dialog.
- `tactical-overview-count-report.png`: scout's default count-only report form.
- `tactical-overview-mobile.png`: scout mobile overview, 390 × 844, without map or friendly/member totals.
