# Corporation Covers and Interactive Sandbox Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver four original landscape fallback covers, clean poster branding and a usable local corporation test workflow.

**Architecture:** Reuse the existing isolated worktree. Keep trusted bundled covers separate from authenticated upload URLs. Extend only the local preview server for interactive fixtures; production authentication and approval rules remain unchanged.

**Tech Stack:** React, Vite, Canvas, Node native HTTP/Request APIs, node:test, Playwright, built-in image_gen.

---

### Task 1: Original landscape artwork

Files: `front-codex/src/assets/corporations/covers/{fleet,planet,shipyard,nebula}.webp`, matching `-thumb.webp`, `provenance.md`; originals in untracked `output/corporation-covers/`.

1. Generate each scene independently with imagegen as a no-text cinematic 3:1 horizontal original, subject readable in the center vertical band and central width for responsive crop.
2. Inspect each image; use only mechanical optimization to create approximately 1920 × 640 full images and 600 × 200 previews. Do not replace generation with procedural art or crop the old portraits.
3. Record exact prompts, tool, sources and dimensions; commit assets only after final review.

### Task 2: Deterministic cover fallback

Files: new `front-codex/src/utils/corporationCover.js`, `corporationCoverAssets.js`, component `CorporationCover.jsx`; modify `src/pages/Corporations.jsx`, `src/styles/corporations.css`; tests `tests/unit/corporationCover.test.mjs`, `tests/e2e/specs/corporation-cover.spec.js`.

1. Write and run RED unit tests for stable assignment, four IDs, invalid inputs; browser tests for no-upload fallback, bad-upload fallback, custom upload priority and compact responsive dimensions.
2. Implement a small stable hash selector returning one of `fleet`, `planet`, `shipyard`, `nebula`; only declared local asset paths are trusted.
3. Reuse the uploaded-image protection for custom images, but render the fallback independently without broadening its URL allowlist. No backend fields or new cover editor.
4. Keep the existing cover heights. Remove decorative orbit shapes over actual cover artwork. Ensure optional images never cause layout shift.
5. Run `node --test tests/unit/corporationCover.test.mjs`; root coordinates browser tests after artwork exists.

### Task 3: Clean poster copy

Files: `front-codex/src/utils/corporationPoster.js`, `tests/unit/corporationPoster.test.mjs`.

1. Add a failing test recording Canvas text: all three approved templates must omit `/EVEM|军团资料已审核/` and keep actual name/contact. Keep unapproved marker test.
2. Remove only the top platform label and approved footer draw calls; retain bounded layout and output dimensions.
3. Run `node --test tests/unit/corporationPoster.test.mjs` then poster export E2E during integration.

### Task 4: Interactive local preview

Files: `front-codex/tests/preview/server.mjs`, `fixtures.mjs`, `community.mjs`; new local session/upload helpers and preview-service node tests as needed. Keep application production auth files unchanged unless a confirmed application bug requires a narrow fix.

1. Write RED tests against the same handler/service used by `preview:ui`: session entry/refresh, guest/private permissions, claim/create/review, new draft/version/save/submit/withdraw/publish and upload readback. No disconnected business mocks.
2. Implement local role context and clear UI entry; remove global `localStorage.clear()`. Keep API responses matching `src/services/apiCommunity.js` and backend contracts.
3. Implement in-memory state with dynamic IDs, approval separation and matching version/idempotency checks. No auto-approval. Render errors for unsupported actions.
4. Parse multipart uploads with bounded size and allowed image validation; store/read local bytes and preserve public/private access rules. Test invalid type and too-large files.
5. Add a dedicated Playwright config/spec that starts the actual preview server on a separate port and walks from the user-facing entry, without request interception or localStorage seeding. Root runs it serially with other browser tests.
6. Self-review preview isolation, permissions and actual render payloads; no production calls, real credentials or permanent data reset buttons needed.

### Task 5: Integration and handoff

1. Spec review, then independent quality review; address findings and re-review.
2. Run all unit tests, preview HTTP/integration tests, targeted and full existing Playwright regressions, and `npm run build`.
3. Restart 4190 only after warning about old ephemeral test state, verify real local browser flows with demo data, capture screenshots and inspect final artwork.
4. Commit scoped source/assets/tests/docs. Preserve untracked output; keep local server available with explicit entry and limitations. No push, merge or deployment.
