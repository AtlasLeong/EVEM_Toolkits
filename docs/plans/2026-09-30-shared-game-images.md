# Shared Game Images Implementation Plan

**Goal:** Use the verified public GameData snapshot from the sibling checkout in manufacturing and market screens, with accurate item-ID images and a local preview.

**Architecture:** Keep the public `/images/game-items/<PNG SHA-256>.png` namespace and the shared GameItemImage selection/component contract. Generate a small ID-to-digest index for current manufacturing references and approved market icons; copy only referenced PNGs. Prefer API image metadata, then the scoped snapshot, then reviewed client mappings and legacy crops. Use contain sizing for original non-square images. The full backend catalog and research files are not browser payloads.

**Tech Stack:** React, Node, sharp, JSON, Node test runner, Playwright.

## Task 1: Verified scoped import

- Add `front-codex/scripts/import-game-item-images.mjs` and meaningful fixture tests.
- Input: source checkout GameData `current.json`, immutable catalog, and public images; IDs from manufacturing scope plus market allowlist.
- Verify pointer/catalog SHA-256, standard verified item-icon role, safe content-addressed paths, actual PNG hash/dimensions, and complete requested coverage before writing.
- Output: `src/data/game-item-images.json` with schemaVersion, sourceRevision, catalogSha256, and items (ID -> PNG digest), plus deduplicated PNGs. Manifest written last; reject conflicting/corrupt files. Keep source paths private.
- Run unit fixtures, then import actual verified assets.

## Task 2: Shared display contract

- Add shared `GameItemImage.jsx` and `gameItemImage.js`; preserve the sibling API metadata contract.
- Use scoped exact-ID images in `MarketItemIcon` while keeping optional mapping compatibility.
- Pass the actual market item to the component for future API metadata.
- Ensure image proportions are preserved in all manufacturing and market contexts with object-fit contain.
- Test metadata precedence, scoped ID lookup, unknown IDs, legacy fallback, failed image loading, and component dimensions.

## Task 3: Verification and preview

- Verify every scoped image hash, 566 manufacturing references, and market icon coverage; record import counts and payload size.
- Run frontend unit tests, production build/bundle check, and manufacturing/market browser regressions appropriate to the change.
- Perform independent specification and code-quality review.
- Open manufacturing locally and verify loaded images, target picker, and nested materials visually. Leave preview available to the user.

Scope approval: user requested rechecking the shared source thread and integrating it for a local look. No deployment is included.
