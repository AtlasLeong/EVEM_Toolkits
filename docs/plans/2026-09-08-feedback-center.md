# Feedback Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Current-session execution uses superpowers:subagent-driven-development.

**Goal:** Ship a private customer feedback center and the approved dark-console UI to production.

**Architecture:** React feedback page in the existing shared shell; JWT-authenticated Django REST endpoints and two additive tables in the default database. Owners see their own tickets; existing `is_staff` users can manage all tickets. No new role grants, attachments, public feedback, third-party forwarding, or automatic database migrations.

**Tech Stack:** Existing React/React Query/Lucide/CSS, Django/DRF/MySQL, isolated SQLite tests, Playwright, existing verified GitHub production release pipeline.

## Approved design

User approved the proposed scope on 2026-09-08 ("k有的", interpreted as assent): sidebar entry; feature suggestions/problem reports with module/title/description and optional contact; own feedback history; staff replies and status updates; customer follow-up; privacy and submission limits; release together with calculator-entry and white-avatar refinements.

Statuses: pending / processing / completed / declined. Types: feature / bug. Modules: planetary / starmap / fraudlist / account / other. Content is plain text. No attachments. Private details are not logged or placed in URLs. Existing `is_staff` is the authorization source.

## API contract

- `GET /api/feedback/?scope=mine|all&type=&status=&module=&page=1`: `{count,results,can_manage}`; page size 20; all requires staff. Ticket fields: id, type, module, title, description, contact, status, author_name, created_at, updated_at, reply_count.
- `POST /api/feedback/`: `{request_id: UUID,type,module,title,description,contact}` -> ticket detail (201, or 200 idempotent replay).
- `GET /api/feedback/<id>/`: ticket plus `comments: [{id,body,author_name,is_staff,created_at}]`.
- `PATCH /api/feedback/<id>/`: staff only `{status}` -> updated detail.
- `POST /api/feedback/<id>/comments/`: owner/staff `{request_id: UUID,body}` -> detail. No user-supplied author/status accepted.
- Limits: title 120, description 5000, contact 200, comment 3000 characters. Persistent per-account rate limits under database transaction/user row lock (20 tickets/day, 60 comments/hour); request IDs unique per author; reject reusing IDs with different content. Unknown owner ticket -> 404; unauthenticated -> 401; nonstaff all/status -> 403; malformed -> 400; rate exceeded -> 429 with Chinese explanation. Bounded comment history (100 max per ticket).

## Task 1: Backend and tests (independent implementer)

Files: create `backend/Feedback/{apps,models,serializers,views,urls,tests}.py`, migrations; update `backend/EVE_MDjango/{settings,urls,ci_settings,ci_urls}.py` and `.github/workflows/ci.yml`.

1. Write failing API tests for create/list/detail/comment/status, auth/ownership/staff, pagination/filter, invalid input, rate limit and idempotency.
2. Run isolated tests and record expected missing API/model failure.
3. Implement two managed models (ticket/comments) with swappable auth foreign keys and additive initial migration. Keep License router untouched; Feedback stays in default database.
4. Run `python manage.py test Feedback License ActivationCode EVE_MDjango.tests_deployment --settings=EVE_MDjango.ci_settings --noinput` and migration drift checks. CI must include Feedback tests.
5. Self-review, then independent spec and code review; commit only owned files after passing.

## Task 2: Frontend and tests (main agent)

Files: create `front-codex/src/pages/Feedback.jsx`, `src/services/apiFeedback.js`, `tests/e2e/specs/feedback.spec.js`; update `src/App.jsx`, shared `AppShell.jsx`, `src/styles.css`, isolated preview fixtures.

1. Write failing E2E tests for guest login guidance, create errors/success, own list/detail/follow-up, admin status/reply, filters/pagination, double-submit and empty/error states.
2. Run `npm run test:e2e -- tests/e2e/specs/feedback.spec.js --workers=2`; confirm missing entry/page failures.
3. Implement unified console page with new feedback form, history list, inline detail panel and server-confirmed admin tab. Preserve form text on errors; retain request IDs on retry; reset only after confirmed success or changed payload. Cache scoped by user and clear detail on scope change. Render plain text with safe wrapping; label every input.
4. Run targeted and full E2E, `npm run build`, browser screenshot QA at desktop widths. No unrelated auth/UI refactoring.
5. Review and commit local changes including already-approved pending avatar/calculator changes.

## Task 3: Release and additive migration (main agent)

Files: rollout record under `docs/plans/`; existing deployment tooling remains unchanged unless a proven blocker requires separate review.

1. Inspect SSH host identity, current production version/service, database migration state and backup tools read-only; do not print secrets/customer rows.
2. Review candidate diff, run deployment tests, backend tests, all frontend tests, build, and migration SQL on isolated MySQL-compatible target before release.
3. Obtain verified committed candidate backend without overwriting current. Prepare private database backup and additive migration plan; stop if any unexpected existing-app migration or destructive SQL appears. Apply only Feedback initial migration on default; no fake migrations or existing data modifications. Preserve feedback tables on code rollback.
4. Merge approved candidate to master only after checks and migration pass, push to trigger existing CI/release. Await workflow success and verify frontend/backend SHA, homepage/assets/API and feedback auth boundary. Do not claim live solely from push success.
5. If failure: existing release rollback mechanism, no table deletion; inspect health. Record evidence, migration/backup locations (without secrets), test counts and any residual limitations.

## Checklist

- [x] Context and approved scope recorded
- [ ] Backend tests / implementation / spec review / quality review
- [ ] Frontend tests / implementation / visual QA / review
- [ ] Full validation and candidate commit
- [ ] Backup and additive migration
- [ ] Production publish and live verification
