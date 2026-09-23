# Project Contrast UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve readability and visual hierarchy across the EVEMToolkit content pages, tactical board, Starsea, and corporation views without changing the product information architecture.

**Architecture:** Keep the existing warm-neutral global theme and dark tactical map. Introduce semantic contrast tokens in `styles.css`, then scope tactical, Starsea, and corporation overrides to those tokens. Use small responsive layout fixes only where screenshots and tests show real crowding.

**Tech Stack:** React, Vite, CSS modules-by-convention, Playwright, Node test runner, existing React Query and Framer Motion stack.

---

### Task 1: Add contrast tokens and baseline control rules

**Files:**
- Modify: `front-codex/src/styles.css:1-32, 440-445, responsive blocks`
- Test: `front-codex/tests/e2e/specs/warm-contrast.spec.js`

**Step 1: Write the failing checks**

Add assertions for the effective placeholder color/opacity, visible input border, and focus ring on a representative search field. Keep the assertions semantic (computed color, opacity, border color) rather than snapshot pixels.

**Step 2: Run the focused test**

Run: `npx playwright test tests/e2e/specs/warm-contrast.spec.js --project=chromium`

Expected: the new assertions fail against the current muted placeholder and border values.

**Step 3: Implement the minimum token change**

Add explicit `--console-ink`, `--console-muted-strong`, `--console-quiet`, `--console-line-strong`, and `--focus-ring` tokens. Keep the existing aliases for compatibility. Set placeholder opacity to `1` and use the semantic muted token. Strengthen control borders and keep focus rings at least 2px with a 3px offset.

**Step 4: Run the focused test again**

Run: `npx playwright test tests/e2e/specs/warm-contrast.spec.js --project=chromium`

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/styles.css front-codex/tests/e2e/specs/warm-contrast.spec.js
git commit -m "fix(ui): strengthen shared contrast tokens"
```

### Task 2: Improve tactical sidebar hierarchy and state contrast

**Files:**
- Modify: `front-codex/src/styles/tacticalCollaboration.css:154-770`
- Modify: `front-codex/src/styles/tacticalOverview.css:1-70`
- Test: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Step 1: Write the failing checks**

Add assertions for tab, location, age, source, overview hint, and count-row text computed colors, plus selected/idle state differences. Assert key metadata is at least 12px.

**Step 2: Run the focused tactical tests**

Run: `npx playwright test --config=tests/tactical-e2e/playwright.config.js --grep "sidebar|overview|contrast|members|reports" --reporter=line`

Expected: new computed-style assertions fail.

**Step 3: Implement the minimum hierarchy change**

Define tactical light-surface tokens at the page scope. Replace low-contrast literals with `tactical-ink`, `tactical-muted`, `tactical-quiet`, and `tactical-line`. Raise important metadata to 12px, keep only explanatory copy at 13px quiet text, and make active tabs/filters use text + background + border signals. Preserve existing card layout and permissions.

**Step 4: Run focused tactical tests**

Run the same command as Step 2.

Expected: PASS and no existing card/archive behavior changes.

**Step 5: Commit**

```bash
git add front-codex/src/styles/tacticalCollaboration.css front-codex/src/styles/tacticalOverview.css front-codex/tests/tactical-e2e/tactical.spec.js
git commit -m "fix(tactical): clarify sidebar hierarchy and states"
```

### Task 3: Restore dark-map connector and filter visibility

**Files:**
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/styles/tacticalMapIntel.css`
- Test: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Step 1: Write the failing check**

Add a computed SVG style check for inactive gate/leader connectors and selected versus idle filter states.

**Step 2: Run the focused check**

Run: `npx playwright test --config=tests/tactical-e2e/playwright.config.js --grep "connector|filter|gate" --reporter=line`

Expected: inactive connector opacity/state assertion fails.

**Step 3: Implement the minimum change**

Raise the inactive connector visibility floor without making the map noisy. Add an explicit selected filter border/underline/icon signal. Keep the existing active connector promotion, drag hit-testing, and reduced-motion behavior.

**Step 4: Run focused and performance tests**

Run: `npx playwright test --config=tests/tactical-e2e/playwright.config.js --grep "connector|filter|gate|wheel zoom|stable marker" --reporter=line`

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/components/tactical/CollaborationMap.jsx front-codex/src/styles/tacticalMapIntel.css front-codex/tests/tactical-e2e/tactical.spec.js
git commit -m "fix(tactical): keep map connectors readable"
```

### Task 4: Improve Starsea and corporation form/readability surfaces

**Files:**
- Modify: `front-codex/src/styles/starsea.css:2-130, 421-535, 965-1109`
- Modify: `front-codex/src/styles/corporations.css:27-130, 1508-1564`
- Test: `front-codex/tests/e2e/specs/warm-contrast.spec.js`, relevant Starsea/corporation E2E specs

**Step 1: Write the failing checks**

Add mobile assertions for search placeholder visibility, input border, report model source text, and long corporation action layout at 390px.

**Step 2: Run the focused tests**

Run: `npx playwright test tests/e2e/specs/warm-contrast.spec.js tests/e2e/specs/responsive-shell.spec.js tests/e2e/specs/starmap-summary.spec.js --project=chromium`

Expected: new assertions fail against the current faint borders and small metadata.

**Step 3: Implement the minimum surface changes**

Use explicit Starsea/corporation surface tokens, raise placeholder and report-source contrast, strengthen search borders, keep metadata at 12px minimum, and allow long mobile actions to wrap or use a two-column/primary-full-row layout.

**Step 4: Run focused mobile tests**

Run the same command with the mobile project/config used by the existing responsive suite.

Expected: PASS with no horizontal overflow.

**Step 5: Commit**

```bash
git add front-codex/src/styles/starsea.css front-codex/src/styles/corporations.css front-codex/tests/e2e/specs
git commit -m "fix(ui): clarify starsea and corporation surfaces"
```

### Task 5: Remove duplicate responsive overrides and verify the whole project

**Files:**
- Modify: `front-codex/src/styles.css` (consolidate duplicate responsive blocks only; preserve selectors)
- Modify: `front-codex/tests/e2e/specs/responsive-shell.spec.js` if coverage needs a regression case
- Docs: `docs/plans/2026-09-23-project-contrast-ui-design.md`

**Step 1: Run repository checks before cleanup**

Run:

```bash
cd front-codex
node --test tests/unit/*.test.mjs tests/preview/*.test.mjs
npm run build
npx playwright test --config=tests/tactical-e2e/playwright.config.js --reporter=line
npx playwright test tests/e2e/specs/warm-contrast.spec.js tests/e2e/specs/responsive-shell.spec.js --project=chromium
```

Expected: all existing tests pass; record counts in the verification note.

**Step 2: Consolidate only proven duplicate selectors**

Move duplicate responsive rules into one ordered block, without changing page-specific selectors or behavior. Use `git diff --check` to catch formatting mistakes.

**Step 3: Run the full frontend suite**

Run: `npm run test:e2e` from `front-codex`.

Expected: PASS.

**Step 4: Build and check bundle budget**

Run: `npm run build && npm run check:bundle`.

Expected: PASS with no unexpected chunk growth.

**Step 5: Commit and prepare release**

```bash
git add front-codex/src/styles.css front-codex/tests docs/plans
git commit -m "refactor(ui): consolidate responsive contrast rules"
```

Then use `superpowers:verification-before-completion` to verify tests and use the existing production workflow only after local evidence is complete.
