# Solid Compass Replacement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the live hollow-center compass with the user-approved broader, solid-center version while preserving transparency, EVEM text and all business behavior.

**Architecture:** Add a new PNG filename to invalidate the prior icon cache; reuse that same URL for both navigation images, favicon and touch icon. Keep existing layout/CSS and old assets unchanged for rollback.

**Tech Stack:** React, Vite, PNG, Playwright, existing GitHub Actions Production workflow.

## Approved design

Broader solid charcoal needle, no central hole, slightly stronger broken ring, same four cardinal points, northeast cyan tip. No additional symbols, Chinese descriptor, or background plate. User approved the warm-white preview and requested replacement; final asset must have real alpha transparency.

## Task 1 — Baseline and failing regression

- Work in ignored `.worktrees/compass-solid`, branch `codex/compass-solid` from origin/master.
- Run `npm ci --no-audit --no-fund`, then `npm run test:e2e -- tests/e2e/specs/shell-nav.spec.js tests/e2e/specs/responsive-shell.spec.js --workers=2`; expect 6 baseline tests pass.
- In `front-codex/tests/e2e/specs/shell-nav.spec.js`, sample the central 12% square from the decoded PNG canvas and require >90% opaque dark pixels. Keep transparency, dark/cyan, dimensions and navigation checks.
- Run `npm run test:e2e -- tests/e2e/specs/shell-nav.spec.js --workers=1`; expect the existing hollow-center image to fail the new density assertion.

## Task 2 — Asset-only integration

- Copy the built-in image edit output unchanged to `front-codex/public/evem-compass-solid.png`.
- In `front-codex/src/components/layout/AppShell.jsx`, change both image sources to `/evem-compass-solid.png`; no other JSX or behavior changes.
- In `front-codex/index.html`, point favicon/touch icon to the exact same URL.
- Update only the image-source expectations in `front-codex/tests/e2e/specs/shell-nav.spec.js` and `responsive-shell.spec.js`.
- Run targeted suite (expect green), `npm run build`, then `npm run test:e2e -- --workers=4` (expect 150 pass).
- Use a local preview on port4183 and Playwright CLI to inspect screenshots at1440x960 and390x844; verify the fuller shape has no backdrop or clipping. Keep screenshots in root `output/playwright/compass-solid/`.

## Task 3 — Review and publish

- Independent read-only review of scoped diff and asset.
- Commit scoped files, fetch and merge to master without overwriting unrelated files. Verify merged build and targeted tests, then push master.
- Follow Production workflow through successful verify and publish jobs.
- Verify frontend `/deploy-version.json` matches pushed SHA, logo200/image/png and SHA256 matches local, JS/CSS200, `/api/boardregions`200; backend `/api/deploy-version/` remains `ffce3c4ede4615bd42778e71d89a5b59ebe98d25`.
- Inspect live desktop/mobile screenshots. If deployed regression occurs, use existing workflow rollback (no DB rollback).

## Asset provenance

Built-in image editor, approved reference `exec-45ab3d87-b18a-4060-bfa7-ea4badf840e4.png`; output `exec-b2edb5f4-9a6b-4ea8-adf4-1b1e6e61bed3.png` (1254x1254 PNG with alpha,404726 bytes).

Final prompt: Remove the light background from this exact compass logo and output a transparent PNG cutout with real alpha transparency. Background-extraction edit only. Preserve the thick black solid needle, cyan tip, broken ring, four cardinal points and exact proportions. All empty space inside and outside the compass must be transparent. No new background, no pattern, no text. Keep the center needle solid without a hole. Do not redesign the logo.

## Local verification

- PNG SHA256: `5d0dd9e50976cce39f65cffb840e11d6c131942ca54baabd3fefa52c179d961e`; four corners alpha0, center alpha254.
- Baseline6 tests passed. Center-density test failed against old icon (0.5322 <0.9); after replacement targeted6 passed.
- `npm run build` passed; `npm run test:e2e -- --workers=4`:150 passed (1.8m). `git diff --check` passed.
- Independent asset/production preflight and scoped code review: no blocking findings.
- Local desktop1440x960/mobile390x844 screenshots inspected, with zero browser console warnings/errors. Root artifacts: `output/playwright/compass-solid/.playwright-cli/page-2026-09-19T17-32-10-173Z.png` and `page-2026-09-19T17-32-13-553Z.png`.
- Deployment and post-release live checks remain required after merge/push.
