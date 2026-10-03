# KM display clarity design

## Authorization and scope

The user requests clearer participant names, slot-separated equipment, real
corporation short tags, stronger corporation/hull hierarchy and fully visible
ship artwork. Their standing instruction delegates design decisions and asks
for implementation without additional questions. Continue the existing private
production workflow; do not change collection policy, cadence or access gates.

## Evidence

- Unnamed ordinary participant rows already contain `ship_name`, but the
  presentation fallback restricts that evidence to special identity kinds.
- The all-equipment view iterates raw database order instead of the existing
  high/mid/low/rig/other grouping helper.
- Verified corporation brief decoding already returns `ticker`, but the parser,
  persistence models and public serializers drop it. No new RPC is necessary.
- Inspected original ship PNGs have complete silhouettes. The hero has a grid
  image wrapper, percentage-sized image and visible wrapper overflow inside a
  clipped panel. Browser geometry must prove the clipping source before a fix.

## Alternatives and choice

1. **Recommended:** grouped sections in the current equipment scroll pane,
   minimal participant copy, additive real ticker fields, a definite contained
   image viewport. Preserves the familiar desk and makes ordering predictable.
2. Three simultaneous slot columns offer fast comparison but squeeze equipment
   text and images at the current detail width and worsen narrow-screen density.
3. Tab-only equipment is compact but conceals other categories and does not
   satisfy the user's requested separators in the all view.

## Presentation contract

Participant primary name is actual character name, then verified display/source
name, then available ship/source name. Opaque IDs and missing-identity diagnostics
must not appear as names. Retain NPC rows and final/top-damage marks. Omit absent
corporation lines and duplicate source/hull captions, including “非玩家角色”.
Unknown sources without any name are not represented as a fabricated player.

All equipment is ordered high, mid, low, rigs, other. Every nonempty category has
a full-width heading, item count and dropped count. Slot tabs and drop-only
filter remain, with empty sections removed after filtering. Keep verified slot
classification and internal scrolling; never infer a slot from a name.

Keep existing Chinese sans-serif system fonts, using weight and contrast instead
of fetching a font. Ship name remains the primary heading; ship class becomes a
distinct compact label. Corporation name is visibly brighter cyan and stronger
than alliance/location metadata. Display a real `[TICKER]` when present, hide it
when absent. Never transliterate a Chinese corporation name into a fake tag.

Ship artwork uses one explicit no-frame viewport and a fully contained image.
Constrain intrinsic sizing and grid tracks rather than allowing the silhouette
to escape the viewport. Validate real tall, wide and diagonal PNGs at desktop,
tablet and mobile sizes, with a small safe inset for shadows.

## Data and deployment

Add blank-default `victim_corporation_ticker` and `corporation_ticker` fields to
the existing report and participant tables. Parse only verified identity-map
corporation ticker values. Preserve known ticker on a same-corporation partial
refresh; clear stale ticker on a confirmed corporation change. Serializer fields
are additive. Historical records remain blank until verified enrichment;
perform no bulk game lookup or guessed backfill.

Use one additive migration, a current private verified database backup, the
existing collector/publisher locks and exact successful CI artifact. Preserve
10-minute scheduling, rate-limit cooldowns and owner-only/no-store gates.

## Acceptance

- Source-backed participant rows have no identity-error/ID/NPC captions.
- All view has ordered visible group dividers; dropped-only and tabs work.
- Real tags survive parser → database → API → JSX, with safe blank fallback.
- Browser image bounds stay inside their viewport and hero at tested sizes.
- Existing access revocation, private API, collection and image mapping tests pass.
- Production SHA, migration and owner/non-owner/anonymous checks are verified.
