# Dark Console Frontend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply the selected dark-console direction consistently to all existing frontend pages and make calculator bulk-add unmistakable without changing business behavior.

**Architecture:** Keep the React/Vite app, routes, state and API services. Refactor shared CSS into semantic dark tokens, rebuild the shared shell as a desktop sidebar, then adapt page-specific surfaces and the planetary filter/bulk-action layout. Test against mocked APIs and compare rendered screenshots to the selected reference before handoff.

**Tech Stack:** React 18, Vite, existing CSS, lucide-react, framer-motion, Playwright.

**Workspace:** `D:/Code/EVEM_Toolkits/.worktrees/ui-dark-console`, branch `codex/ui-dark-console`, base `00b4bfbe48fcccb2a644deaa85f432085ba8efb2`.

**Design:** `docs/plans/2026-09-08-dark-console-design.md`; selected image `docs/design/dark-console-reference.png`.

---

## Stage 1 checkpoint — 2026-09-08

- Implemented console token foundation and fixed left navigation; preserved business-page colors pending staged migration.
- Added semantic keyboard home link, active navigation, guest/account actions, dark footer and narrow-screen framing.
- Added 7 shell/theme regression cases. Fixed pre-existing missing API isolation in registration validation tests after an initial 82/83 full run exposed a real-server duplicate-name response.
- Final verification: 84/84 E2E tests passed with 2 workers; Vite production build passed; diff whitespace check passed.
- Independent code review: no blocking issue for this checkpoint; logo visibility fixed, low-height authenticated sidebar test added. Loaded-table internal clipping evidence remains a later-stage follow-up.
- `design-qa.md` records full-redesign acceptance as blocked until remaining page/state comparisons are complete; do not present this checkpoint as final visual delivery.
- No branch push, master merge, SSH operation or deployment performed. Local build output exists only inside this worktree.

## Execution rules

- Read the approved design and applicable TDD, review and verification skills before implementation.
- Do not modify backend/services/auth rules, API payloads, CI workflows or production. User explicitly requires staged local work: no push of any branch, no merge to master, no SSH or deployment.
- Existing untracked ZIPs/proposal in the original workspace are not part of this task.
- Run shell/test commands inside the worktree. Only one agent/process owns a given browser/test server port; never kill an unrelated server. Make the Playwright config accept a dedicated `PLAYWRIGHT_PORT` if port isolation becomes necessary, and ensure tests do not silently reuse another checkout's server.
- Inspect complete relevant CSS sections before editing. Convert shared values at their source instead of retaining conflicting white backgrounds underneath appended overrides.
- Keep each task independently reviewable and commit only its exact files after tests pass.

## Task 1: Semantic theme and shared controls

**Staged delivery adjustment (2026-09-08):** First checkpoint delivers console tokens and the navigation shell from Task 2 only. Existing business-page colors stay isolated in `.page-stage` while pages are migrated in later checkpoints. Do not mark all of Task 1 complete: global forms/tables/auth still require dark-theme migration and visual verification. This prevents partially converted text/background pairs from becoming unreadable. No production release is authorized.

**Files:** modify `front-codex/src/styles.css`, `front-codex/src/components/ui/Primitives.jsx` only as necessary; create `front-codex/tests/e2e/specs/dark-console.spec.js`.

1. Add red tests using `installApiMock` and `seedAuthenticatedSession` from the existing helpers. Assert the page background, primary-button foreground/background contrast, visible focus and absence of light form/table surfaces on representative routes.
2. Start with an explicit test such as:

```js
test('console uses a dark base and readable primary action', async ({ page }) => {
  await installApiMock(page, async () => json([]))
  await page.goto('/fraudlist')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 17, 23)')
  const login = page.getByRole('button', { name: '登录 \\ 注册' })
  await expect(login).toHaveCSS('background-color', 'rgb(24, 191, 220)')
  await expect(login).toHaveCSS('color', 'rgb(7, 21, 29)')
})
```

3. Run `npm run test:e2e -- tests/e2e/specs/dark-console.spec.js --workers=1`, verify failure is the old visual state, not API/browser setup.
4. Implement the design's exact base tokens, surfaces, text, borders, semantic statuses, controls, focus rings, table separators, tabular numerals, reduced motion and color-scheme. Preserve labels/roles and control behavior.
5. Add a small tested luminance/contrast helper if needed: normal text at least 4.5:1 and non-text/focus affordances at least 3:1. Test actual computed styles rather than merely checking token declarations.
6. Run new tests plus `auth.spec.js`, `fraudlist.spec.js`, `settings.spec.js` and `npm run build`; commit `feat: establish dark console design tokens`.

## Task 2: Sidebar shell and global framing

**Files:** modify `front-codex/src/components/layout/AppShell.jsx`, `front-codex/src/components/layout/SiteFooter.jsx`, relevant shell styles in `front-codex/src/styles.css`; extend `shell-nav.spec.js`, `shell-guards.spec.js`, `site-footer.spec.js`, `dark-console.spec.js`.

1. Add failing checks for sidebar to the left of main content, current navigation indication, keyboard-operable brand/home and account actions, and retained footer links.
2. Preserve existing selectors where still meaningful; deliberately changed navigation wording/structure may update exact selectors but never remove behavioral assertions.
3. Replace topbar layout with fixed ~210px desktop sidebar. Keep real brand asset and existing icon family, active cyan rule, account controls at bottom and right workspace gutter. Keep current route-transition reduced-motion behavior.
4. Validate guest/authenticated/administrator route guards with mocks. Do not expose new admin navigation to unauthorized roles.
5. At 1280, 1440 and 1920 wide, assert sidebar/main separation and `scrollWidth <= clientWidth` for the document. Preserve and restyle the current <=1180px desktop-only message rather than promising new mobile workflows.
6. Run shell/footer/new theme tests and build; commit `feat: add dark console navigation shell`.

## Task 3: Planetary compact filters and clear bulk actions

**Files:** modify `front-codex/src/pages/Planetary.jsx`, corresponding planetary CSS; create `front-codex/tests/e2e/specs/planetary-console.spec.js`; extend relevant `planetary-filter-more.spec.js` / `planetary-ui-more.spec.js` only for intentional presentation changes.

1. Reuse the existing planetary mocks to write failing tests: multi-select open/close, dependency reset, keyboard Escape/focus behavior, unselected disabled action, selected count, visible action bar while result rows scroll, and distinct open-calculator action.
2. Required behavioral assertions include:

```js
await expect(page.getByRole('button', { name: /加入计算器/ })).toBeDisabled()
await page.locator('tbody .table-check-trigger').first().click()
await expect(page.getByRole('button', { name: /加入计算器.*1/ })).toBeEnabled()
await page.getByRole('button', { name: /加入计算器.*1/ }).click()
await expect(page.locator('.calculator-card')).toBeVisible()
```

3. Compact the existing searchable location selectors into accessible expandable controls without changing option arrays, selection dependencies, queries or service calls. Keep resource thumbnails/grouping/search in an expandable resource section. Keep labels and selected summary visible when closed.
4. Move verbose query instructions into an accessible disclosure; keep all existing query semantics. Keep table-local filters distinct from the submitted resource search.
5. Place a sticky batch-action bar within the result section: selection count, selection-clear control and cyan add button with visible count. The bar must remain visible without covering the last row/footer and must not escape a modal. Put subordinate open-calculator button at the upper workspace action position.
6. Preserve selection pruning, deduplication, already-added row state and automatic calculator opening. Never implement mock-only relevance ranking or arbitrary pagination from the generated image.
7. Run `npm run test:e2e -- tests/e2e/specs/planetary --workers=2` and new tests; commit `feat: streamline planetary console actions`.

## Task 4: Calculator theme and data-entry ergonomics

**Files:** modify calculator styles in `front-codex/src/styles.css` and, only for necessary markup, `front-codex/src/components/planetary/PlanetaryCalculatorModal.jsx`; extend `planetary-console.spec.js` and existing calculator tests.

1. Red tests for dark modal/input/menu surfaces, visible focused fields, maintained sortable headers/selected state and no viewport overflow.
2. Apply the same tokens to calculator stats, tabs, scheme menu, batch input controls, row fields and danger actions. Keep clear focus and unsaved/error status.
3. Do not change formulas, initial values, programme serialization, pricing calls, stable row keys or sorting comparator.
4. Run every `planetary-calculator*`, `planetary-programme*`, `planetary-price-error*` test plus full planetary suite; commit `feat: align calculator with console theme`.

## Task 5: All remaining frontend surfaces

**Files:** relevant CSS sections and, only where presentation requires it, `pages/FraudList.jsx`, `TacticalBoard.jsx`, `Login.jsx`, `FraudAdminLogin.jsx`, `Setting.jsx`, `FraudAdmin.jsx`, `LicenseAdmin.jsx`, `InfoCenter.jsx`, `components/tactical/TacticalStarMap.jsx`; extend `dark-console.spec.js`.

1. Add route matrix tests that seed the appropriate user/admin mocks and assert actual representative surfaces, dialogs, tables and fields use the dark palette. Inspect canvas/map labels as well as DOM controls.
2. Run tests red, then update one surface family at a time: public lists and dialogs; maps and route controls; authentication/settings; admin/authorization lists; information page.
3. Audit hardcoded hex/RGB and inline style values. Preserve semantic map/security distinctions; do not change map nodes, graph logic, domain colors without visual equivalence or routing behavior. Do not touch request helpers.
4. Verify real empty/loading/error states via mocks and ensure error text is readable. Authentication/authorization, user data and form submissions remain unchanged.
5. Run corresponding existing route suites after each family; commit small named commits rather than one unreviewable theme dump.

## Task 6: Full regression, independent review and visual QA

**Files:** create `design-qa.md`, optional test-only fixtures/screenshots under `front-codex/tests/e2e`; update the implementation evidence section.

1. Run `npm run build` and `npm run test:e2e -- --workers=2`; all existing tests plus additions must pass. Do not waive failures or weaken behavioral expectations to accommodate regressions.
2. Start a distinct local preview bound to 127.0.0.1 and open it with the in-app browser. Mock writes for visual QA; do not exercise live account/admin/production mutations.
3. Capture the selected visual's resource result state and the implementation at matching dimensions. Compare image pairs, not memory: sidebar size, whitespace, font hierarchy, table density, primary/secondary contrast, selection and footer.
4. Capture at least one representative state per existing route, calculator modal, auth/error forms, and 1280/1440/1920 widths; name any verification gaps accurately. Check keyboard focus, reduced motion, scrolling and no clipped actions.
5. Follow Product Design design-qa instructions. Write evidence-based `design-qa.md`; fix P0/P1/P2 findings and recapture until passed. Track any remaining P3 polish without endless looping.
6. Request independent code review via the requesting-code-review skill. Resolve actionable findings and rerun affected tests before claiming completion.
7. Hand off working local preview with test counts, visual QA evidence and exact branch. Keep production/master untouched. Merge/push only after explicit approval for this redesigned UI.

## Baseline evidence

- Initial worktree is clean at `00b4bfb`; original workspace untracked artifacts preserved.
- `npm ci --no-audit --no-fund`: passed, 120 packages installed, lockfile unchanged.
- Full E2E baseline: `npm run test:e2e -- --workers=2` passed all 77 tests in 1.1 minutes (2026-09-08). No business or test code was changed for this baseline.

## Completion evidence — 2026-09-08

User approved completing all remaining stages in one uninterrupted local iteration. Tasks 1–6 are implemented and verified; shared CSS families were migrated together to avoid partial-theme intermediate states. Navigation remains in the earlier local commit; business UI and verification are kept together in the final local change.

- Full redesign QA: `design-qa.md`, final result passed, with actual route/modal screenshots and recorded intentional reference differences.
- Final E2E: 98 passed in 54.3s, four workers; no retries/waived failures. Includes a deterministic regression for an existing early-rAF negative-zoom crash discovered during final testing and fixed by clamping animation progress.
- Final production build succeeded in 19.85s. No API/formula/authorization/schema changes; no new runtime dependencies.
- Independent full UI review and follow-up animation review found no remaining blocking issues.
- Local-only fixture preview: `npm run preview:ui`, 127.0.0.1:4182. Production API is not used by that preview.
- Branch/worktree retained. No push, merge, SSH, deployment, or change to the server's running business.
