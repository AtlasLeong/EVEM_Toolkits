# Tactical map card clarity — local verification

Verified on 2026-09-23 on local branch `codex/tactical-map-card-clarity` at `44a8b59`. This branch has **not** been pushed, merged, or deployed.

## What changed

- Live map renders a named fleet once, from its current `Force`. The linked `fleet_intel` observation remains in report history and does not reappear as a detached map card after a move or archive. Count-only reports retain their dedicated map badge.
- Star labels avoid real gate strokes where possible; one short focus leader replaces redundant stacked leaders. Real system coordinates and gate edges remain unchanged.
- Founder/commander see an accessible `×` on each current fleet badge. It opens the existing archive confirmation and only confirmation sends versioned `force.archive`. Scouts see no archive control.
- Fleet badges and visible star names avoid the measured search/filter overlay. At 1366×768 and 1440×900, the nine real-demo fleet badges neither intersect that overlay nor each other.

## Automated checks

| Check | Result |
| --- | --- |
| `node --test tests/unit/tactical*.test.mjs` | 149 passed, 0 failed |
| Full `tests/tactical-e2e/tactical.spec.js` | 79 passed, 0 failed |
| `tests/tactical-e2e/map-scope.spec.js` | 3 passed, 0 failed |
| Six `tests/e2e/specs/starmap*.spec.js` files | 19 passed, 0 failed; local API mocks |
| `npm run build` and bundle budget | Passed |
| `git diff --check origin/master...HEAD` | Passed; worktree clean |

## Real local map check

Used an isolated SQLite `backup()` of the existing tactical demo database in this worktree, applied only local migration `TacticalCollaboration.0006`, and started this worktree's backend on `127.0.0.1:8003` and frontend on `127.0.0.1:4193`. The copied static catalog contains 67 real regions; organization 7 provides a real scoped map. The existing 8001 backend and 4194 frontend were untouched. Demo credentials are documented in `scripts/tactical/README.md`.

- At both viewport sizes: nine current fleet badges, nine commander-visible archive controls, no generic report card for linked observations, and zero fleet badge/visible star-name overlap with the floating search/filter controls.
- The nine fleet badges remained in identical pixel positions across repeated live snapshots. Count-only badges remained visible.
- On the real local backend, activating `归档远炮战列队` opened `归档部署`; before confirmation and after cancellation, zero `force.archive` commands were sent. No browser page error was observed.
- Screenshots: `front-codex/output/playwright/tactical-card-clarity-1366-fixed.png` and `front-codex/output/playwright/tactical-card-clarity-1440-fixed.png` (ignored local artifacts).

## Limits

- Browser E2E cases predominantly mock tactical API state; the real-backend manual check covered page rendering and opening/cancelling archive, not a destructive archive or concurrent multi-user command.
- A 500-system expanded real-scope visual benchmark was not run; the checked organization 7 map has about 118 loaded systems. Unit/performance checks cover deterministic layout, but are not a frame-rate guarantee.
- At 1366×768, the dense overview intentionally displays fewer ordinary system names; select or zoom a system to inspect it. The archive hit target is 20×22 px within the 26-px badge row, with the existing side-panel archive path as an alternative.
- The preferred Playwright CLI was unavailable in this sandbox because its package cache write failed; visual captures used the repository's installed Playwright package. This did not affect the project test suite.
