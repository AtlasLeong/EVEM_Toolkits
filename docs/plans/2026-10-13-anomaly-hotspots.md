# Anomaly Hotspots Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Admit the new captured account only after a real KM validation, and show periodically collected anomaly-destruction counts and rankings on the existing star map.

**Architecture:** Separate AnomalyHotspots capability validation, using existing transport framing/latching and mandatory GameSessions account coordination. Persist a sanitized atomic last-good file and expose one stored-data GET; dynamic UI remains independent of static map data.

**Tech Stack:** Python / Django REST Framework / MessagePack / SQLite coordination / systemd, React / TanStack Query / existing canvas map.

---

### Task 1: Anomaly collector, private extraction, snapshot and read API

**Files:** Create `backend/AnomalyHotspots/{__init__,apps,protocol,session_bundle,collector,snapshot,views,urls}.py`, `backend/AnomalyHotspots/management/commands/anomaly_collect.py`, `backend/AnomalyHotspots/run-collector.sh`, `backend/AnomalyHotspots/tests/test_*.py`, `backend/EVE_MDjango/anomaly_{worker_settings,test_settings,test_urls}.py`, `scripts/anomaly_hotspots/extract_session_bundle.py`, `scripts/anomaly_hotspots/tests/test_extract_session_bundle.py`, and `scripts/deploy/evem-anomaly-collector.{service,timer}.example`; modify production settings/urls and `Authentication/viewer_access.py`. Do not edit strict KM extraction/validation.

1. Write failing tests for the observed response: one Ext10 containing a list of Ext19([112, bytes]) rows. Reject unknown wrappers, schema discriminator/field drift, duplicate IDs, booleans/negative counts/invalid IDs, >10,000 rows and bounded oversized data. Run `python manage.py test AnomalyHotspots.tests --settings=EVE_MDjango.anomaly_test_settings -v 2` and record expected missing-feature failures before code.
2. Implement strict `decode_counts(value)` yielding sorted `[{solar_system_id, destroy_num}]`; no recursive map search. Synthetic fixture: `msgpack.ExtType(19, msgpack.packb([112, msgpack.packb({'solar_system_id': 30000001, 'destroy_num': 12}, use_bin_type=True)], use_bin_type=True))`.
3. Test and implement bundle API `validate_session/encode_session/decode_session/load_session/save_session`, allowing exactly four auth methods plus captured `get_dungeon_destroy_statistics` with route `char_mgr`, node -1, args [] and kwargs {}. Use existing private-file/binary bounds. Test ordered same-connection capture extraction, reject missing auth/gaps/new handshakes. Separate `derive_km_bundle(bundle, kill_id)` replaces only the business Ext10 call and validates with unchanged KM schema; clearly document its derived provenance.
4. Test and implement mandatory-lease `HotspotSession` reusing KillboardSession framing and terminal error latch; one collection = four auth calls plus one dungeon call, no reconnect/fallback, deadline/budget and randomized 1–3 second pacing. All exits release lease, publish shared auth/service/rate state correctly. No game requests at import time.
5. Test `write_success(path, rows, now_ms)` / `write_failure(path, safe_code, now_ms)` and `read_snapshot(path)`: bounded exact schema, no symlink components, atomic replace, preserve last-good rows/time on failures, owner/group restricted file, safe logs only. Timestamp keys are `collected_at_ms` and `last_attempt_at_ms`; `version=1`, `status`, `systems`, `statistics_window=None`. No remote/error raw text.
6. Implement `GET /api/anomaly-hotspots/` with stored snapshot only and PublicReadOrAuthenticated plus scoped 120/hour throttle. Return snapshot fields plus `system_name`, `region_id`, `region_name` per system from bounded static `solarsystem`/`region` queries. Unknown membership is null, never guessed. Public GET/HEAD only, no trigger/session endpoint. Test disabled public reads and denial for mutating methods; failure responses omit raw path/exception/auth. Set no-store.
7. Add minimal isolated worker settings (no DB/auth/web env reads), management command and systemd example: fixed session, coordinator required, protected snapshot, journal safe counters/status; 5min + 5min jitter. Use the same run lock as KM so deployment and collectors cannot overlap; document privilege separation for private bundles and backend-read-only snapshot. Run new tests plus existing KM/GameSessions tests and extraction tests, self-review and commit only owned files.

### Task 2: Independent dynamic map layer and leaderboard

**Files:** Modify `front-codex/src/pages/TacticalBoard.jsx`, `front-codex/src/components/tactical/TacticalStarMap.jsx`, `front-codex/src/styles.css`, `front-codex/src/utils/apiTacticalBoard.js` (or actual existing API path); create `front-codex/src/components/tactical/AnomalyHotspotLeaderboard.jsx`, `front-codex/src/utils/anomalyHotspots.js`, focused tests under `front-codex/tests/unit/`.

1. Write failing Node tests for deterministic system ranking, verified region sums, unknown membership note, exact counts, stale last-good data, heat bands 1–80/81–200/>200, fitting only mapped hotspot members. Run `node --test tests/unit/anomalyHotspots.test.mjs` and verify missing-feature failure.
2. Implement pure helpers and authenticated-compatible stored-data GET with abort support. React Query polls every 60s only while visible and retains previous successful data on errors; never call game RPC. Preserve existing static map model/view and route.
3. Add translucent screen-space hotspot circles behind security cores, desktop left-edge foldable Top10 board under HUD with system/region tabs. Exact destruction count, 24h clock timestamp, honest unverified-window note, failure/stale indicator. System locate only with known coordinates; region extent labeled '定位该星域热点'. Stop panel clicks/scroll from panning canvas. Mobile leaderboard outside hidden map with no locate controls.
4. Run all frontend unit tests and `npm run build`, visually inspect desktop expanded/folded tabs and mobile snapshot/error state with browser screenshots. Commit owned files after self-review.

### Task 3: Reviews and controlled live validation / activation

1. Independent spec review per task; fix omissions. Then independent quality/security review; fix important issues, rerun regressions. No self-review substitution.
2. Root only: extract actual captured auth into owner-only private files, not Git; transfer over existing verified SSH into protected staging. Provision NEW coordination state and map six existing slots plus new alias; preserve existing bundle files/config backups. Do not insert unverified seventh slot.
3. With timers quiesced and existing collector lock held, perform one new-account authenticated historical KM request (no enrichment) and one dungeon request, sharing a lease and bounded budget. Validate matching report and complete strict hotspot rows, persist only aggregate counts, fail closed on rejection. No extra credential discovery or brute-force probing.
4. Only after successful validation append the seventh private KM path and aliases atomically, configure coordinator and hotspot worker, expose snapshot to backend user, keep original private files mode0600. Re-enable existing timer and new randomized timer after code deployment. Preserve backups for rollback and avoid raw env/journal output.
5. Use existing CI/release publishing path (never bypass gates or install dependencies in live shared venv), protect shared collector lock during release. Verify actual API snapshot, latest live source SHA, permissions, timer configuration and one real successful saved collection. Report any authorization blocker honestly without claiming account insertion or live freshness.
