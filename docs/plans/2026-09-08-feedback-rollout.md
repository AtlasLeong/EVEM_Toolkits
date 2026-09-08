# Feedback center release record

## Approved scope

Private customer feature suggestions and problem reports; staff handling, replies/status; private PNG/JPEG/WebP/PDF/TXT/LOG uploads and authenticated downloads. Includes approved dark-console UI, calculator entry refinements, and white transparent avatar. User explicitly approved production release and subsequently requested attachments.

## Validation before publish

- Frontend full regression: **111 passed**, `npm run test:e2e -- --workers=2`; production build passed.
- Backend isolated SQLite: **61 passed**, including existing License/ActivationCode/deployment checks and Feedback tests. Migration drift check passed.
- Deployment unit tests: **29 total, 24 passed / 5 Linux-only skipped on Windows**. The production CI reruns all on Linux.
- Independent spec review: no blocking feature gap. Added missing pagination, double-click and partial attachment retry E2E coverage.
- Independent quality review: fixed malformed PNG CRC handling (400, not 500), and private no-store/Vary Authorization on all feedback responses. Re-review passed.
- Browser QA: `../design/feedback-center-preview.png`, `../design/feedback-detail-preview.png`; real desktop rendering and all supported desktop widths checked.

## Production preparation — 2026-09-08

- SSH verified with previously trusted host key; current service runs as nginx; SELinux was already Disabled (not changed).
- Previous live frontend/backend: `8ce32e1a7d1b38e5ce4dcf2366549825606f33e2`.
- Candidate backend for migration: reviewed `817e235`; unpacked separately at `/EVEMTK/deploy/feedback-preflight.kGeK4t/backend`. Current release not overwritten.
- MySQL 8.0.37, existing auth table and default storage engine InnoDB.
- Isolated real-MySQL rehearsal database: `evem_feedback_qa_ac3c3fffa2fb`. Migrated latest actual `Authentication.EVEMUser` plus Feedback; owner/staff/attachment privacy smoke passed. 25 parallel same-account creates produced exactly 20 successes + 5 rate-limit responses. Each worker asserted its database was the isolated QA database. QA schema retained; disposable test attachment files removed; no production customers created.
- Private default-database backup: `/EVEMTK/deploy-backups/20260908-feedback/default-before-feedback.sql`, 27,154,124 bytes; SHA256 `1f5dd7fe287c500d7e1828378fe0d67d13a913f08089a4d7f767456c0b38570e`. Dump completion/footer and digest checked, metadata binds database identity and freshness. Backup not exported from server.
- Config backups in the same private directory: `backend.env.before`, `evemtk.conf.before`.
- Added `FEEDBACK_UPLOAD_ROOT=/EVEMTK/deploy/shared/feedback-uploads`, owned by nginx, mode0700, outside all public aliases. Files0600. Service user write access checked.
- Added only `/api/feedback/` Nginx location with 11m request cap and existing proxy headers/upstream, preserving full URI. `nginx -t` and reload passed; existing business locations unchanged. Backend not restarted during preparation.
- Applied only `Feedback.0001_initial` and `Feedback.0002_feedbackattachment_and_more` after backup/digest verification. Final Feedback plan empty; no existing app migration, fake, drop or reverse migration.
- Existing homepage/version and backend service remained healthy after preparation.

## Publish

Pending final master push / production workflow and live SHA verification. Do not treat this preparation record as proof that the feature is live.

## Recovery boundaries

Use existing GitHub Production rollback to restore previous frontend/backend code if needed. Additive feedback tables and private uploaded files remain; never reverse migrations or delete submitted customer feedback during code rollback. Original environment/Nginx files backed up separately. No Python production dependencies or existing release scripts changed.

Attachments are type-validated, not antivirus-scanned. Executables, archives, SVG and HTML are rejected. Storage currently has per-ticket/account-rate limits, not an automated retention policy; review disk usage operationally as usage grows. Existing desktop-only layout remains in effect.
