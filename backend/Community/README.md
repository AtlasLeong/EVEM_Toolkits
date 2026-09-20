# Corporation API backend

This app owns only moderated corporation content in the Django **default** database.
The existing free-text `user_corp` value never grants ownership. The raw SWEET data
archive and the license database are not dependencies of this app.

## Release requirements

1. Rehearse `Community.0001_initial` against the deployed MySQL version and real
   swappable user model before applying it to production. SQLite tests do not
   exercise MySQL row locks.
2. Back up the default database before an explicitly authorized migration.
3. Configure `COMMUNITY_UPLOAD_ROOT` as an absolute **private**, persistent shared
   directory readable/writable by the backend service, outside Nginx static roots.
   There is deliberately no default. Missing/unsafe configuration returns 503
   for media operations rather than exposing files through public uploads.
4. Keep that directory across code releases and back it up with the database.
   All access goes through `/api/community/` permission-checked image endpoints.

No restart, migration, production file write, or deployment is performed by tests.

## Limits and response conventions

- Collections use 20 records per page, stable ID/time ordering and `page >= 1`.
- `mine/?page=1` separately pages `claims` and `corporations`; response includes
  `claims_count` and `corporations_count` for independent empty/next-page states.
- Claims: 5 per rolling 24 hours per account (`COMMUNITY_CLAIMS_PER_DAY`).
- Draft request tokens: 100 per rolling 24 hours per account
  (`COMMUNITY_DRAFTS_PER_DAY`). Existing-token retry does not consume a quota slot.
- Images: 30 per rolling 24 hours per account and 100 lifetime per corporation
  (`COMMUNITY_MEDIA_PER_DAY`, `COMMUNITY_MEDIA_PER_CORPORATION`). No unreviewed
  image-delete endpoint is included in the MVP; retaining immutable references
  prevents breaking older review records. Operators must plan retention/cleanup
  before increasing this cap.
- Uploads: PNG/JPEG/WebP, 5 MiB input, 20 million input pixels, single frame only.
  Server rotates EXIF orientation, strips metadata and re-encodes as WebP with a
  2400-pixel maximum edge and a 5 MiB output cap. Uploaded image URLs are never
  accepted from arbitrary remote origins.
- Creation returns 201, idempotent retry or existing draft returns 200.
- Claim UUID fingerprints use the same NFKC/casefold identity as name uniqueness;
  display capitalization remains unchanged after an equivalent retry.
- All URL IDs are positive signed 64-bit values. Invalid ranges return 400 before
  querying the database. Unhandled API errors return sanitized JSON (database or
  storage failures 503, other faults 500) with the same no-store headers; logs
  record the view/exception type, never the exception message or SQL.
- Revisions are flat JSON fields with `id`, `corporation_id`, `corporation`
  identity, `status`, `version`, timestamps, `review_reason`, `logo_url` and
  `cover_url`. Public serialization is a separate allowlist without review/draft
  details. Claim objects contain nested `corporation` identity.
- Images and JSON are `private, no-store`, including public images, so a newly
  hidden corporation or replaced image does not survive in shared caches.
- The explicit UUID request record for drafts ensures an old token cannot create
  a second revision or be reused for another corporation.

## Moderation invariants

An approved ownership application grants editing, **not** public visibility.
Only the current approved published revision of a listed corporation is public.
New drafts, pending edits and rejected edits cannot replace that public pointer.
Submitted content is immutable; withdrawing creates a historical withdrawn
revision, from which the owner can explicitly start a new draft. An administrator
can inspect privately but cannot edit on behalf of the owner. All admin-site
models are read-only; state transitions must use the audited API.

Transactions serialize quota-consuming actions by user row before corporation
row; draft/review record locks are taken after the corporation. MySQL concurrency
rehearsals must cover competing claims, double approval, stale saves and retries.
Storage is compensating rather than distributed-transactional: database failures
remove newly written files. A process/power crash between filesystem save and DB
commit can leave an unreferenced file; operational reconciliation must identify
orphans by comparing storage names with `Community_mediaasset` and never remove
referenced files blindly.

## Test command

```text
python manage.py test Community Feedback License ActivationCode TacticalBoard EVE_MDjango.tests_deployment --settings=EVE_MDjango.ci_settings --noinput
python manage.py makemigrations Community Feedback --check --dry-run --settings=EVE_MDjango.ci_settings
```

The isolated CI settings never import production `.env` values or production DB
connections. The initial migration uses a swappable user dependency so production
can use `Authentication.EVEMUser` while isolated CI uses `auth.User`.
