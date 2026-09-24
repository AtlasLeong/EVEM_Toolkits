# Market Prices Implementation Plan

**Goal:** Add a public EVE Echoes market price page, an authenticated collection administration page, durable MySQL price history, and a Linux collection service using a dedicated game session.

**Architecture:** Django owns catalog, configuration, snapshots, latest quotes, runs, and HTTP APIs. A separate one-at-a-time collector process reads due work, opens a game session only for the collection cycle, writes results, closes the connection, and schedules the next run at a uniformly random 35–51 minutes after the cycle ends. React reads Django APIs. The collector protocol and session material stay server-side; no game credential enters browser assets or source control.

**Tech stack:** Django 4.2, DRF/JWT, MySQL 8, Python socket/MessagePack, systemd, React/Vite.

**Acceptance constraints:** Existing market collector has proved live quote retrieval for one item, not username/password login, Linux session loading, production MySQL writing, or broad catalog coverage. All those claims require separate real checks. Never copy chat-supplied passwords into code, fixture, command line, URL, log, or task prompt.

---

## Task 1: Data and API

Files: `backend/Market/{apps,models,serializers,views,urls,admin}.py`, initial migration, `backend/EVE_MDjango/{settings,urls,ci_settings,ci_urls}.py`, `backend/Market/tests/`.

1. Write failing model/API tests for item search, latest price, history pagination, empty and stale quote states, administrator permissions, bounded 2100–3060 second schedule, manual enqueue, and audit history. Run them under isolated CI settings and confirm expected failures.
2. Define `MarketItem` keyed by numeric game item ID and market scope, `MarketConfig` singleton with min/max interval and next due epoch, immutable `PriceSnapshot` with decimal best bid/ask and observed UTC epoch, `LatestPrice`, `CollectionRun`, and configuration audit. Use epoch millisecond integers for persisted task times to avoid the production/CI `USE_TZ` mismatch; render UTC ISO timestamps in APIs.
3. Provide `GET /api/market/items/`, `GET /api/market/items/<id>/history/`, `GET/PATCH /api/market/admin/config/`, `GET/POST/PATCH /api/market/admin/items/`, `GET /api/market/admin/runs/`, and `POST /api/market/admin/run/`. Public reads are rate and page bounded. Writes require authenticated staff with Market permissions; server checks permissions regardless of UI.
4. Add and review the migration, run focused tests, `makemigrations --check`, and existing backend suites. Do not touch the raw SWEET schema or old PlanetaryResource prices.

## Task 2: Collector and session handling

Files: `backend/Market/collector_protocol.py`, `backend/Market/session_bundle.py`, `backend/Market/management/commands/market_tick.py`, `backend/Market/tests/` and `backend/requirements.txt`.

1. Write failing tests for the transport adapter using synthetic MessagePack orders, request timeouts, invalid order data, one-session-per-cycle, a failed item not blocking the remainder, no zero for missing order sides, singleton lease, idempotent snapshot insert, and next-due selection within 2100–3060 seconds after completion.
2. Port only the proven protocol implementation from `D:/Code/EVE_Market_Collector`; do not copy local PCAP, DPAPI secret, catalog dump, config or credentials. Load a restricted-permission session bundle from a server-side path. Fail closed and mark `needs_auth` if it expires. A separate import command may transform an authorized capture to this format without printing its contents.
3. `market_tick` atomically claims at most one due run, connects and authenticates from existing session material, samples selected items with pacing, stores successful observations and item failures, closes the socket, and schedules the next run. Manual run requests use the same path. Running the command with missing credentials must report a controlled needs-auth state and avoid network traffic.
4. Validate in isolation first. Real game login, quote, MySQL, and Linux checks are separate gates; account/password-only login must not be represented as implemented until proven.

## Task 3: Web UI

Files: `front-codex/src/pages/MarketPrices.jsx`, `MarketAdmin.jsx`, `services/apiMarket.js`, `styles/market.css`, `App.jsx`, `components/layout/AppShell.jsx`, relevant frontend tests.

1. Write focused UI and API-client tests for price table, search, stale/empty state, item history, mobile layout, admin permission errors, interval editing, item enable/disable, and run history.
2. Add lazy `/market` and `/market/admin` routes and nav link. Public page shows item name, market scope, best ask/bid, last sample, and 24-hour/7-day/30-day history with accessible contrast. Admin page controls the item list and global interval bounds, shows next run, last success, per-item failure and session status; no credential editor or secret display.
3. Keep public page usable when collector is offline; show last observed price and age instead of an empty or zero quote. Run frontend unit checks, build, and focused browser checks.

## Task 4: Linux deployment and real validation

Files: `scripts/deploy/evem-market-collector.{service,timer}.example`, deployment documentation, `.github/workflows/ci.yml`, `scripts/deploy/{pack,release}.py` and their focused tests where needed.

1. Add a restricted service account and shared session/config path; timer invokes one `market_tick` at a time. Include service health/version and release/rollback behavior. The existing release pipeline blocks pending database migrations, so review/backup/migrate before activation.
2. Check a dedicated account on a nonproduction Linux service using a secure session import, a small verified item set, and a narrow MySQL account. Verify true login/session lifetime, one full query/write/read cycle, 35–51 minute scheduling, credential expiration status, restarts, permission isolation, and rollback.
3. Run all required CI/build/deployment checks before push. Publish only after real DB and service checks pass; report any external authentication blocker honestly instead of claiming end-to-end success.

**Current working branch:** `codex/market-price-module` from fetched `origin/master` at `9e10474` in `D:/Code/EVEM_Toolkits/.worktrees/market-price-module`.
