# Corporation Experience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the three approved request batches in the isolated local corporation branch.

**Architecture:** Keep revision JSON and existing public/read-only star catalogs. Share one styled disclosure selector and one modal poster component; static generated artwork uses a trusted local registry separate from uploaded API media.

**Tech Stack:** Django/DRF, React 18, React Query, Vite, vanilla CSS, Canvas, node:test and Playwright.

---

### Task 1: Backend location and background contract

Files: backend/Community/views.py; backend/Community/tests.py; optionally backend/Community/location.py and dedicated tests.

1. Write failing tests for valid partial/full base_location, invalid parents/types/unknown IDs, legacy text preservation, explicit clearing, public/private round-trip and eight background IDs plus old aliases.
2. Run `python manage.py test Community --settings=EVE_MDjango.ci_settings --noinput`; verify new assertions fail.
3. Validate catalog relationships; derive snapshot labels/security and base_region server-side. Extend default/read/update serializers without altering immutable historical JSON or allowing arbitrary properties.
4. Run focused and full Community tests; check query/permission/error boundaries.
5. Commit only owned backend files after review.

### Task 2: Page layout, selection, sharing and location UI

Files: front-codex/src/pages/Corporations.jsx; CorporationManage.jsx; CorporationReview.jsx; components/community/CorporationSelect.jsx; CorporationLocation.jsx; services/apiCommunity.js; styles/corporations.css; tests/e2e/corporations.spec.js; tests/preview/community.mjs and fixtures.mjs.

1. Add browser tests for styled search/select, pagination reset, clear/reset, linked location change/save, compact layout, clean share URL and clipboard fallback. Run new tests and observe failures.
2. Implement disclosures using real radios, keeping FilterDisclosure null-relatedTarget guard intact. Fetch region/constellation/system catalogs with dependent React Query keys; never reuse previous-parent data.
3. Compact directory and detail; add share action and location breadcrumb. Replace inline PosterStudio in detail/manage with shared PosterDialog API `{open,onClose,corporation,content,approved,isPrivate,onBackgroundChange}`. Root task supplies the dialog component.
4. Replace management native recruitment select; keep authentication/review/upload/save controls intact. Add preview fixtures for valid cascades and clear unavailable states.
5. Run corporation browser tests; root coordinates final UI and art-dependent checks. Commit only owned files after review.

### Task 3: Eight original background assets

Files: front-codex/src/assets/corporations/posters/*; artwork-provenance.md.

1. Generate one portrait, no-text image per approved direction using built-in imagegen. Inspect each output.
2. Save originals in project output and optimized WebP assets plus thumbnails in the source directory. Use tooling only for lossless copying or mechanical asset optimization, not invented substitutes.
3. Document prompt, tool, source path, final file and dimensions for every asset. No old art in selectable registry.

### Task 4: Modal studio and poster rendering

Files: front-codex/src/components/community/PosterStudio.jsx; PosterDialog.jsx; src/utils/corporationPoster.js; src/utils/corporationPosterAssets.js; styles/corporationPoster.css; tests/unit/corporationPoster.test.mjs; tests/e2e/corporation-poster.spec.js.

1. Add failing unit/browser tests for aliases/new registry, modal focus/close/no reflow, asset readiness and export.
2. Implement native showModal dialog with scroll lock/focus restore and responsive controls/preview layout. Keep public/private media retrieval semantics.
3. Load only selected bundled artwork, guard decode completion against superseded renders, disable download while loading/error and offer retry.
4. Redesign Canvas layout with a visible artwork middle band and local top/bottom contrast gradients; retain 1080×1440 output, three templates, approval marker and uploaded logo/cover support.
5. Run `node --test tests/unit/corporationPoster.test.mjs` and focused Playwright tests.

### Task 5: Review, verification and local handoff

1. Independently review spec compliance, then code quality/security; fix and re-test findings.
2. Run backend Community/Feedback/License/ActivationCode/TacticalBoard/deployment tests and `makemigrations Community Feedback --check --dry-run --settings=EVE_MDjango.ci_settings`.
3. Run unit tests, `npm run build`, and full Playwright suite with `VITE_API_URL=/api`.
4. Inspect actual desktop/tablet/mobile preview, all eight artwork exports and keyboard interactions. Record screenshots and accurate results.
5. Leave local preview running on 127.0.0.1:4190; commit scoped changes only. Do not push, merge, deploy or modify production.
