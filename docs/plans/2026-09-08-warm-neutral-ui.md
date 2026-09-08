# Warm Neutral UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply the approved customer-facing warm-neutral design across the existing frontend, preserve business behavior, and deliver local browser screenshots without publishing.

**Architecture:** Keep React routes, authentication, API contracts, calculations, uploads, and permissions intact. Replace shared color tokens and layout rules, use the existing transparent logo with a black display filter, and reorganize planetary controls without changing search/selection state. Keep the functional star-map canvas dark for readable astronomical data while its surrounding interface follows the light system.

**Tech Stack:** Existing React 18, Vite, Lucide icons, TanStack Query, Playwright. No new runtime dependency or backend change.

## Approved design

- Source: `docs/design/warm-neutral-approved.png` (the revised image selected by the user).
- Warm-white content, pale neutral sidebar, charcoal text/actions, restrained terracotta selected/add states; muted semantic colors retain meaning.
- No visible “工作空间” anywhere. Black transparent original rabbit avatar, no badge, backing, or border.
- Collapsible left navigation; account controls remain accessible at low heights and while collapsed.
- Planetary: compact selectors; secondary table filters behind “高级筛选”; one paired add/open-calculator group beside results; large continuous table.
- Restyle every existing customer/admin/auth screen and modal. Do not invent new routes or remove fields/functions. Feedback submission, uploads and private replies remain unchanged.
- Preserve existing desktop-width support boundary; verify 1280/1440/1920 and low-height windows. Expanding mobile functionality is outside this visual migration.

## Task 1 — Baseline and isolation

1. Create ignored worktree `.worktrees/ui-warm-neutral` on `codex/ui-warm-neutral` from release `93078a4`.
2. Run `npm ci --prefer-offline --no-audit --no-fund` and `npm run test:e2e -- --workers=4` in `front-codex`; record the baseline.
3. Copy the approved image into this worktree. Preserve all unrelated files and the existing dark preview on port 4182.

## Task 2 — Test-first shared shell and tokens

Files: `front-codex/src/styles.css`, `src/components/layout/AppShell.jsx`, `tests/e2e/specs/dark-console.spec.js`, `console-surfaces.spec.js`, new `warm-neutral.spec.js`.

1. Update only obsolete palette expectations to the approved light values and add failing tests for absent workspace wording, black/transparent logo, collapsible keyboard-accessible nav and expanded content, including persistence after reload.
2. Run the focused tests; confirm failures are the missing redesign, not infrastructure errors.
3. Set shared tokens: background `#faf9f6`, sidebar `#f0efeb`, panel `#ffffff`, text `#242422`, muted `#6c6a63`, action `#242422`, accent `#a6533e`; `color-scheme: light`. Replace dark-only literal state colors.
4. Implement `collapsed` state with guarded localStorage reads/writes, labelled toggle, `aria-expanded`, and nav titles. Use CSS `filter: brightness(0)` for the original transparent logo. Keep native link and logout behavior.
5. Run focused tests green, then commit this scoped change.

## Task 3 — Planetary layout

Files: `src/pages/Planetary.jsx`, `src/styles.css`, `tests/e2e/specs/planetary-console.spec.js`, related table-filter tests.

1. Write failing tests requiring exactly one visible calculator-entry group in the results header, secondary filters initially collapsed, and selection/sorting intact after disclosure changes.
2. Run focused tests red. Remove duplicate header/bottom calculator entries, move existing actions to the result header, and make the result header sticky when scrolling the document.
3. Move existing table-filter controls into an accessible advanced disclosure. Do not remove filters, clear state when toggling, or modify request payloads/calculation formulas. Keep dependent location selector disabling even when the mock simplifies its copy.
4. Use a continuous lightweight table with numeric alignment; preserve local table scrolling where necessary to keep controls in view.
5. Run all affected search/filter/calculator tests green.

## Task 4 — Whole-product surfaces

Files: `src/styles.css`, `src/pages/Feedback.jsx` only if customer copy needs adjusting; map remains a dark data surface.

1. Cover feedback, authentication, settings, management pages, calculator and upload dialogs with warm palette and readable controls. Preserve existing feedback layout and all persistence/error handling in this pass: only the planetary layout has an approved visual target.
2. Add whole-route color/overflow tests and inspect computed contrast for primary/semantic actions and controls.
3. Run focused tests and fix failures without weakening functional assertions.

## Task 5 — Visual QA and review

Files: `front-codex/tests/preview/server.mjs`, `docs/design/`, `design-qa.md`.

1. Allow an explicit local preview port, default unchanged; start isolated fixtures on 4183. No production data or credentials.
2. Use user-authorized Playwright CLI to view actual pages, set the reference-size viewport, perform search/selection/calculator and feedback flows, and save screenshots under `output/playwright/`.
3. Compare approved source and actual resource screenshot together at matching dimensions; inspect all remaining routes and major modal states. Fix P0/P1/P2 issues and recapture. Document acceptable deviations (real security values, dependent selector copy, data-map dark canvas).
4. Run `npm run build` and the complete `npm run test:e2e -- --workers=4`. Request an independent code review and address actionable findings; rerun relevant tests.
5. Save final visual QA with `final result: passed` only after evidence, record actual test totals, retain local branch and preview, and provide screenshots. No push, merge, deployment or backend restart.

## Execution record

- Worktree created; approved design confirmed. Baseline test run in progress.
