# 战术星系搜索与海盗星系上报 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在两块战术板的真实星图上提供可发现、可访问的星系交互：战争沙盘搜索并定位当前战区星系，海盗板点击星系后预填目标线索地点。

**Architecture:** 复用战争板现有 `systemQuery`/`focusSystem` 与地图投影，新增稳定的搜索空状态和键盘行为；复用海盗板现有 `PirateSightingForm`，让 `PirateIntelMap` 只负责发出系统选择事件，表单负责地点状态与提交校验。不会新增 API 或数据库字段。

**Tech Stack:** React 18, SVG, Vite, Node test runner, Playwright.

---

### Task 1: 为可复用系统搜索结果和系统选择建立失败单元测试

**Files:**
- Modify: `front-codex/tests/unit/tacticalMapInteraction.test.mjs`（如现有测试文件已包含相关辅助函数，则放在对应文件）
- Create: `front-codex/src/utils/tacticalSystemSearch.js`

**Step 1: Write the failing test**

覆盖：中文名/英文名/系统 ID 匹配、空查询返回空结果、最多 8 条并保留原顺序、无结果状态，以及结果标签显示当前范围与安等。

**Step 2: Run test to verify it fails**

Run: `node --test tests/unit/tacticalSystemSearch.test.mjs`

Expected: FAIL because the search helper does not exist.

**Step 3: Write minimal implementation**

实现纯函数 `searchTacticalSystems(systems, query, limit = 8)` 和 `formatTacticalSystemResult(node)`；不做网络请求、不修改输入数组。

**Step 4: Run test to verify it passes**

Run: `node --test tests/unit/tacticalSystemSearch.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/tests/unit/tacticalSystemSearch.test.mjs front-codex/src/utils/tacticalSystemSearch.js
git commit -m "test: specify tactical system search behavior"
```

### Task 2: 改进战争沙盘搜索入口、状态与聚焦反馈

**Files:**
- Modify: `front-codex/src/pages/TacticalCollaboration.jsx:649-651,781-785,990-1005`
- Modify: `front-codex/src/styles/tacticalCollaboration.css:1516-1525,1631-1642`
- Modify: `front-codex/tests/tactical-e2e/map-scope.spec.js`
- Modify: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Step 1: Write the failing test**

增加 Playwright 断言：搜索控件在地图左上可见；结果带“当前范围”与安等；无结果显示“当前范围没有匹配星系”；点击结果后系统被选中且原真实星图节点仍存在；Escape 清空结果。

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/tactical-e2e/map-scope.spec.js tests/tactical-e2e/tactical.spec.js --grep "search|搜索|范围没有"`

Expected: FAIL on the new labels/status assertions.

**Step 3: Write minimal implementation**

使用 Task 1 纯函数生成结果，加入结果数量和当前范围文案、无结果状态、Escape 处理和输入焦点样式；选择结果沿用 `focusMapSystem`，不替换地图数据或生成星座卡片。

**Step 4: Run test to verify it passes**

Run the same Playwright command.

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/pages/TacticalCollaboration.jsx front-codex/src/styles/tacticalCollaboration.css front-codex/tests/tactical-e2e/map-scope.spec.js front-codex/tests/tactical-e2e/tactical.spec.js
git commit -m "feat: make tactical system search discoverable"
```

### Task 3: 为海盗真实星系增加可访问点击命中区

**Files:**
- Modify: `front-codex/src/components/tactical/PirateIntelMap.jsx:350-368,396-576,607-618`
- Modify: `front-codex/src/components/tactical/BoardMapPrimitives.jsx:14-26`（仅在需要共享命中样式时）
- Modify: `front-codex/src/styles/pirateIntelMap.css`
- Modify: `front-codex/tests/unit/pirateIntelMap.test.mjs`

**Step 1: Write the failing test**

验证地图输出包含每个真实系统的 `role="button"` 命中节点、系统 ID/名称的无障碍标签，并向 `onSelectSystem` 传递完整节点；验证系统标签与点共享同一选择语义。用测试工具模拟按键/点击时，拖拽移动超过阈值不触发系统选择。

**Step 2: Run test to verify it fails**

Run: `node --test tests/unit/pirateIntelMap.test.mjs`

Expected: FAIL because `onSelectSystem` is not a prop and static stars are `aria-hidden`.

**Step 3: Write minimal implementation**

新增 `onSelectSystem`、`selectedSystemId` props和稳定回调 ref；为系统绘制透明命中圆与键盘语义，标签点击委托同一回调；在 SVG pointer handlers 中记录点击起点，仅静止点击激活，不影响目标 marker/card 的 stopPropagation 语义。

**Step 4: Run test to verify it passes**

Run: `node --test tests/unit/pirateIntelMap.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/components/tactical/PirateIntelMap.jsx front-codex/src/components/tactical/BoardMapPrimitives.jsx front-codex/src/styles/pirateIntelMap.css front-codex/tests/unit/pirateIntelMap.test.mjs
git commit -m "feat: make pirate map systems selectable"
```

### Task 4: 把点击星系传入海盗上报表单并覆盖表单回归

**Files:**
- Modify: `front-codex/src/components/tactical/PirateIntelBoard.jsx:48-60,332-340`
- Modify: `front-codex/src/components/tactical/PirateSightingForm.jsx:39-44,70-82`
- Modify: `front-codex/tests/tactical-e2e/pirate-intel.spec.js`（若文件不存在，在现有 pirate E2E 文件中新增）
- Modify: `front-codex/tests/unit/pirateIntel.test.mjs`（若已有表单测试，沿用对应测试文件）

**Step 1: Write the failing test**

验证：点击真实星系后表单打开、地点显示“已选：<星系名>”、提交按钮在角色名/船型缺失时仍禁用；清除地点后可重新搜索；目标卡点击仍选择目标，不打开新上报表单。

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/tactical-e2e/pirate-intel.spec.js --grep "星系|上报|目标卡"` and the focused unit test command.

Expected: FAIL because the map callback and `initialLocation` prop do not exist.

**Step 3: Write minimal implementation**

`PirateIntelBoard` 增加 `reportLocation` 状态；星系回调保存 `{id, name, security_status}` 并打开表单；表单用 `initialLocation` 初始化精确星系地点，在打开切换板或关闭后不残留上一次预选地点；保存成功刷新并清理状态。

**Step 4: Run test to verify it passes**

Run the same focused unit/E2E commands.

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/components/tactical/PirateIntelBoard.jsx front-codex/src/components/tactical/PirateSightingForm.jsx front-codex/tests/tactical-e2e/pirate-intel.spec.js front-codex/tests/unit
git commit -m "feat: report pirate targets from a star system"
```

### Task 5: 全量验证、构建与交付检查

**Files:**
- Modify only if tests expose a regression; otherwise no source changes.

**Step 1: Run unit tests**

Run: `node --test tests/unit/*.test.mjs`

Expected: all existing and new tests pass.

**Step 2: Run focused and tactical E2E tests**

Run: `npx playwright test tests/tactical-e2e/map-scope.spec.js tests/tactical-e2e/tactical.spec.js tests/tactical-e2e/pirate-intel.spec.js`

Expected: PASS; capture screenshots for the war search and pirate star report flows if the preview fixture supports them.

**Step 3: Build and check bundle**

Run: `npm run build`

Expected: Vite build and bundle budget check pass.

**Step 4: Inspect diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors and only intentional source/tests/docs are tracked.

**Step 5: Commit verification note if needed**

If no source changes remain, retain the task commits; otherwise commit only the final test/build fix with a focused message.
