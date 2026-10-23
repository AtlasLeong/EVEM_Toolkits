# First-stage performance improvements

Approved by the user on 2026-10-23 after the production/repository audit: implement resource compression, smaller logo assets, manufacturing catalog reuse, and bounded batch quote reads; test, push, merge and deploy through the existing release channel.

## Scope and decisions

Keep React, React Query, Django/MySQL and the current collection architecture. Do not alter collection cadence, account material, leases, cooldowns, permissions, database schema, dependencies, or the protected publisher. The alternatives of raising concurrency/rate limits or adding general-purpose cache infrastructure do not address the request amplification and are out of scope.

1. Add `GET /api/market/quotes/?ids=...`, with at most 50 submitted positive signed-64-bit decimal IDs, bounded input length and deduplication. Repeated/unknown query parameters and malformed IDs fail with 400. Only enabled, exact-ID matches are returned as `results`, with existing item/quote projection and market scope. Disabled/unknown IDs remain absent; no game RPC or write is permitted. Retain the existing public-read switch, JWT/account checks, `market_public` scope/rate, old item/list/history routes and per-item timestamp/empty/stale semantics. The manufacturing adapter uses batches of 50 and preserves cancellation, normalized missing items and all-or-nothing refresh behavior. No automatic fallback to 50 individual requests on errors.
2. Keep the public manufacturing catalog URL and JSON contract. Load through React Query with a stable public query key, one-hour stale/gc limits, the query cancellation signal and normal HTTP revalidation (`no-cache`, not `no-store`). Reuse successful data across route changes; do not cache errors indefinitely. A document refresh/new application instance revalidates against current deployment; no service worker or localStorage cache is introduced.
3. Mechanically derive small PNG assets from the existing brand image (not a redesigned logo): 32px favicon, 96px navigation mark, 180px touch icon. Preserve the original URL for older pages. Include a reproducible Sharp preparation script using the existing dependency, pixel/dimension/size tests, and updated HTML/navigation references. Generated binary derivatives are build assets, not hand-edited artwork.
4. Enable moderate gzip only inside explicitly public static asset/catalog locations, preserving immutable asset headers and catalog revalidation. No broad `/api/` or server-wide gzip/cache change. Add a conservative, tested configuration preparation/activation helper if needed; root-owned Nginx configuration is a separate operator step, never installed by CI. Before activation verify exact current config/digest, preserve an owner-private backup, validate with `nginx -t`, reload gracefully, and verify gzip/identity and private boundaries. Failure restores the exact previous configuration. Do not touch TLS, proxy authentication, media, WebSocket routing, publisher or collector settings.

## Success criteria

- A 48-leaf manufacturing quote refresh makes one bounded stored-data API request, with unchanged pricing and missing-data semantics.
- Reject malformed/oversized batch inputs before querying; constant query work per batch; old clients remain compatible.
- Re-entering manufacturing reuses the catalog; failed/aborted loads remain recoverable, and fresh document loads use HTTP validators.
- Small logo assets replace the 404,726-byte image in normal navigation/favicon requests without changing branding/layout.
- Actual public JS/CSS/catalog responses negotiate gzip, identity remains valid, existing compressed responses are not double-compressed, and private authorization/cache headers remain unchanged.
- Local targeted and full relevant tests, production build/bundle budget, PR/master CI and production publishing pass. Real browser and exact-version online checks follow publication.

## Risks and rollout

Backend and frontend can briefly run different versions during the existing component switching sequence; do not change that protected publisher. The additive endpoint preserves old frontend compatibility. If a new frontend reaches an old backend momentarily, retain old quotes and show the existing recoverable error instead of firing individual fallbacks. No migrations/dependency registration are required. Keep the operational worktree and private/untracked materials intact.
