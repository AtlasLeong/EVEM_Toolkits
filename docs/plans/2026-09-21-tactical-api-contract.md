# Tactical collaboration implementation contract

Local implementation in progress; no production deployment authorization.

## Runtime decision

Use Django/DRF for authenticated commands, Channels 4.2.0 + Uvicorn 0.34.3 + websockets 15.0.1 for an isolated ASGI entry. Keep existing WSGI deployment unchanged. Persist membership, forces, reports, command receipts, audits and presence leases in the default database. Database transactions/organization row locking serialize commands and admission across workers. Redis is not required for this first implementation; WebSocket notification loops read durable visible state with bounded polling, and only send changed authorized snapshots. Measure this implementation rather than claim a 100-user performance result in advance.

This intentionally starts with role-filtered snapshot resynchronization, not a custom partial-event replay protocol. Immutable command audit is durable; reconnect always fetches a fresh authorized snapshot, preventing missed-event drift and avoiding hidden-event sequence leaks. Snapshot volume and DB polling are explicit load-test targets. Upgrade to coalesced notifications if measured performance requires it.

References checked: https://pypi.org/project/channels/4.2.0/ ; https://pypi.org/project/uvicorn/0.34.3/ ; https://pypi.org/project/websockets/15.0.1/ ; https://channels.readthedocs.io/en/stable/topics/security.html .

## Common API

Prefix `/api/tactical/`. JWT bearer authentication on every endpoint. Errors `{detail, code?}` with appropriate 400/401/403/404/409/429. Mutations require UUID `request_id` and return `{ok: true, result: {...}}`; same actor/org/request id+payload replay is safe, different payload conflicts. Recheck current authorization before returning receipts. Names/notes are plain text; bounded payloads.

Roles: `founder`, `commander`, `scout`. Ship keys: `cruiser`, `battleship`, `light_carrier`, `assault_carrier`, `dreadnought`, `heavy_carrier`, `titan`, `other`. Count values nonnegative integers or null; no fabricated zero for unknown. Deployed forces have `side: enemy|friendly`.

### Organization and administration

- GET `organizations/` → `{organizations:[{id,name,role,status}]}` (only own membership/application).
- POST `organizations/` `{name,request_id}` → `{ok,result:{id,name,role:"founder",status:"active"}}`.
- POST `join/` `{invite_code,request_id}` → `{ok,result:{id,organization_id,organization_name,status:"pending"}}`.
- GET `organizations/<id>/members/` (founder/commander, admission lease not needed) → `{members:[{id,user_id,display_name,role,status}],applications:[{id,user_id,display_name,status}],online_count,capacity:100,online:[{user_id,display_name,role,joined_at,last_seen_at}]}`.
- POST `organizations/<id>/commands/` with action:
  - `invite.create` → result `{invite_code,expires_at}` (founder/commander).
  - `join.review`: `application_id,decision:approve|reject` → scout membership. Removed memberships cannot be silently re-approved; reinstatement is founder-only safe default pending user reply.
  - `member.role`: `member_id,role:commander|scout` (founder only).
  - `member.remove`: `member_id` (founder nonself; commander only current scout).
  - `member.restore`: `member_id` (founder only, restores scout; user policy answer may amend).

### Presence and state

- POST `organizations/<id>/presence/` `{connection_id:UUID}` enters/renews; return `{connection_id,online_count,capacity:100,lease_seconds:60}`. Max four active connections/account/board, count distinct account. Atomic admission, expires after60s, rate bounded. No implicit restore on revoked membership.
- DELETE same path `{connection_id}` releases only owned connection.
- GET `organizations/<id>/snapshot/?connection_id=<UUID>` requires own live lease → below.
- A map/search request needs active organization membership, not an extra room approval. A successful membership approval alone must not admit a101st live state subscriber.

Snapshot:
```json
{"organization":{"id":1,"name":"北境联合"},"role":"founder","user_id":1,"permission_version":1,"scope":{"region_ids":[10000001],"border_hops":1,"version":1},"forces":[],"reports":[],"online_count":1,"capacity":100,"online":[],"server_time":"ISO8601"}
```
`online` only exists for founder/commander. Scouts get all enemy forces and only own reports. Never send friendly fields/counts/history. Stable keys on forces/reports: `id,version,system_id,system_name,people,ships,notes,observed_at,updated_at`; forces also `name,side`; reports also `author_id,author_name,status` (`pending|confirmed|corrected`). Friendly forces need no report source. Response includes server_time for staleness but transport compares state excluding volatile clock.

### Commands requiring live lease

Include `connection_id` as well as `request_id` on report/force/scope commands.

- `report.create`: `system_id,people,ships,notes,observed_at`.
- `report.update`: `report_id,expected_version` plus same content; author only; preserve revisions and adoption baseline.
- `report.confirm`: `report_id,expected_version,name,force_id?` (founder/commander); new enemy force or explicitly replace current estimate in existing enemy force. Existing force requires `force_expected_version`; duplicate confirmation cannot create a second force. Preserve source report revision, no automatic summing.
- `force.create`: `name,side,system_id,people,ships,notes,observed_at` (founder/commander).
- `force.update`: `force_id,expected_version` plus content (founder/commander); validates all fields. Side change filters subsequent reads, no private history in scout projection.
- `force.move`: `force_id,expected_version,destination_system_id,kind:gate_move|correction,reason?`; correction requires reason; gate move only true adjacent edge. Preserve `observed_at` and counts; move same stable ID.
- `force.archive`: `force_id,expected_version` (founder/commander), returns `{id,version,archived:true}`. Exclude from live state but preserve source revisions/audit; archived forces cannot be edited/moved/adopted again.
- `scope.update`: `expected_version,region_ids,border_hops:0|1|2` (founder/commander).

### Static local map

- GET `organizations/<id>/map/` → `{systems:[{system_id,zh_name,name,x,y,z,security_status,constellation_id,region_id}],stargates:[{system_id,destination_system_id}],regions:[{region_id,zh_name}],constellations:[{constellation_id,region_id,zh_name,x,y,z}],boundary_exits:[{system_id,destination_system_id,destination_name}],scope}`. Only chosen regions+hop closure; no all-graph response. Empty scope returns empty graph and prompts choose region, not full universe.
- GET `organizations/<id>/catalog/?kind=regions` → `{results:[{id,name}]}`.
- GET same `?kind=systems&q=...` → `{results:[{id,name,security_status,region_name}]}`, bounded search. Static lookup can use complete DB without returning it to client.

### WebSocket

Path `/ws/tactical/<org_id>/`. Allowlisted Origin required. First client frame within5s: `{type:"authenticate",token:<accessJWT>,connection_id:<UUID>}`. No token in URL. Reject oversized frames; admit through the same database presence function. Authenticated server frames `{type:"snapshot",data:<snapshot>}`, `{type:"error",detail,code?}`. Client heartbeat `{type:"ping"}` every20s renews live lease; token expiry/revocation closes channel, frontend reacquires token through existing authenticated HTTP flow and reconnects. Do not auto-submit unsent commands on reconnect. Full sanitized snapshot recovery is deliberate for V1.

## Development acceptance

Transport/roster refinements: a server-generated socket generation supersedes any old physical connection for the same logical tab, without deleting its lease on disconnect. Roster includes `connection_status` and `last_reported_at`; scouts still receive no roster. Browser HTTP heartbeats also renew the lease. Refer to the runtime record for ordering and deployment limitations; server emits snapshots and close codes, not a separate error-frame protocol.

Baseline190 backend tests (one existing Windows skip) and65 Node tests pass. Real MySQL is unavailable until an isolated test service is provisioned; Docker daemon is currently stopped. Do not report SQLite as MySQL concurrency proof. Target100 unique live accounts for10 minutes with explicit role-filter assertions,101st rejection, duplicate-tab accounting, command-to-visible-state p95 under2s locally, and no application errors. Targets are not measured results.
