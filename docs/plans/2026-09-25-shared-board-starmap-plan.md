# Shared Board Starmap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make pirate intelligence and war sandbox share the same legible starmap base without mixing their business data.

**Architecture:** Extract neutral SVG primitives from CollaborationMap; reuse those primitives and its screen-space label solver in PirateIntelMap. Keep business wrappers independent. Coalesce pirate wheel gestures into DOM layer transforms with a single settled React commit.

**Tech Stack:** React 18, SVG, Vite, Node test runner/esbuild, Playwright.

### Task 1: Shared rendering (isolated implementer)

Files: create `front-codex/src/components/tactical/BoardMapPrimitives.jsx`; modify `CollaborationMap.jsx`; create `front-codex/tests/unit/boardMapPrimitives.test.mjs`.

1. Write failing rendering tests for ordinary/selected/reported fixed-screen star radii, shared gate styles, centered name and security text.
2. Run the new test and observe missing-component failure.
3. Extract `BoardStarGlyph`, `BoardGateLine`, `BoardSystemLabel` and security presentation helpers, keeping all war CSS classes and interaction wrappers intact.
4. Test and commit only owned files locally. No push.

### Task 2: Pirate adapter and camera (main agent)

Files: `PirateIntelMap.jsx`, `pirateIntelMap.css`, `tests/unit/pirateIntelMap.test.mjs`.

1. Add failing tests for shared rendering and settled camera scheduler previews.
2. Replace pirate static circle/label drawing with the shared primitives; use bounded candidate sampling and `layoutIntelLabels` for screen-space name/security placement.
3. During wheel bursts update world and overlay transforms per animation frame; commit once after quiet time. Cancel stale work on immediate actions, scope changes and unmount.
4. Preserve marker grouping, approximation, history, search/focus, safe areas and always-visible card tethers. Add fade/reduced-motion CSS and shared backdrop color.
5. Run unit tests and fix regressions without weakening assertions.

### Task 3: Local verification and review

Files: `tests/tactical-e2e/pirate-density.spec.js`, optional shared comparison harness and regression tests.

1. Verify desktop and mobile visuals, fixed dot size after zoom, readable labels/security, camera drag, marker selection and card anchors.
2. Run full unit and tactical E2E suites, production build and bundle budget check.
3. Independent spec review then code quality review; address actionable findings.
4. Start local preview with an explicit port, capture actual browser output, report test evidence and local-only delivery status. Do not push or deploy.
