# Corporation experience redesign

Approved by the user on 2026-09-20. Local implementation only; no production database writes, push, merge or deployment.

## Scope and visual direction

Keep the existing warm-white, charcoal and muted accent design system. Apply the audit principles from https://github.com/Leonxlnx/taste-skill/tree/main/skills/redesign-skill without adding a new framework, icon library or ornamental animation. Narrow the tab-to-intro gap, group identity and metadata, constrain long reading lines, align controls, and provide keyboard, loading, empty and failure states.

Discovery uses searchable styled single-choice disclosures for region and activity. Reuse FilterDisclosure, preserving its Chromium blank-space focus fix. Filtering still runs on the server before pagination.

Detail retains a short cover. Identity, recruiting state, tags and actions form one compact section. Sharing copies a clean same-origin /corporations/:id URL with no query parameters. On clipboard failure, expose a selectable URL. Only approved public revisions are shared; no new publication endpoint is needed.

Poster creation is a separate native modal dialog, large on desktop and full-screen on mobile. It does not change the underlying content width. Settings and a large fitted preview live inside; close button and Escape restore focus, background scroll is locked, and failed/pending image rendering prevents export. Editing a draft keeps existing save/review semantics; selecting a background alone does not publish.

## Location contract

An optional base_location stores region_id, constellation_id and solarsystem_id as strings. A region alone, or region plus constellation, is permitted. The server validates existence and parent relationships against existing StarFieldSearch catalogs, derives region_name, constellation_name, solarsystem_name and security for the revision snapshot, and synchronizes base_region to region_name. Names supplied by a client are not trusted. No schema migration is required because revision content is JSON. Old text-only base_region remains readable/editable until explicitly replaced. Changing a parent in the UI clears incompatible descendants. Explicitly clearing an established location clears its derived base_region. Existing region filtering remains functional.

## Artwork

Replace all old six backgrounds with eight individual generated artworks: expedition-fleet (远征舰队), ringed-planet (星环巨行星), spiral-galaxy (旋臂星河), orbital-shipyard (轨道船坞), black-hole (黑洞视界), stellar-nursery (创生星云), frozen-frontier (冰封边境), wreckfield (战舰残骸). No text or numbers baked into art. Store optimized WebP images and small thumbnails in src/assets/corporations/posters. Preserve generation prompts and provenance.

Read-side aliases: deep-space→spiral-galaxy, ion-storm→stellar-nursery, tactical-grid→orbital-shipyard, jump-rift→black-hole, sovereignty-border→ringed-planet, pirate-tide→wreckfield. New writes accept only new keys. Historical revision JSON remains unchanged. Remove the old repeated grid, circles and opaque central fallback card. Compose text with localized gradients, preserving the artwork and existing logo/cover support.

## Acceptance

Discovery, detail, management and poster work at 1440, 820 and 390px without horizontal overflow. Public share links remain guest-readable. Location round-trips and rejects inconsistent parents. All eight backgrounds load/export with all three templates, no stale export during switching, and recover from artwork load failure. Existing authorization/media allowlists are unchanged. Run backend tests, migration checks, poster unit tests, browser regressions, production build and visual review before handing off the local preview.
