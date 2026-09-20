# Isolated Community MySQL rehearsal

`mysql_qa.py` is a **manual, opt-in QA tool**, not a deployment/migration command
for the business database. Review the script and obtain explicit execution
authorization before using `--execute` on a server.

## Safety boundaries

- Default invocation prints a plan/source digest only. It does not read credentials
  or establish a network connection.
- Execution requires `--execute` and `--confirm-new-database` equal to the exact
  `--database` value. Names must match `evem_community_qa_[a-z0-9_]{12,40}`.
- A server-level MySQL connection selects **no database**, checks the schema name
  in `information_schema`, and creates that one new schema. Existing names are
  rejected; no reuse, no `DROP DATABASE`, no reverse migrations.
- Only `DB_NAME/DB_USER/DB_PASSWORD/DB_HOST/DB_PORT` are read from the live backend
  `.env` or environment. `.env` takes precedence, matching deployed settings.
  Production Django settings are **not imported or executed**. Credentials never
  appear in command-line arguments, emitted plans, reports, or exceptions.
- Candidate and live backend paths must be distinct. A fresh isolated Django
  configuration registers only `default`, explicitly mapped to the QA schema for
  both `NAME` and `TEST.NAME`. Every worker verifies aliases and `SELECT DATABASE()`.
- Only auth/contenttypes/Authentication/Community forward migrations are allowed.
  Real `Authentication.EVEMUser` is used, including its unique email/collation.
- The API suite runs on the already-created QA schema without Django runner
  setup/teardown-database methods. No live deployment switch, service restart,
  business table query/write, or database cleanup is performed.

## Plan, review, then execute

Use actual candidate paths and a fresh random QA suffix. The following example is
**plan-only**:

```text
python scripts/community/mysql_qa.py --candidate-backend /private/candidate/backend --live-backend /EVEMTK/deploy/current/backend --database evem_community_qa_0123456789abcdef
```

After reviewing the candidate/source digest and obtaining approval, add
`--execute --confirm-new-database evem_community_qa_0123456789abcdef` to that exact
invocation. Do not reuse the example name after it has already been created.

Exit code 0 means all requested checks passed; 1 means a test/rehearsal failed;
2 means the run aborted. Reports include only stage names, synthetic status codes,
test IDs, fault classes and numeric MySQL error codes. Driver error messages and
SQL payloads are intentionally suppressed. Keep the emitted new QA schema name
for inspection; a later cleanup requires a separate reviewed/authorized action.

## What it exercises

1. Actual MySQL 8/InnoDB migrations plus the whole `Community.tests` API suite.
2. Upload → private before approval → public after approval → hidden after removal.
3. Two concurrent ownership approvals: one 200, one 409, exactly one assigned owner.
4. Two PATCH requests with the same version: one 200, one 409, version advances once.
5. Three deliberately interleaved user/corporation lock cases: applicant ownership
   FK, content-reviewer FK, and visibility-moderator FK. One worker holds the
   actor user row while submitting a claim; the other performs the corresponding
   moderation update. SQL execute wrappers coordinate **after real locks**, and
   preserve the real FK statements. MySQL 1213 or 1205 is captured as a failure.

The lock harness waits at most two seconds for the old corporation-first pattern;
that wait is only coordination, not a pass/fail requirement. A corrected
users-first implementation can let the claimant finish before moderation proceeds
without the harness itself creating a false deadlock. DB lock waits are bounded
to five seconds and worker rendezvous/future waits are bounded.

Database deadlock failures must be reported and inspected, not masked with retries
or silently treated as passing. Temporary QA image files are removed when the run
ends, while the QA database intentionally remains for evidence. Its synthetic
media rows therefore are not intended to be a long-lived preview site.

## Local safety tests (no database)

```text
python -m unittest discover -s scripts/community/tests -v
```

These tests cover schema allowlists, alias/test-name rejection, opt-in confirmation,
credential allowlisting, plan-mode non-access, and the database-less CREATE
connection. They do **not** substitute for actually executing MySQL QA.
