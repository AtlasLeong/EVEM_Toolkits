# Captured-session validation (2026-09-30)

This evidence is from an owner-authorized LDPlayer / PCAPdroid capture. The
capture and authentication material remain outside the repository and releases.
This document contains only redacted structural results, not credentials.

## Observed results

- PCAPdroid's HTTP receiver successfully downloaded a 1,682,002-byte PCAP
  containing 4,018 complete records. HTTP is the capture delivery channel;
  game requests use a separate TCP / MessagePack protocol.
- SHA-256: `30400643661606a47f89779b14cd8fe2b0062cf0b6096d71e12e568f48e64c02`.
- One old-account connection contains the handshake, `login_sigma`,
  `request_start_wait`, `get_newbie_info`, `select_character_id`, and a
  `get_kill_info(19748417)` request with a correlated response.
- RPC bodies have four entries and one Ext10 call. Captured calls are
  `[method, positional_args, {}]`. The KM destination is `char_mgr`.
- The response uses the previously observed Ext10 / Ext19 KM envelope, with a
  6,579-byte kill blob and a total loss value of 229,307,984,742 ISK. This is
  above the strict 20,000,000,000 ISK collection threshold.
- Equipment: 26 entries, 9 dropped, 16 destroyed, 1 with unknown drop state.
- Participant source data has 102 damage rows, of which 7 include positive
  character IDs. After joining captured public-character / corporation replies,
  6 of those 7 have character names and all 7 have corporation names. Missing
  identifiers or names must not be invented, nor automatically called NPCs.

## Not yet established

- New password login was blocked by the game's proxy restriction. This capture
  does not establish password login automation, token refresh, or successful
  sessions for workbook rows 200–400. Do not bypass the restriction.
- The captured KM is a known historical report, not evidence of the latest ID.
- After explicit owner approval, this captured session successfully
  reauthenticated and queried two reports from the local development machine
  (see below). That does not prove reuse after future expiry, automatic refresh,
  or access from the Linux server. Further same-account connections remain
  operator-controlled because they can disconnect the game session.
- Captured identity replies can enrich this historical sample. Autonomous
  collection must implement and verify identity RPCs separately before claiming
  complete participant names.
- No production collection timer has been enabled by this validation.

## Authorized live check (2026-09-30)

One captured old-account session was used, without password login, account
rotation, retries, database writes or latest-ID scanning. The connection was
closed after the check.

| Step | Observed result |
| --- | --- |
| Handshake and `login_sigma` | Accepted; expected login result received |
| `request_start_wait`, `get_newbie_info` | Expected responses received |
| `select_character_id` | Successful role-entry result (`1`) |
| `get_kill_info(19748417)` | Response ID matches; ship type `10706000201`, 229,307,984,742 ISK, 102 source damage rows, 26 equipment entries |
| `get_kill_info(19748418)` | Response ID matches; ship type `10607001409`, 1,796,659,368 ISK, 1 participant, no equipment entries |
| Strict threshold evaluation | First report qualifies; second does not |

This proves the old captured session's TCP authentication and real KM query /
decode path at the time of the check. It does **not** prove fresh password login
for any candidate account, complete live identity enrichment, durable storage,
server deployment or the five-minute scheduler.

## Verification and refresh workflow

1. Capture one authorized account's login, character entry, KM opening and
   participant scrolling; stop capture before private export.
2. Run `scripts/killboard/extract_session_bundle.py --capture <absolute-path>`
   for offline validation. It never connects or prints authentication material.
3. Store any exported bundle only in an owner-readable private directory;
   Linux files must be owned by the collector and have mode `0600`.
4. Stop the game's same-account session, then perform one bounded live check.
   Stop on auth, rate, network or format failure; do not rotate accounts to
   evade a rejection.
5. Enable bounded discovery and the production timer only after that check
   and private owner-access / threshold verification. Refresh sessions on
   confirmed expiry rather than automatically replaying passwords.
