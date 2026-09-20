# Corporation stability and release checks

## Approved scope

The user selected the five confirmed review defects and automated release checks only.
Work stays on `codex/community-corp`; no push, deployment, SSH, production migration,
backup execution, thumbnail feature, cleanup or new product module is authorized.

## Design

1. Bind authenticated requests and refresh single-flight operations to the originating
   session. Logout/account changes invalidate outstanding results. Neither late success
   nor late failure may overwrite/clear a newer session; an old request must not retry
   a mutation under another account. Preserve normal refresh deduplication and FormData.
2. Give the editor an explicit saved baseline. Update management query cache on save,
   preserve dirty input on background data/errors, show a conflict when a different
   server version arrives, and allow an explicit safe resolution. Do not change
   expected-version enforcement or pending immutability. Protect leaving dirty drafts.
3. Store each new ownership claim's proposed identity separately. Approval of an unowned
   corporation adopts the approved claim, within the existing lock order. Historical
   claims without a snapshot retain known identity; no invented backfill. Private review
   shows what is being approved. Migration is additive and local-only.
4. Invalidate public list/detail queries following approval/visibility changes. Hidden
   details must no longer survive in the acting browser's fresh query cache. This does
   not promise revocation of downloaded content or remote browsers' existing displays.
5. Reject lone Unicode surrogates consistently before persistence in all text fields.
   Normalize malformed historical display text without mutating stored revisions; keep
   JSON errors readable and never poison a complete list with one malformed string.
6. Add Node unit/preview, preview-browser, and Community QA safety tests to the existing
   CI release gate. Retain failure artifacts. Add candidate storage configuration
   preflight before switching, and a generic readiness probe running under the actual
   backend service identity after switching. No path/credential details in public health
   responses. Existing rollback and migration gates remain mandatory. No automatic mkdir,
   chmod, migrations or writes to user media. Read-only permission checks do not prove
   SELinux or actual disk writes; Linux/runtime rehearsal remains a release requirement.

## Verification

Regression-first tests must reproduce each defect. Run isolated Django tests, additive
migration checks, Node tests, focused/full browser regression, preview workflows, release
safety tests and build. Independent spec review then quality review must close findings.
Record Windows/Linux and SQLite/MySQL limitations honestly. Server publisher installation
is an explicit future step: CI cannot silently replace the root-owned installed release tool.
