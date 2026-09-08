# Automated Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace manual dist uploads and backend git pulls with verified, component-aware releases.

**Architecture:** GitHub builds artifacts; a Python 3.10 standard-library publisher validates them and switches version links under an exclusive server lock. Persistent data and dependency environments remain outside releases. Automatic deployment remains disabled until a manual production deployment and rollback rehearsal succeed.

**Tech Stack:** GitHub Actions, Python unittest/tarfile/hashlib, OpenSSH, Nginx, systemd, existing Django/Gunicorn.

## Batch 1 — local implementation, no production changes

1. Add failing tests in `scripts/deploy/tests/test_release.py` for artifact checksums, unsafe paths, reserved data, component fingerprints and rollback. Run `python -m unittest discover -s scripts/deploy/tests -v`, confirm failure, then implement `scripts/deploy/release.py` using only the standard library. Verify the same tests pass. Artifacts must contain tracked backend files, built frontend files, SHA and per-file checksums. Never include env, uploads, logs or venv.
2. Add tested staging/switch logic with injected preflight/restart/health operations. Test frontend-only changes never restart backend, preparation failure never switches, failed health restores both components and verifies recovery, and recovery failure is surfaced. Pending migrations and unregistered dependency hashes must block before switching. No automatic migrations or pip installs in version 1.
3. Add `.github/workflows/ci.yml` and `deploy.yml`, isolated backend test settings, operational docs and server configuration examples. PR builds/tests cannot access production credentials. Manual production runs require master and an initialized server; push deploy additionally requires explicit enablement. Keep full frontend tests blocking (known baseline failures are not waived). Pin official actions to verified commit IDs. Verify local tests, build, YAML and diff.

Review checkpoint (initial plan): report files, tests and unresolved baseline failures. GitHub CLI login was unavailable at that checkpoint. Do not change the live server before this checkpoint and the gates below.

## Batch 2 — reviewed production bootstrap

1. Verify GitHub login/repository permissions, server fingerprint and disk space. Capture config and current-release backups; register existing dependency environment only after comparing pinned requirements and installed runtime. Establish dedicated deploy account/key, restricted sudo for only `evem-backend` restart, and nginx-readable release permissions.
2. Initialize per-component current/previous links and state from actual live files (not inferred git SHA for manually uploaded dist). Preserve original env/uploads/logs and legacy packages. Apply reviewed Nginx/systemd paths once; syntax-check and probe, restoring saved configuration on failure.
3. Configure production environment and SSH secrets; manually deploy tested master SHA, prove exact version health and do a rollback rehearsal. Only then set `EVEM_AUTO_DEPLOY=true`. Document actual deployment SHA, backups and recovery evidence.

## Validation boundaries

- Local License baseline: 9 tests passed before changes. Production databases are never used by CI.
- Existing frontend E2E failures require diagnosis before enabling automatic production rollout.
- v1 blocks database migrations/dependency changes for supervised preparation; it does not claim database rollback or zero downtime.
- No merge, push, production credentials or live service changes in batch 1.

## Batch 1 checkpoint result (historical; superseded by completion below)

- Implemented packer, publisher/rollback core, persistent asset cache, strict SSH transport, two workflows, isolated Django CI settings, process-loaded version probe and operator configuration examples.
- Final local verification: 24 deployment tests passed; 17 isolated Django tests passed; Vite build passed; two workflow YAML files parsed; Bash syntax and git diff whitespace checks passed.
- Full frontend baseline: 72 passed, 5 failed. No frontend business/test files changed. Failed specs: admin-history-report-details (2), admin-reject (1), starmap-more (2). These remain blocking in CI.
- Independent code review reproduced an interruption-after-state-commit bug. Regression first failed, then passed after rollback restored both links and metadata; uncertain recovery retains journal. Added identical-release retry integrity checks and runtime-cache compatibility tests.
- GitHub CLI remains unauthenticated. Docker Linux engine is unavailable locally. Real Linux publisher/rollback, SSH, service permissions and production rehearsal remain unverified.
- Stop before batch 2: no commit/merge/push, no production switch, no automatic deployment enabled. User action needed: GitHub browser login; remaining engineering work: diagnose baseline failures, Linux integration coverage, controlled bootstrap and release/rollback rehearsal.

## Batch 2 progress

- GitHub device authorization completed: AtlasLeong, repository ADMIN, Actions enabled.
- Fixed only stale E2E mocks/selectors: `/api/fraudadmincheck` replaces old mocked `/api/fraudlogin`; map search uses its accessible label instead of matching both endpoint inputs. Focused 5 tests and full 77 tests now pass, with no frontend business behavior changed.
- Added Linux CLI integration tests for actual flock, symlinks, subprocess preflight, HTTP version checks, failed health recovery and manual rollback. All 29 deployment tests pass on the target CentOS/Python 3.10 in an isolated temporary directory with fake service commands; no production service/DB operations used by tests.
- Existing production requirements checksum matches the repository; `pip check` reports no broken requirements.

## Batch 2 completion — 2026-09-08

- Merged and pushed through `8ce32e1a7d1b38e5ce4dcf2366549825606f33e2`. Final hosted validation passes 29 deployment tests, 22 isolated Django tests, 77 frontend E2E tests and production build/artifact checks.
- Dedicated least-privilege deploy identity and master-only production Environment configured; original source/data/runtime preserved, legacy snapshot and root-only configuration backup retained.
- Live initial publish, GitHub rollback to verified legacy HTML, and republish of the same verified SHA all succeeded. Python CA discovery issue was corrected using the existing system trust bundle without disabling TLS verification; uncertain recovery journal was archived only after verifying old health, links and metadata.
- Auto-deploy enabled only after successful restore and exact-version checks. Full evidence, workflow links and remaining operating boundaries: [rollout record](2026-09-08-deployment-rollout-record.md).
