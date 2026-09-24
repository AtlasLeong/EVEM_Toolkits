# Market Session Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Export an authorized Windows collector DPAPI session to the validated Linux Market JSON format without exposing or overwriting secret material.

**Architecture:** A standalone Windows CLI reads one explicitly named, bounded collector `EVEMDP1` file, decrypts it with the capture owner's DPAPI context, then calls `Market.session_bundle.encode_session`. It creates a new file only after validation, using `CreateFileW(CREATE_NEW)` and a protected owner-only DACL. It never handles PCAP, prints paths, or writes plaintext temporary files.

**Tech Stack:** Python 3.11, msgpack 1.2.2, stdlib ctypes/Win32, unittest.

---

### Task 1: Synthetic source decode and validation

**Files:**
- Create: `backend/Market/tests/test_session_export.py`
- Create: `scripts/market/export_session_bundle.py`

1. Write a test that creates synthetic `endpoint`/`hello`/RPC templates, wraps msgpack in `EVEMDP1`, stubs only DPAPI decryption, and asserts `decode_session` equals the input after export encoding. Also assert invalid magic, an oversized source, and missing required templates fail before output creation.
2. Run `py -3.11 -m unittest backend.Market.tests.test_session_export -v`; confirm the new test fails for the missing exporter.
3. Implement `decode_collector_source(source: Path) -> bytes` using bounded regular-file reading, the exact original collector header, DPAPI decryption, msgpack decoding, and `Market.session_bundle.encode_session`; reject non-Windows use. Wrap failures in a safe exception with no source data or path.
4. Run the focused test and keep it green.

### Task 2: Owner-only exclusive output

**Files:**
- Modify: `backend/Market/tests/test_session_export.py`
- Modify: `scripts/market/export_session_bundle.py`

1. Write tests that a destination is created outside the repository, existing bytes are never overwritten, a write failure leaves no file, and a synthetic output has one protected current-owner ACE on Windows.
2. Run the focused test and confirm expected failures.
3. Implement destination checks (absolute path, existing parent, outside repository, persistent ACL volume) and `CreateFileW(CREATE_NEW)` with a protected DACL for the current token user SID. Write and fsync using the resulting handle; remove only the file created by this call if the write fails.
4. Run the focused test and keep it green.

### Task 3: Quiet CLI and operating instructions

**Files:**
- Modify: `backend/Market/tests/test_session_export.py`
- Modify: `scripts/market/export_session_bundle.py`
- Modify: `docs/market-prices.md`

1. Write a test calling `main()` with synthetic paths and failing input, and assert stdout/stderr contain neither path nor any synthetic secret marker or raw exception text. Test that `--help` names the two required flags.
2. Run the focused test and confirm the missing CLI behavior fails.
3. Add `--source` and `--output` only, both required; sanitize argument and runtime failures, and print only a generic success message. Document Windows same-user invocation, private destination, controlled transfer, Linux ownership/mode, and destruction of the portable copy after transfer.
4. Run focused tests, the existing session-bundle tests, and syntax/CLI help checks. Inspect `git diff` and `git status`; do not commit or push.
