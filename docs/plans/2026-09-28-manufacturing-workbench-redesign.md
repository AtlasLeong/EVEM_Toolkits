# Manufacturing Workbench Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a local preview of a warm-neutral manufacturing workbench with unambiguous make/buy controls.

**Architecture:** Preserve the pure recursive cost engine and live quote adapter. Replace page presentation with a compact toolbar, target/parameter rail, expandable bill-of-material rows and contextual cost inspector. All styles remain scoped and reuse shared console tokens.

**Tech Stack:** React, existing lucide icons, CSS grid, node:test and existing Playwright regression suite.

## Approved design and constraints

- The user requested a first implementation preview after agreeing to explicit make/buy controls and a complete redesign. Local only; no deployment requested.
- Research: Carbon expandable data tables (https://v10.carbondesignsystem.com/components/data-table/usage/) and Atlassian contextual panels (https://atlassian.design/components/panel/usage).
- Prefer the shared warm-white/grey/terracotta shell, not a teal terminal. Dense aligned rows, restrained separators, legible 12–14px supporting type, 24px title, minimal outer margin.
- Current engine defaults recipes to make. Preserve that and the user's earlier full-manufacture intent; previous claim that intermediates already default to buy was incorrect.
- Explicit make/buy buttons on every recipe, including root; terminal raw materials remain purchase-only with an explanation. Same item has one route throughout the plan.
- Bulk actions are clearly named: all makeable items self-made, buy intermediates while keeping target self-made, restore default. Do not claim to restore an unsaved custom plan.
- Target search has clear open/close state and ship/material/building filters. Selecting a different target resets route/manual prices so old decisions cannot leak into it.
- Efficiency is not verified and must remain visibly marked as not applied; no invented formula or persistence claim.

## Task 1: Explicit route interaction and target selector

Files: modify `front-codex/src/pages/ManufacturingEstimator.jsx` and `front-codex/tests/e2e/specs/manufacturing.spec.js`.

1. Add failing browser regression coverage for an actual nested recipe, explicit selected make/buy state, child prune/restore, fixed purchase leaves, bulk actions and target switching.
2. Run focused regression and confirm missing control failure.
3. Replace inverse toggle with `onModeChange(itemId, mode)`; expose pressed state and contextual controls. Build bulk overrides from the full catalog graph rather than the pruned display tree. Reset target-local overrides/manual inputs only when target changes.
4. Add browsable target picker and root expansion; preserve decimal-price/quote behavior.
5. Re-run browser regression.

## Task 2: Scoped workbench presentation

Files: replace `front-codex/src/styles/manufacturing.css`; add layout tests to existing manufacturing regression.

1. Add failing style/geometry checks at 1440x900, 1280x800 and 390x844 for token-aligned page colors, no document horizontal overflow, visible route controls and desktop viewport fit.
2. Replace stacked overrides with one stylesheet; remove unscoped `.eyebrow`, `.dot`, `.is-spinning` selectors. Map to console variables, remove mint/teal colors.
3. Preserve narrow viewport stacking, panel-local scroll, keyboard focus and target menu scroll.
4. Run layout tests and inspect screenshots of desktop/mobile and nested chain.

## Task 3: Verification and handoff

1. Independent spec review, then quality review of page/styles/tests.
2. Run `node --test tests/unit/manufacturingCatalog.test.mjs tests/unit/manufacturingPlan.test.mjs tests/unit/manufacturingQuoteAdapter.test.mjs` in front-codex.
3. Run `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium` and `npm run build`.
4. Start/reuse local Vite on 127.0.0.1:4173, open preview, save screenshots to output/playwright. Leave unrelated TacticalUsage changes untouched.
