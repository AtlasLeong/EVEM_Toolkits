# Killboard readable layout and client names

## Approved design

The owner approved the large ship summary plus asymmetric personnel/fitting panels on 2026-09-30. Remove the standalone fire-record and final-blow cards, merge the victim/corporation into the summary, enlarge the hero ship (about 180×112), participant hull (88×56), and equipment (56×56). Keep a black science-fiction desk, fixed desktop viewport, internal panel scrolling, and personnel/fitting tabs when the detail area is narrow.

Use client Chinese localization, not a generic brace-stripping replacement. Preserve semantic equipment tiers (for example 皮特丙型, 森塔姆甲型, 二型). Preserve immutable catalog revisions and the extraction path/hash provenance. The verified special location 33007327 is NI-D1003327, constellation 22000099 EI-S1238, region 12000009 EI-S11907. Do not invent system security from a region/constellation average.

Security: values <=0 display 00地区; values strictly between 0 and 0.5 display 低安; values >=0.5 display 高安. The exact 0.5 boundary was explicitly confirmed by the owner. Unknown security remains unknown. Only Killboard presentation changes; existing tactical-map semantics remain intact.

Preserve source final-blow metadata even when character ID is absent. Compact cf/fs fields describe camouflage and feat scores, not proof of an NPC. Resolve names using client rules. Final blow and maximum damage are independent row badges, not separate summary cards. Do not infer global maximum from seven visible characters. A complete damage reconciliation or explicit source flag is required. Keep the seven identified-character display limit, while allowing verified highlighted source identities to remain visible.

The latest stored report 20043145 has 28 attack rows totaling 700527 damage. Its supplied game screenshot shows total 993991 and a final/top source entry of 293464, exactly the missing difference; this is diagnostic evidence, not authority to manufacture raw fields. Retrieve or reuse its verified raw response when safe, never bypass an active collector cooldown. Existing 19748417 raw capture verifies final ship/weapon/damage but null character ID.

## Boundaries

Do not change owner-only access, strict >200亿 collection policy, session pool, timer or rate-limit protections. Do not expose passwords, sessions or raw game packages. This request authorizes development and local verification; leave merge/deployment for a subsequent explicit release request.

## Acceptance

- No module/template wrappers or numeric slot codes in visible equipment names.
- Names/places agree with client static tables; missing information is not guessed.
- Anonymous/camouflaged final summaries survive parser -> DB -> API.
- Incomplete lists cannot claim global top damage; one row can have both badges.
- Correct 00/low/high labels and colors, including exact 0.5.
- Larger decoded game artwork, readable names, no redundant cards, no document overflow on desktop/tablet.
- Existing authorization revocation, report switching, drop/destroy flags, and exact asset mappings remain tested.
