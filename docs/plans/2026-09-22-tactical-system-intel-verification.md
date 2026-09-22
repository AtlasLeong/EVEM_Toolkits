# Tactical system intelligence — local verification

Date: 2026-09-22. Worktree: `.worktrees/tactical-collaboration`; branch: `codex/tactical-collaboration`.

## Scope and isolation

- Local trial only, no commit/push/merge/deployment or production database access.
- Frontend: `http://127.0.0.1:4194/tactical`; API: `127.0.0.1:8001`, explicitly fixed by `tactical-local` Vite mode.
- Django uses `EVE_MDjango.tactical_local_settings` and the existing isolated `.tactical-local.sqlite3`. Applied migration `0004_report_report_kind` only there.
- Organization 7, `真实星图 · 本地演习`, uses the imported Derelik real-system/gate snapshot with one-hop borders. Positions are real data; all troop numbers are fictional local test intelligence.
- Added four scout enemy-count snapshots using the idempotent guarded `scripts/tactical/system_intel_demo.py`; existing edits and observation timestamps are preserved.

## Verified behavior

- Only the real-coordinate map is rendered. Labels may move; system coordinates and gate topology do not. Dense areas can be focused and returned from; coincident stars and ambiguous drop destinations require a named selection.
- New reports are enemy-count snapshots, immediately shared without confirmation. The latest observation per system wins deterministically, without summing reporters or independent fleets. Unknown and explicit zero are distinct; author, observation time and history are retained.
- Independent fleets move by authorized, version-checked correction to any loaded star. Explicit gate moves still validate adjacency. Moving a fleet does not move the system snapshot or refresh observation time.
- Blank, out-of-map and same-source drops do not submit. Dragging does not auto-zoom. A new scope version discards a pending picker/gesture and refits; unchanged live snapshots preserve camera state.
- Map wheel zoom is scoped and prevents page scrolling. The details list starts collapsed, and map/form selector names do not collide.

## Test evidence

| Check | Result |
| --- | --- |
| `node --test "tests/unit/tactical*.test.mjs"` | 79 passed |
| Django `manage.py test TacticalCollaboration --noinput`, CI settings | 57 passed |
| `python -m unittest discover -s scripts/tactical/tests -v` | 13 passed |
| Ordinary `starmap`, `starmap-more`, `starmap-guards` browser regressions | 6 passed |
| Tactical Playwright suite, including 3 scope-change regressions | 48 passed in 2.7 minutes |
| `npm run build` | Exit 0; existing 502.87 kB shared-index chunk warning remains |
| `git diff --check` | Exit 0; Windows line-ending notices only |
| Real local HTTP/WebSocket smoke, fresh local owner, organization 12 | Passed |

The real transport smoke covers permission/visibility isolation, immediate system-count sharing, own-report updates, rejection of snapshot adoption, movement/time preservation, explicit gate validation, compare-and-swap, archives, live role downgrade and removal. The `--fresh-owner` option creates a local-only owner with an unusable password when repeated tests exhaust a demo owner's organization limit; no existing accounts or organizations are deleted.

## Visual and review evidence

- Reviewed by separate specification and quality agents for backend and frontend. Follow-up integration review found no new blocking issues.
- Real local browser login was exercised using the documented local founder account, not production credentials. Actual map selection/search, scout attribution, quick-report sizing and optional fields were checked in the running local UI.
- Inspected screenshots under `front-codex/output/playwright/`: `tactical-system-intel-live.png`, `tactical-system-intel-detail.png`, and `tactical-system-intel-report.png`.
- Ordinary star-map regression checks pass; new density/interactions styles and imports are tactical-only.
- Final local check: frontend HTTP 200; documented founder password authenticates against the local API and returns active founder membership in organization 7. Both local services remain running. The Codex browser-open request was queued for this task.

## Deliberate limits

- At small scales, some labels are suppressed to prevent overlaps. The star remains selectable and identifiable via hover, search, zoom or the overlap picker; this is not a claim that every label is simultaneously readable at every zoom.
- Real data means the saved public snapshot, not live game telemetry. Counts must be reported by users. The sample data are not real battle information.
- This verifies a local SQLite trial and mocked browser interactions plus a small real HTTP/WS smoke. It does not replace MySQL contention, production proxy/ASGI deployment or new 100-user load testing. Existing pre-release items in `scripts/tactical/README.md` still apply.
