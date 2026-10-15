# Observed hotspot schema 113 compatibility

## Scope and evidence

The owner authorized replacing seven retired hotspot session materials with the
four complete captured sessions and restoring collection. Those four files are
installed privately, and the original seven plus configuration/cursor/state
backup are retained. The first normally scheduled pass reached the statistics
RPC but reported `malformed`; this is not a successful data recovery.

Offline analysis of the authorized capture reproduces the failure in all four
matching responses. Login and character selection succeeded. The statistics
boundary remains Ext10 / list / Ext19, but every record uses schema 113 instead
of the previously observed 112. Its decoded mapping still has exactly
`solar_system_id` and `destroy_num` and passes the existing row validation.
No capture, credential, role identity or raw response belongs in this repository.

## Decision

Accept the two explicitly observed record schema IDs, 112 and 113. Preserve the
record envelope, exact two-field mapping, integer/range/total/uniqueness checks,
and response bounds. Unknown schema IDs remain rejected. This is narrower than
accepting any schema with similar fields, and preserves compatibility with old
observed responses rather than replacing 112 outright.

The owner has already delegated subsequent implementation decisions without
repeated questions. This compatibility repair stays within restoring authorized
hotspot collection. No frequency, RPC allowance, automatic retry, account-state,
snapshot format or UI change is included. The statistics window remains unknown.

## Market addition

The owner also wants the same four sessions available to market collection.
The current capture contains no market query and its hotspot route is different
from the market route. Do not splice old market RPC material into new hotspot
authentication. Wait for complete same-flow login plus market query captures.
Then use market-owned private bundles, existing market round-robin selection,
the same operator aliases and existing shared coordinator, with controlled
non-secret state permissions. Do not widen hotspot credential access or reset
cooldowns. Market activation is not claimed by this protocol repair.

## Verification and release

Write failing synthetic schema-113 regressions, preserve malformed/unknown
negative cases, and run the complete hotspot plus shared coordination suites.
Decode the four captured responses offline with the candidate, emitting only
counts and pass/fail. Obtain independent review. Use the existing PR, CI and
production publisher; never patch live release code manually. Verify the
published SHA and a normal scheduled successful snapshot before declaring
hotspot recovery. Do not probe all four sessions consecutively.
