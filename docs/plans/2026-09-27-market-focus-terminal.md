# Market Focus Terminal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the approved first market design with 48 real icons and deploy the verified frontend.

**Architecture:** Preserve React Query/API behavior and the existing measured SVG chart. Refactor presentation within the market page only; static icon lookup and a reusable image component integrate user-supplied assets. Desktop grid dedicates most space to the graph; responsive styles preserve phone usability.

**Tech Stack:** React 18, React Query, Vite, existing Lucide icon family, native SVG chart, Node tests and Playwright regression runner.

---

### Task 1: Real item assets

Create `front-codex/public/images/market-items/`, `src/utils/marketItemIcons.js`, `src/components/MarketItemIcon.jsx`, and `tests/unit/marketItemIcons.test.mjs`. Test known numeric/string IDs, invalid/unknown IDs, all 48 files, WebP dimensions and size budget before implementation. Copy only approved WebP files under stable ID-based names; retain provenance documentation without local usernames or credentials. Component supplies fixed dimensions, decorative alt, asynchronous decoding, lazy loading and a standard library fallback on unknown/error. Do not alter page/CSS in this task. Run targeted Node tests, then independent spec/quality review.

### Task 2: Focus layout and plot hierarchy

Modify `src/pages/MarketPrices.jsx`, `src/pages/MarketTrendChart.jsx`, `src/styles/market.css`; add `tests/e2e/specs/market-focus-terminal.spec.js`. First assert default single sell chart, icon loading, one-row toolbar/statistics, wide plot, quote rail, no page overflow and no misleading realtime/depth text. Observe expected failures. Implement compact warm toolbar + framed dark catalog/plot/rail; move range controls alongside side controls; emphasize current statistic, label 30-day extrema, add last-observation graph label without stale-value misrepresentation. Preserve null/empty/keyboard/readout behavior. Update old tests only where expectations intentionally change (default mode, copy), keeping geometry and correctness assertions.

### Task 3: Verification and design QA

Run `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs`, all market E2E specs plus dark-console smoke and `npm run build`. Test 1920×1080, reference-sized 1672×941, 1440×960, 1280×720 and 390×844; inspect sell/buy/both, filter/search, tooltip, 0/null/extreme prices, image failure and interrupted fetch. Open selected reference and real rendered screenshots in a combined comparison; document required typography/layout/color/assets/content checks and resolved P0/P1/P2 findings in root `design-qa.md`. Run independent specification review then quality review and fix findings.

### Task 4: Merge and deploy

Inspect remote branches, repository CI/deploy workflow and current production revision. Stage only task files, commit, push a `codex/` branch, create and attach a PR. Wait for required checks, merge only after passing review, trigger/observe the existing frontend deployment and verify the live revision/route/assets. Do not restart or redeploy backend/collector unnecessarily. Record commands, test counts, PR and deployment result below.

## Execution record

- Approved design implemented with 48 byte-verified lossless WebP assets. Scoped presentation overrides live in `market-focus.css`, leaving administration unchanged.
- TDD: 10 icon tests observed failing before implementation and passing afterward; focus default/asset/null tests observed failing before implementation. Added precision regression failed on collapsed adjacent levels, then passed after the fix.
- Final local verification: 364 Node unit/preview tests; 110 market/shell E2E tests in one clean run (3.7 minutes); final 10 focus E2E cases (15.3 seconds), including huge quote and image-decoded screenshots; production build plus bundle budget passed.
- Earlier parallel runs had cold-start timeouts and shared test-server teardown interference. No retry or timeout protections were weakened; a non-overlapping two-worker final run passed. Final captures were refreshed after image decoding.
- Independent asset specification/quality and terminal specification/quality reviews approved. Fixed mobile plot/readout overlap, exact adjacent price levels and warm-header focus contrast. Combined visual comparison passed; see root `design-qa.md`.
- Deployment baseline: frontend/master `41f0157dbf1886b31fa7f73164d14825168f6fa1`; backend `c66fe6693e4c991d687084c4c2b907babf0ac9a0`; backend tree unchanged `221a6e8bfbdf0b0396302eff967f328706faacd8`. Existing GitHub CI/Production workflow will build, verify and publish; PR/production URLs are recorded in the task handoff.
