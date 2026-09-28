# Tactical usage verification — 2026-09-28

## Scope

Owner-only read-only aggregates, on branch `codex/tactical-readonly-overview` based on `bbbcc5f24`. No production access, migration, account grant, push, merge or deployment was performed. The existing user's email is checked only by the backend; no email is embedded into the frontend bundle or supplied as an authorization parameter.

## Automated verification

- `python manage.py test TacticalCollaboration.tests.test_usage --settings=EVE_MDjango.ci_settings --noinput`: 21 passed, after observing missing-endpoint failures before implementation.
- `python manage.py test TacticalCollaboration --settings=EVE_MDjango.ci_settings --noinput`: 178 passed.
- `python manage.py makemigrations TacticalCollaboration --check --dry-run --settings=EVE_MDjango.ci_settings`: no changes.
- `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs`: 390 passed. The six new usage API tests first failed for the missing implementation and then passed.
- Existing shell navigation, authorization, responsive-shell and market-focus-terminal Playwright suites: 20 passed using the isolated local Vite port 4198 with synthetic API fixtures.
- Production frontend build and bundle-size gate passed; no new dependencies.

Backend tests verify anonymous and unrelated users/admins/superusers are denied; fresh account deactivation/email changes and ambiguous owners fail closed; forged/invalid JWT claims cannot grant access; GET-only methods and private/no-store responses; distinct counts, removed/pending members, explicit operation allowlist, UTC/Shanghai/naive time boundaries, future-record exclusion, zero data, no private metadata and SELECT-only fixed-count queries without legacy board backfill.

## Browser verification

Browser CLI against local Vite port 4197 with synthetic fixtures (not production accounts or real usage numbers):

- Authorized page and navigation, number cards and period table.
- Desktop 1440 px and mobile 390 px; no document horizontal overflow. The compact mobile table shows all four columns for the fixture.
- Failed requests clear prior figures; retry recovers. Empty results are differentiated from failures.
- Switching account while an overview is pending aborts/fences the old result and hides private navigation.
- Overview authorization loss clears both summary and navigation; logout redirects to login.
- Requests are GET reads only; no analytics writes.

Independent spec review found a capability-denial race: a successful overview could remain visible when a separate permission response returned false. Reproduced both response orders as failures. Fixed with account-scoped denial plus persisted Outlet authorization state (covers lazy page mounting), abort and stale-response fencing. Both orders now pass. Eight other synthetic browser scenarios still pass.

Evidence retained locally under `output/playwright/tactical-usage/`: `verify-ui.js`, `verify-revocation.js`, `desktop.png`, `mobile.png`. Screenshots contain explicitly synthetic QA data. These scripts use `playwright-cli run-code --filename ...`; they are local verification evidence, not added CI specs.

## Boundaries

- Backend verification used isolated SQLite, not production MySQL. The deployment pipeline remains responsible for release integration checks.
- Existing retained operation logs are the only usage source. No historical visitor counts, website registration attribution, or reliable pirate-board online counts are implied.
- No full frontend E2E sweep was run in this request; the 20 selected regressions and the separate new-page browser checks are the verified scope.
