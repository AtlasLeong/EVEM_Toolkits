# Market QA Provisioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provision a fresh, narrowly scoped QA MySQL account for Market restore rehearsal without touching the production schema or exposing a password.

**Architecture:** A root-only CLI loads the explicit candidate backend's default MySQL identity, then proves a separate in-process loopback connection reaches the same `eve_echoes` server UUID. A pure provisioning function uses a fakeable DB connection for preflight checks and one `CREATE USER` plus one exact-schema `GRANT`; an exclusively created root-private env file carries the generated credentials and UUID to the restore command.

**Tech Stack:** Python 3.11, Django's existing MySQL settings loader, mysqlclient, unittest.

---

### Task 1: Prove both database connection identities before mutation

**Files:**
- Create: `scripts/deploy/market_mysql_qa_provision.py`
- Create: `scripts/deploy/tests/test_market_mysql_qa_provision.py`

1. Write a fake-connection test requiring both `DATABASE()` values to equal `eve_echoes` and both nonempty `@@server_uuid` values to match. Assert every mismatch causes a safe failure before any `CREATE USER` or `GRANT`.
2. Run `py -3.11 -m unittest scripts.deploy.tests.test_market_mysql_qa_provision -v` and confirm the expected missing-feature failure.
3. Implement identity checking with a strict UUID format and a loopback connection factory fixed to `127.0.0.1:3306`; derive settings only from the explicit candidate backend loader. Reject all identity and connection errors without displaying driver exceptions.
4. Re-run the test and confirm it passes.

### Task 2: Validate the target and provision a fresh exact-scope account

**Files:**
- Modify: `scripts/deploy/market_mysql_qa_provision.py`
- Modify: `scripts/deploy/tests/test_market_mysql_qa_provision.py`

1. Write tests for a direct-child 0700 root-owned backup directory, absent user across hosts, absent QA schema, exact `evem_market_qa_[0-9a-f]{12}` name, >=24-character generated password, and a grant containing literal escaped underscores only for that QA schema.
2. Run the focused tests and confirm the expected failures.
3. Implement fresh-name/password generation with `secrets`, fail-closed preflight queries, `CREATE USER` without `IF NOT EXISTS`, and one database-scoped `GRANT`. Do not create/drop a schema, grant global rights, or mutate `eve_echoes`.
4. Re-run the focused tests and confirm they pass.

### Task 3: Persist private rehearsal environment and quiet CLI

**Files:**
- Modify: `scripts/deploy/market_mysql_qa_provision.py`
- Modify: `scripts/deploy/tests/test_market_mysql_qa_provision.py`

1. Write tests that `market-qa.env` is created exclusively in the validated directory with mode 0600, the four rehearsal keys and expected UUID, and never overwritten. Assert no password/path/driver exception is printed on success or failure; no production connector runs in tests.
2. Run focused tests and confirm the expected failures.
3. Implement env-file creation before account mutation and retention after attempted account creation for manual reconciliation. Add the root-only CLI with explicit `--backend`, `--expected-database`, `--backup-dir`, and `--provision-qa` inputs, and generic output.
4. Run focused tests and existing backup/restore tests, check the CLI help and `git diff --check`, then inspect changed files. Do not commit or push.
