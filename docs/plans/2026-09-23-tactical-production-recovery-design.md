# Tactical board production recovery design

## Observed failures

- Production uses `USE_TZ=False` and `TIME_ZONE=Asia/Shanghai`; CI uses `USE_TZ=True`. A real `report.create` returned HTTP 500 at `TacticalCollaboration/services.py:339` while comparing an offset-aware observation to naive `timezone.now()`. MySQL would also reject the aware value on save. The browser correctly retained the failed command in its local outbox.
- `wss://evemtk.com/ws/tactical/...` is not routed to ASGI: the upgrade request receives the SPA's HTML. The WSGI service does not contain Channels/Uvicorn. HTTP snapshot polling remains functional, but the prominent warning looks like a total service outage.
- An empty map only shows passive text; the scope control is a small top-right link. The star-intelligence card changes `right` from 20 to 340 pixels when the overview opens, causing a distracting jump and crowding the map.

## Approved direction

Fix the report failure and the two map interactions, then enable the dedicated WebSocket transport only after isolated functional and capacity checks. Retain HTTP sync as a fallback. A small UI-only/HTTP-only release was considered but would leave the requested realtime transport absent.

### Time contract

Do not change global `USE_TZ` or reinterpret historical rows. Parse and validate offset-aware client timestamps against an explicitly aware UTC clock. Store them in the timezone representation required by the current Django setting: aware when `USE_TZ=True`, local naive when `USE_TZ=False`. Serialize tactical timestamps with an explicit offset on both settings, so browser age labels and editor round-trips represent the same instant. Test create/update, rejection of naive and future timestamps, and response round-trip under both settings. No schema migration is needed.

### Map interaction

When the organization has no selected regions, show one central, keyboard-accessible `选择作战范围` action for founder/commander; scouts see a waiting message without an unauthorized button. Do not mistake a transient map fetch failure for an empty scope. Keep the existing compact scope control after a scope is selected.

At all desktop sizes, place intelligence in the existing right-side context area and temporarily replace the overview. Closing intelligence restores the overview; its deployment-detail action explicitly switches back. A first browser regression found that a fixed left card blocked the map toolbar and draggable count marker, so the original left-side proposal was rejected. The mobile flow continues to use the no-map list view.

### Realtime transport and release gate

Keep HTTP commands and the current WSGI service unchanged. Prepare a separate, pinned Channels/Uvicorn runtime and systemd service bound to loopback, then route only `/ws/tactical/` through Nginx with upgrade headers and an exact origin allowlist. The ASGI consumer still authenticates the JWT and DB lease; no anonymous board state is exposed. Before switching production traffic, exercise the transport against an isolated database, including forbidden origin, missing/expired token, role isolation, reconnect, and a 100-account load run. If resource limits or correctness gates fail, leave the production HTTP fallback and report the remaining blocker instead of advertising WebSocket as live. Preserve backups of changed server configuration and verify the previous WSGI and other website routes after rollout.

## Verification

Backend tests must run with both time-zone configurations. Frontend E2E must cover no-scope permission/CTA and stable intelligence placement at wide and narrow viewports. Release checks must confirm HTTP report creation in an isolated MySQL rehearsal, successful WebSocket upgrade, status of both services, original navigation routes, and no new production 500s. No real user intelligence is used as a test fixture.
