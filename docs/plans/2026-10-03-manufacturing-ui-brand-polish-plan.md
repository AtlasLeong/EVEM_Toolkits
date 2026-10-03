# Manufacturing UI and site branding implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply the approved interaction polish and EVEM 工具箱 browser/share branding without changing manufacturing calculations or production access.

**Architecture:** Reuse the current managed worktree and existing React/Vite console. Keep static sharing metadata in index.html and route-title logic centralized at App level. Use the final scoped console stylesheet to resolve legacy controls, root scrollbar gutters and selected-row decoration; no UI framework or additional dependencies.

**Tech Stack:** React 18, React Router, Vite, CSS, Node test runner, existing Playwright regression suite, Codex in-app browser.

---

## Task 1: Brand metadata and global browser titles

Files: `front-codex/index.html`, `front-codex/src/App.jsx`, `front-codex/src/utils/siteMetadata.js`, `front-codex/tests/unit/siteMetadata.test.mjs`; related title/branding browser test if needed.

1. Write unit tests first for the approved brand, public description, static title/meta tags, unchanged compass URLs and route-title resolution. Include nested routes, login, access-denied and fallback; reject accidental use of query/account data.
2. Run `node --test tests/unit/siteMetadata.test.mjs` and confirm red failures against the current old static title / absent utility.
3. Implement a small pure route-title resolver with static string labels; mount an effect at the global router level so redirects and lazy navigation do not retain a previous module's title. Set the HTML title to `EVEM 工具箱`, add description, OpenGraph site name/title/description/type/locale and Twitter title/description. Do not claim route-specific metadata to non-JS crawlers or add an unverified share image.
4. Rerun the unit tests. Verify raw HTTP HTML on `/manufacturing` includes the public title/meta tags, then verify runtime titles through real navigation and back in the in-app browser.
5. Review spec compliance and then code quality before committing scoped files.

## Task 2: Stable manufacturing workspace and separate route controls

Files: `front-codex/src/styles/console-unification.css`, `front-codex/src/pages/ManufacturingEstimator.jsx`, `front-codex/tests/e2e/specs/manufacturing.spec.js`, `front-codex/tests/e2e/specs/console-unification.spec.js`.

1. Add failing regression assertions to the existing manufacturing suite: stable outer x/width and internal clientWidth on picker open/close and selected-node edits; visible 6 px make/buy separation; one console border, 8 px radius, no external selected shadow; actual missing-quote purchase count; absent disabled preset controls.
2. Run the focused cases against the old UI and confirm the intended failures. Browser verification uses real components; only existing external API fixture boundaries are mocked.
3. Add `html { scrollbar-gutter: stable; }` to the final theme. Add stable gutters only to desktop manufacturing scrolling rails (mobile releases overflow and does not need a reserved gutter).
4. Fully define route-group and route-toggle styles in the final scoped stylesheet: grid columns, gap 6 px, fixed basis, transparent/no-border group, visible overflow for focus, individual 1 px borders and 8 px radii, no old shadows or transforms. Keep phone min-height 44 px and wrapping without horizontal overflow.
5. Replace the selected-row external shadow with an inset accent. Remove duplicate `方案配置` / `成本摘要` headings and the inactive skill/building preset UI and unused LevelControl helper. Keep all final-efficiency and quote limitations. Replace footer priced-purchase length with the existing unique purchase-ID length.
6. Run focused tests, review screenshots at desktop / phone, and verify keyboard dismissal, all-make, buy-intermediates and manual-price editing. Review spec and code quality, then commit exact files.

## Task 3: Integration verification and local handoff

1. Preserve the user's dirty `output/research/client-icons-2026-09-29/README.md` and all unrelated untracked assets. Do not merge, push or deploy.
2. Run fresh `npm run test:unit`, `node --test tests/preview/*.test.mjs`, `npm run build` and the existing main browser suite with isolated `PW_TEST_PORT=4173`, staggered startup and 3 workers. Do not weaken old assertions for the UI changes.
3. Use the current local preview on 127.0.0.1:4185. Capture real desktop/phone screenshots, recheck root/card geometry and metadata, restore viewport and leave the preview available.
4. Final read-only reviewer examines the integrated diff. Record exact fresh test results and local-only status; give the user the preview and a screenshot showing the changed controls.
