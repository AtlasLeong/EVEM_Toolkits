# Corporation MVP API contract

Base `/api/community/`. JSON keys use snake_case. All private responses (including errors) use `Cache-Control: private, no-store` and `Vary: Authorization`. JWT identity is resolved server-side. Numeric IDs, ISO time strings, 20-result pagination `{count, results}`. Invalid input 400, anonymous 401, denied staff access 403, private enumeration 404, stale/conflicting operations 409, quota 429.

## Public

- `GET corporations/?q=&activity=&page=1`: only listed corporations with approved published_revision. `q` searches approved name/short name, activity is one of allowed values.
- `GET corporations/{id}/`: same whitelist as list plus full approved content. Missing/unpublished/unlisted all 404.
- `GET corporations/{id}/media/{asset_id}/`: only media referenced by current published revision and still listed; otherwise 404. Transcoded safe image bytes, nosniff; not a static path.

Public corporation object: `{id, name, short_name, published_at, revision: {id, ...content}, logo_url, cover_url}`. Never owner/applicant IDs, claim private contact, review reason, storage_name or draft metadata.

Content fields: `tagline` (80), `introduction` (5000), `alliance` (80), `base_region` (80), `activities` (max 6 enum values: pvp, pve, industry, exploration, mining, training), `active_time` (120), `recruitment_status` (open/closed), `requirements` (1500), `benefits` (1500), `public_contact` (200), `logo_asset_id` / `cover_asset_id` (nullable integer), `event_title` (80), `event_time` / `event_location` (120), `event_description` (800). Fields optional in drafts; introduction and public_contact required on submission. Identity name/short_name is fixed by approved claim, not silently changed in a revision.

## Application and management

- `GET capabilities/`: login `{can_review}` from live staff flag.
- `GET mine/`: login `{claims: [...], corporations: [...]}`; owned corporation identity + published/draft status, claims applicant-only. Bounded list; provide pagination if needed.
- `POST claims/`: `{request_id, name, short_name, statement, contact}` for create; or `{request_id, corporation_id, statement, contact}` for existing unowned corporation. Name max80, short_name max20, statement1000/contact200 private and required. Trim/NFKC/casefold identity on server, unique SHA256 name key avoids collation ambiguities. Existing same normalized unowned name may be claimed; already owned refuses takeover. Repeat request_id + same canonical payload returns original, different content409. At most one pending claim per user/corporation and persistent daily limit.
- `GET claims/{id}/`: applicant/staff only; claim includes nested corporation identity and decision fields.
- `GET corporations/{id}/manage/`: owner/staff only; `{id,name,short_name,is_listed,published_revision,working_revision,can_edit,can_review}`. Revision includes content, status, version, timestamps, review_reason, private asset URLs. Staff read does not grant owner editing.
- `POST corporations/{id}/draft/`: owner `{request_id}`; copy current approved/rejected/withdrawn content or blank initial. Existing draft returns it, pending409. One working pointer under corporation row lock. Return revision.
- `PATCH revisions/{id}/`: owner draft `{expected_version,...content}`; fields whitelist, asset ownership checked, increment version. Old version409. Return revision.
- `POST revisions/{id}/submit/`: owner `{expected_version}`; validate publish-required fields, set immutable pending, version increments. Return revision.
- `POST revisions/{id}/withdraw/`: owner `{expected_version}`; pending -> withdrawn only, leave public pointer untouched.
- `POST corporations/{id}/media/`: owner multipart `{request_id,file}`; PNG/JPEG/WebP <=5MiB/20MP, no SVG/animation; sanitize orientation and metadata, bounded dimensions/bytes, random private path. Return `{id,width,height,size,content_type,private_url}`. Finite per-corporation and daily quotas; compensate file if DB commit fails.
- `GET media/{id}/private/`: owner/staff only. Uploaded content immutable; existing application does not grant upload rights before ownership approval.

## Review

- `GET reviews/?kind=claims|revisions&page=1`: staff-only pending queue, `{count,results}`.
- `GET reviews/{kind}/{id}/`: staff detail with submitted content/private images; never reuse mutable owner draft for review.
- `POST reviews/claims/{id}/decision/`: staff `{decision:approve|reject,reason}`. Lock corporation and claim; pending only; approve verifies owner still null then assigns applicant. Reject requires reason. Both persist reviewer/time/reason, never auto-publish.
- `POST reviews/revisions/{id}/decision/`: staff same decision payload; pending working revision only; approve atomically sets published_revision. Do not modify content, overwrite draft, or reapprove old versions. Reject reason required.
- `POST corporations/{id}/visibility/`: staff `{is_listed,reason}` with nonempty reason and latest moderator/time/reason persisted; hide page and public media together. Default listed=true still does not expose without approved content.

## Invariants and client behavior

Always user-row (if needed) -> corporation-row -> claim/revision-row locking. DB unique keys plus row locks, not unsupported partial unique indexes. Default DB only. No remote URL fetching or accepting raw HTML. Private media not under `/static/uploads/`; runtime setting COMMUNITY_UPLOAD_ROOT must explicitly reference a private shared directory, no unsafe default.

Client routes `/corporations`, `/corporations/:id`, `/corporations/manage`, `/corporations/review`. Navigation 军团大厅. Public data fetched without auth; private queries keyed by stable user identity, discard on logout/account switch. Error/retry does not become fake empty state. Draft workbench edits the content fields; fixed posters use these same fields, no unreviewed free-form override disguised as approved. Watermark draft/pending/rejected/withdrawn previews and exports 未审核; approved public payload produces clean poster. All three layouts await fonts and controlled image blobs; failure prevents silent incomplete export.

Key acceptance tests: no unapproved leak; foreign ownership/media404; staff-only reviewer; UUID retry; two contenders for same claim; stale draft versions; pending immutable; old public stays while editing/rejected; duplicate approval cannot regress pointer; malformed/animated/oversize upload; EXIF stripped; private bytes no-store; long Chinese/poster and mobile overflow; actual MySQL migration/locking rehearsal prior to release.
