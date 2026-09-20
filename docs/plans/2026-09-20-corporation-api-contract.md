# Corporation MVP API contract

Base `/api/community/`. JSON keys use snake_case. All private responses (including errors) use `Cache-Control: private, no-store` and `Vary: Authorization`. JWT identity is resolved server-side. Numeric IDs, ISO time strings, 20-result pagination `{count, results}`. Invalid input 400, anonymous 401, denied staff access 403, private enumeration 404, stale/conflicting operations 409, quota 429.

## Public

- `GET corporations/?q=&activity=&page=1`: only listed corporations with approved published_revision. `q` searches approved name/short name, activity is one of allowed values.
- `GET corporations/{id}/`: same whitelist as list plus full approved content. Missing/unpublished/unlisted all 404.
- `GET corporations/{id}/media/{asset_id}/`: only media referenced by current published revision and still listed; otherwise 404. Transcoded safe image bytes, nosniff; not a static path.

Public corporation object: `{id, name, short_name, published_at, revision: {id, ...content}, logo_url, cover_url}`. Never owner/applicant IDs, claim private contact, review reason, storage_name or draft metadata.

Content fields: `tagline` (80), `introduction` (5000), `alliance` (80), `base_region` (80), `activities` (current enums below, plus retained legacy `pvp` only), `activity_description` (optional string, 1500 Unicode code points), `custom_activity_tags` (up to 5 strings, rules below), `active_time` (120), `recruitment_status` (open/closed), `requirements` (1500), `benefits` (1500), `public_contact` (200), `logo_asset_id` / `cover_asset_id` (nullable integer), `event_title` (80), `event_time` / `event_location` (120), `event_description` (800). Fields optional in drafts; introduction and public_contact required on submission. Identity name/short_name is fixed by approved claim, not silently changed in a revision.

### Structured base location and security snapshots

`base_location` is nullable revision content. PATCH accepts only `{region_id, constellation_id?, solarsystem_id?}`: IDs are nonempty, unpadded strings up to 255 characters; region is required, constellation requires its region, and solarsystem requires its constellation. The server checks existence and all parent relationships against the trusted star-field catalogue. Client-supplied names, `security`, any per-level security property (even null), or other unknown location properties produce a field-specific 400 without changing content or version.

The server stores and returns this immutable display snapshot in management, review and public revision payloads:

```json
{
  "region_id": "r1", "region_name": "德里克", "region_security": 0.5,
  "constellation_id": "c1", "constellation_name": "艾玛边境", "constellation_security": 0.3,
  "solarsystem_id": "s1", "solarsystem_name": "西卡塔", "solarsystem_security": -0.22,
  "security": -0.22
}
```

Each level's security comes from that level's own catalogue row and is a finite JSON number or null; zero and negative values are valid. Missing, invalid or nonfinite catalogue values become null, never an invented zero. The retained legacy `security` field is the deepest selected level's value, including null, not the deepest non-null value. Unselected levels have null ID, name and per-level security. A linked `base_region` is derived from the snapshot's region name. Explicitly clearing `base_location` clears its derived region text, while a legacy text-only region remains unless explicitly replaced.

Reads are query-free and never rewrite raw revision JSON or refresh historical names/security after catalogue changes. For older snapshots missing the new properties, only the deepest selected level may inherit legacy `security`, and only when that level's property is absent. Explicit null must not fall back; missing ancestor securities remain null. Invalid optional per-level values (including booleans, numeric strings and nonfinite values) normalize to null without discarding otherwise valid IDs/names. Existing malformed legacy `security` behavior is unchanged: the location normalizes to null and legacy `base_region` text remains available.

Re-saving ID-only location input resolves fresh per-level values for that working revision. New drafts, edits, submissions and rejections never change the approved published snapshot or its raw JSON; publication still changes only through approval. No schema or data migration is required.

### Activity overview and legacy compatibility

Current `activities` values and labels:

- `sovereignty_production`: 主权生产
- `pirate_combat`: 海盗作战
- `pve`: 异常与任务
- `industry`: 工业制造
- `exploration`: 星海探索
- `mining`: 采矿生产
- `training`: 新人培养

All seven may be selected once each. Legacy `pvp` (舰队作战) is readable but is not a new selection: PATCH may retain it only if the locked working revision already contains `pvp` in its stored activities array. Once removed, it cannot be added back to that draft. No automatic mapping to the two new categories occurs. `?activity=pvp` remains valid; each current filter matches only its own stored key. Custom tags are not enum values and never enter `activity_keys` or filtering. Even all seven current keys plus legacy `pvp` fit the existing 100-character index field.

`custom_activity_tags` defaults to `[]`. Writes require an array with at most 5 string items; after trimming each display string must contain 1–12 Unicode code points. Empty/invalid items, duplicate comparison keys, and names matching any current Chinese label or either old label 舰队作战 / 舰队作战（旧标签） are rejected with a field-specific 400. Comparison uses Unicode NFKC then casefold (so the half-width-parenthesis spelling 舰队作战(旧标签) is also reserved), while stored/display text retains its original spelling after trim. Control characters (`Cc`), invisible format characters (`Cf`), and line/paragraph separators (`Zl`/`Zp`) are rejected even at the edges before trimming. Invalid writes are never silently truncated; rejected PATCH leaves content and version unchanged. Historical custom tags matching these reserved labels are omitted on read without mutating the stored snapshot.

Both new text fields also reject unpaired Unicode surrogates before persistence, so JSON escape sequences cannot commit content that later fails UTF-8 rendering. Historical custom tags with these invalid characters are omitted on reads; malformed activity-description strings read as empty text without changing the raw snapshot or its overview kind.

New revision defaults include `activity_description: ''`. All public, management and review revision payloads include read-only `activity_content_kind: 'overview' | 'legacy_event'`, computed from whether the raw stored JSON contains the `activity_description` key, before defaults are applied. Missing key means `legacy_event`; an existing key, including explicitly empty text, means `overview`. Clients must never use a truthy-value fallback from empty overview text to `event_description`, and must not include the computed kind in PATCH.

Historical `event_title`, `event_time`, `event_location`, and `event_description` remain supported and are preserved verbatim unless explicitly edited. Creating a draft from an old snapshot copies its raw JSON without adopting the new field automatically. A new form save can adopt overview by explicitly writing `activity_description`. Read normalization returns safe bounded activities/tags, converts malformed description to empty text, and does not modify historical JSON or migrate records. No schema/data migration is required.

Both new fields use the existing expected-version, immutable-pending, staff-review and published-pointer workflow. Draft and pending activity text/tags are private. An older approved public snapshot (including legacy event content) stays unchanged until a new revision is approved; rejection never advances that pointer.

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
