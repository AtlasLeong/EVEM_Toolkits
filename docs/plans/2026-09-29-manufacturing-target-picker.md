# 制造目标分类选择器 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将制造页的目标切换改成按舰船、材料、建筑分组的可搜索浮层/移动抽屉，并隐藏所有内部物品 ID。

**Architecture:** `TargetPicker` 管理浮层打开状态、名称过滤和分组渲染；页面只负责传入配方和选择回调。CSS 使用现有制造终端变量实现桌面锚定浮层与移动底部抽屉，不增加第三方依赖。

**Tech Stack:** React 18、CSS、Playwright E2E、Vite。

---

### Task 1: 写目标选择器行为测试

**Files:**
- Modify: `front-codex/tests/e2e/specs/manufacturing.spec.js`

**Step 1: Write the failing test**

覆盖点击切换目标后打开分类菜单、三组标题、搜索只匹配名称、菜单不包含物品 ID、点击目标后关闭、Escape 关闭和移动端宽度。

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium`

Expected: FAIL because the current search field is always visible and results are not grouped.

### Task 2: 实现分类浮层/抽屉

**Files:**
- Modify: `front-codex/src/pages/ManufacturingEstimator.jsx`

**Step 1: Implement the minimal component behavior**

让 `TargetPicker` 管理 `isOpen`，按 `CATEGORY_LABELS` 分组过滤，只按名称匹配；移除结果项的 `productId` 文本；添加外部点击和 Escape 关闭；选择目标后调用 `onSelect` 并关闭。

**Step 2: Run the focused E2E test**

Run: `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium`

Expected: behavior assertions pass except for visual layout if CSS has not been updated.

### Task 3: 设计终端主题样式

**Files:**
- Modify: `front-codex/src/styles/manufacturing.css`

**Step 1: Implement styles**

添加 popover backdrop、分类标题、分组列表、选中态和移动底部抽屉样式；保留现有主题变量和键盘 focus ring，避免引入新的颜色系统。

**Step 2: Run E2E and build**

Run: `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium` and `npm run build`.

Expected: focused E2E and production build pass.

### Task 4: 视觉验收与提交

**Files:**
- Verify: `front-codex/output/playwright/manufacturing-target-picker-desktop.png`
- Verify: `front-codex/output/playwright/manufacturing-target-picker-mobile.png`

**Step 1: Capture desktop and mobile screenshots**

Use Playwright CLI against `http://127.0.0.1:4185/manufacturing`.

**Step 2: Run full verification**

Run: `node --test tests/unit/*.test.mjs`, focused manufacturing E2E, `npm run build`, `git diff --check`.

**Step 3: Commit**

```bash
git add docs/plans/2026-09-29-manufacturing-target-picker-design.md docs/plans/2026-09-29-manufacturing-target-picker.md front-codex/src/pages/ManufacturingEstimator.jsx front-codex/src/styles/manufacturing.css front-codex/tests/e2e/specs/manufacturing.spec.js
git commit -m "feat: add categorized manufacturing target picker"
```
