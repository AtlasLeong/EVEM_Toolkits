# Compass Brand Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish the user-approved charcoal/cyan compass identity without the Chinese descriptor, keeping EVEM visible and all business behavior unchanged.

**Architecture:** Use one transparent icon-only PNG derived from the approved image. Render EVEM as adjacent HTML text in desktop/mobile navigation; reuse the icon for the favicon. Keep the previous assets for rollback and use the existing verified frontend deployment pipeline.

**Tech Stack:** React 18, Vite, CSS, Playwright, GitHub Actions.

## Approved design and scope

- User selected the compass, explicitly rejected the satellite, requested removal of the `星际工具` descriptor, and authorized publication.
- Preserve the compass ring, cardinal points, northeast needle, cyan accent and transparent background.
- Website brand text remains EVEM; no Chinese descriptor is added. Existing page titles, login behavior, routing and backend remain unchanged.
- Mobile and desktop icons use square boxes, no background plate and no monochrome CSS filter.

## Task 1: Establish baseline and assets

1. Create `codex/compass-brand` from current `origin/master` in ignored `.worktrees/compass-brand`.
2. Install locked frontend dependencies with `npm ci --no-audit --no-fund`.
3. Run `npm run test:e2e -- tests/e2e/specs/shell-nav.spec.js tests/e2e/specs/responsive-shell.spec.js tests/e2e/specs/warm-neutral.spec.js --workers=2`; expect baseline pass.
4. Use built-in image editing on the approved compass to remove embedded text for the small icon. Preserve EVEM separately as HTML. Inspect the resulting PNG and copy it to `front-codex/public/evem-compass-mark.png` without changing the original generated file.

## Task 2: Test the approved branding before changing the UI

**Files:**
- Modify: `front-codex/tests/e2e/specs/shell-nav.spec.js`
- Modify: `front-codex/tests/e2e/specs/responsive-shell.spec.js`
- Modify: `front-codex/tests/e2e/specs/warm-neutral.spec.js`

1. Replace the old white-rabbit pixel expectation with assertions for the new compass source, square size, `filter: none`, transparent margins and dark/cyan pixels.
2. Assert the visible desktop and mobile brand name is exactly EVEM, icon loads, Chinese descriptor absent, and home navigation remains functional including collapsed sidebar.
3. Verify all favicon links point to the new PNG with correct content type.
4. Run the targeted command and confirm expected red failures against unchanged old branding.

## Task 3: Minimal implementation and validation

**Files:**
- Add: `front-codex/public/evem-compass-mark.png`
- Modify: `front-codex/src/components/layout/AppShell.jsx`
- Modify: `front-codex/src/styles.css`
- Modify: `front-codex/index.html`

1. Point both existing navigation images at `/evem-compass-mark.png`, keep accessible home-link names, and show EVEM in the adjacent spans.
2. Set `.brand-icon` to 36x36 and `.mobile-brand-icon` to 32x32, removing `brightness(0)` so the cyan accent remains visible. Do not change unrelated CSS.
3. Replace old favicon links with the new PNG URL; retain old files without deleting unrelated assets.
4. Run targeted tests, then `npm run build` and `npm run test:e2e -- --workers=4`; expect all pass.
5. Use browser preview screenshots at desktop and phone sizes; check legibility, no clipping, no duplicated text or descriptor, preserved click targets and sidebar collapse.

## Task 4: Review, merge, publish, verify

1. Have a read-only reviewer check the diff against this scope, including image/CSS/test consistency.
2. Commit only scoped files. Fetch remote, verify no intervening changes, and merge to master without overwriting unrelated work.
3. Recheck the merged build and brand tests, push master and follow the existing Production workflow to completion.
4. Verify `https://www.evemtk.com/deploy-version.json` matches the release SHA; confirm the new image and page assets load with correct MIME types, and `/api/deploy-version/` still reports the unchanged backend version.
5. Report the production link, SHA, test evidence and any residual caveats. Use the existing frontend rollback procedure if a deployed regression is found.

## Image edit provenance

Built-in image editor; source: approved compass concept `exec-4e2b644f-23d2-49b1-8088-541b1e364a0b.png`.

Final prompt: Use case: precise-object-edit. Image 1 is the selected and approved EVEM compass logo. Make a production icon-only asset from this exact design. Remove ALL typography below the compass: both EVEM and the Chinese descriptor 星际工具. EVEM will be typeset separately by the website, so there must be NO TEXT of any kind inside this image. Preserve the exact compass design, ring gaps, four cardinal points, center circular hole, needle direction toward northeast, charcoal main color and cyan needle tip; do not redesign, rotate, embellish or change its proportions. Crop out the removed typography area and recenter the compass alone on a square canvas with only about 6 percent transparent padding on each side. Background must be true transparent alpha and all internal voids transparent. Flat solid charcoal #242422 and a solid cyan #49B9CA tip. Clean crisp anti-aliased boundaries. No shadows, gradients, glow, noise, checkerboard, white rectangle or new objects. The resulting single icon will be used at 32 to 40 pixels on a warm-white website. Preserve the approved identity exactly.

Output: `exec-ec391da1-c699-462b-9fae-aae44340c91d.png`, copied unchanged to `front-codex/public/evem-compass-mark.png` (1254x1254, 338123 bytes; SHA256 `0b795c703b1150a508d59ff4c70ff7b28f883edc38f16d067470297cb90c5df8`).

## Pre-release verification (2026-09-20)

- Original targeted baseline: 10 passed. Test-only branding change: 5 expected failures, 6 passed.
- Updated implementation: targeted suite 11 passed. Corrected a test-only assumption: collapsed labels use accessible visually-hidden CSS, not display:none.
- Independent review: no blocking findings. Unified favicon and navigation asset URLs to avoid separate cache entries; added equality regression (observed red, then green).
- Final `npm run build`: passed. Final `npm run test:e2e -- --workers=4`: 150 passed (1.4m). `git diff --check`: passed.
- Browser screenshots inspected at 1440x960, collapsed desktop, and 390x844 mobile. Icon is transparent, no clipping or duplicate text; browser console reported zero warnings/errors. Screenshots are in the root workspace's `output/playwright/compass-brand/.playwright-cli/`.
- Expected release scope: frontend only. Pre-release frontend SHA: `a9fa198af7ddf8a0447af52c9c7c626090acb1a3`; backend SHA must remain `ffce3c4ede4615bd42778e71d89a5b59ebe98d25`.
- Production workflow and live version/asset checks remain release gates after push.
