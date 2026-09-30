# Killboard collection policy and scheduling foundation — 2026-09-30

This change prepares the bounded collector for the requested high-value
collection policy without claiming that a real game transport is present.

## Policy

`CollectionPolicy.min_isk_lost` is an optional decimal threshold. When set,
`persist_report` accepts a report only when the source-reported `isk_lost` is
strictly greater than the threshold. Missing, malformed, non-finite or equal
values are rejected. A policy with `min_ship_rank=0` and no
`allowed_class_keys` allows every ship class; the built-in `high_value_all`
preset uses `20,000,000,000.00` ISK (the current interpretation of “200e”).
The legacy `battleship_plus` policy remains available for compatibility.

## Run lease and orphan recovery

`ProbeRun` now stores a short lease owner and expiry. A new pass claims the
cursor transactionally, marks expired `RUNNING` rows as `lease_expired`, and
refuses a still-live run. The worker renews its lease immediately before each
probe and clears it on normal or failed completion. This prevents a crashed
process from blocking the cursor indefinitely while keeping network I/O outside
database transactions.

## Five-minute scheduling example

`scripts/deploy/evem-killboard-collector.service.example` and
`.timer.example` provide a five-minute systemd wrapper. The service requires a
private `collector.env` containing only a reviewed `KILLBOARD_CLIENT` import
path. No transport, login/session bundle, account pool or password is included
in this repository; the timer must remain disabled until that client is
implemented and separately authorized/verified.

## Verification

The Killboard focused suites cover strict threshold boundaries, all-class
acceptance, missing-value rejection, active leases and orphan recovery. They
use synthetic clients only and do not probe the game or establish network
connections.
