# EVEM Toolkit UI 精修实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不改变业务逻辑的前提下，统一暖白控制台视觉系统并为登录、反馈、行星资源、星系导航提供可靠的移动端布局。

**Architecture:** 先在 CSS Token 和 AppShell 层建立全局视觉/响应式基础，再通过少量语义 class 调整页面级布局。测试采用现有 Playwright 预览夹具，新增移动 viewport 回归，保持桌面既有行为断言。

**Tech Stack:** React 18, Vite, CSS, Lucide, Playwright.

---

### Task 1: 全局设计 Token 与布局基础

**Files:**
- Modify: `front-codex/src/styles.css`
- Test: `front-codex/tests/e2e/specs/responsive-shell.spec.js`

Steps:

1. Add failing viewport assertions for 390px and 768px: no horizontal overflow, no `.desktop-only-mask`, touch controls at least 44px, and content starts below the mobile brand bar.
2. Run the focused spec and verify it fails against the current desktop-only behavior.
3. Refine CSS variables for surface hierarchy, text contrast, border, shadow, spacing, radius and typography; add mobile base rules and responsive shell layout.
4. Run the focused spec and existing shell specs; keep all existing desktop assertions passing.
5. Commit `style: establish responsive visual system`.

### Task 2: Responsive AppShell navigation

**Files:**
- Modify: `front-codex/src/components/layout/AppShell.jsx`
- Modify: `front-codex/src/styles.css`
- Test: `front-codex/tests/e2e/specs/responsive-shell.spec.js`

Steps:

1. Extend the failing spec to require mobile brand/menu semantics, accessible navigation, and keyboard focus.
2. Run it red.
3. Implement a mobile top bar and a compact horizontally scrollable navigation region while preserving desktop sidebar and persisted collapse preference.
4. Ensure login/logout/settings actions remain reachable without horizontal overflow.
5. Run focused shell tests at 390/768/1280 and commit `feat: make app shell responsive`.

### Task 3: Login and feedback mobile layouts

**Files:**
- Modify: `front-codex/src/pages/Login.jsx`
- Modify: `front-codex/src/pages/Feedback.jsx`
- Modify: `front-codex/src/styles.css`
- Test: `front-codex/tests/e2e/specs/responsive-auth-feedback.spec.js`

Steps:

1. Add failing mobile assertions for usable field widths, 44px controls, one-column feedback composition, attachment controls, and no page overflow.
2. Run the spec red.
3. Add only semantic classes/structure needed to make login tabs, inputs, buttons, feedback tabs, form, file list and empty states responsive.
4. Run focused auth/feedback specs at mobile and desktop viewports.
5. Commit `style: polish auth and feedback responsive layouts`.

### Task 4: Planetary and starmap responsive tool surfaces

**Files:**
- Modify: `front-codex/src/pages/Planetary.jsx`
- Modify: `front-codex/src/pages/TacticalBoard.jsx`
- Modify: `front-codex/src/styles.css`
- Test: `front-codex/tests/e2e/specs/responsive-tools.spec.js`

Steps:

1. Add failing mobile assertions for filter disclosure, calculator action visibility, starmap control stacking, canvas containment and route controls.
2. Run it red.
3. Add semantic classes only where existing markup needs a mobile layout hook; use CSS to stack filters, preserve action priority, and keep the canvas inside the viewport.
4. Run existing planetary/starmap suites plus the focused responsive spec.
5. Commit `style: adapt tool surfaces for mobile`.

### Task 5: Visual QA, regression and review

**Files:**
- Modify: `front-codex/tests/e2e/specs/responsive-shell.spec.js` if needed
- Modify: `front-codex/tests/e2e/specs/responsive-auth-feedback.spec.js` if needed
- Modify: `front-codex/tests/e2e/specs/responsive-tools.spec.js` if needed
- Create: `docs/plans/2026-09-19-ui-polish-results.md`

Steps:

1. Run full Playwright suite at desktop and focused mobile specs; record exact pass counts.
2. Run `npm run build`.
3. Capture 1440px, 768px and 390px screenshots for login, feedback, planetary and starmap using the preview server.
4. Perform an independent code/visual review for overflow, focus, contrast and accidental business logic changes.
5. Record results and residual limitations in the report; commit `test: verify responsive ui polish`.

No deployment, push, merge, server changes or production package are part of this plan.
