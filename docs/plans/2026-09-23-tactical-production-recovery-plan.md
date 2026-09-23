# Tactical production recovery implementation plan

1. Establish focused baseline: backend tactical tests, frontend unit/e2e, build, and verify production HTTP/WS symptoms read-only.
2. Add regression tests for offset-aware report timestamps under `USE_TZ=False` and `USE_TZ=True`; prove the former fails. Normalize incoming timestamps for storage and produce unambiguous wire timestamps. Re-run both modes.
3. Add UI tests for no-scope center CTA and stable system-intel placement. Implement the center scope action, right-context detail replacing the overview, and responsive collision handling.
4. Review ASGI consumer, authentication, origin checks, release configuration, and load behavior. Add executable deployment templates and tests/probes; keep HTTP sync as fallback.
5. Run full backend/frontend suites, browser layout checks, local ASGI integration and bounded load test. MySQL is not available locally; use read-only production checks and rollback-safe online verification. Review diffs and fix findings.
6. Commit, push, integrate to the repository default branch through its workflow, deploy with backup/rollback, verify live report create/move/withdraw, WS upgrade and HTTP fallback, and report outcomes.

Stop before production cutover if tests, resource validation, or rollback preflight fail.
