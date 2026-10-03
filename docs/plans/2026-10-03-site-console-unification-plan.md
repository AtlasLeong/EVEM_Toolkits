# 深色控制台视觉统一与制造页加载优化 Implementation Plan

执行方式：在当前隔离 worktree 内按任务实施，保留独立审查、真实浏览器验证和本地预览。

**Goal:** 统一全站深色控制台视觉节奏，并让制造目标切换后的目标图标和首层节点优先完成加载。

**Architecture:** 保留现有页面结构和素材哈希路径，在 `GameItemImage`/`MarketItemIcon` 增加可选加载优先级；制造页只给当前目标和展开首层传递优先级。新增一份最后加载的 console-unification 样式覆盖层，集中定义全局 token、页面标题/侧栏间距、制造页三栏栅格和中小屏堆叠断点，避免删除历史样式。通过单测、制造 e2e、响应式几何断言和构建预算验证。

**Tech Stack:** React 18, Vite, CSS custom properties, Playwright, Node test runner.

---

### Task 1: 图片优先级与稳定占位

**Files:**
- Modify: `front-codex/src/components/GameItemImage.jsx`
- Modify: `front-codex/src/components/MarketItemIcon.jsx`
- Modify: `front-codex/src/pages/ManufacturingEstimator.jsx`
- Test: `front-codex/tests/unit/gameItemImage.test.mjs`
- Test: `front-codex/tests/unit/marketItemIcons.test.mjs`

**Step 1: Write the failing test**

增加 `priority=true` 时渲染出的图片使用 `loading="eager"`、`fetchpriority="high"`，默认调用仍然是 `loading="lazy"` 的断言。

**Step 2: Run test to verify it fails**

Run: `node --test tests/unit/gameItemImage.test.mjs tests/unit/marketItemIcons.test.mjs`

Expected: 新增 priority 断言失败，因为组件当前没有该 prop。

**Step 3: Write minimal implementation**

给 `GameItemImage` 增加 `priority=false` 和 `fetchPriority` 可选 prop，向 `<img>` 传递 `loading`、`decoding` 和 `fetchpriority`；`MarketItemIcon` 透传该 prop。制造树的目标卡和首层可见节点传 `priority`，弹窗选项和深层节点保持默认 lazy。为图片盒子保留固定尺寸和轻量 skeleton class，避免加载时布局位移。

**Step 4: Run test to verify it passes**

Run: `node --test tests/unit/gameItemImage.test.mjs tests/unit/marketItemIcons.test.mjs`

Expected: 默认 lazy 分支和 priority eager/high 分支全部 PASS。

**Step 5: Commit**

```bash
git add front-codex/src/components/GameItemImage.jsx front-codex/src/components/MarketItemIcon.jsx front-codex/src/pages/ManufacturingEstimator.jsx front-codex/tests/unit/gameItemImage.test.mjs front-codex/tests/unit/marketItemIcons.test.mjs
git commit -m "perf: prioritize manufacturing item icons"
```

### Task 2: 全站控制台 token 与标题/边距覆盖层

**Files:**
- Create: `front-codex/src/styles/console-unification.css`
- Modify: `front-codex/src/main.jsx` (or the existing global style entry)
- Test: `front-codex/tests/unit/consoleUnification.test.mjs`

**Step 1: Write the failing test**

增加静态契约测试，确认统一样式文件包含 `--console-bg`、`--console-accent`、`--content-gutter`、`.page-head`、`.shell-main` 和 reduced-motion 规则。

**Step 2: Run test to verify it fails**

Run: `node --test tests/unit/consoleUnification.test.mjs`

Expected: 文件不存在或 token 断言失败。

**Step 3: Write minimal implementation**

新增最后加载的覆盖层：定义深海军蓝、 raised panel、琥珀操作色、青灰信息色、统一 border/radius/shadow、`--content-gutter` 与 `--page-max`；统一 `.shell-main`、`.page-stage`、`.page-head`、eyebrow、panel headings、按钮 focus ring、滚动条和 `prefers-reduced-motion`。不覆盖后台管理员独立组件的语义颜色，不改变权限和数据逻辑。

**Step 4: Run test to verify it passes**

Run: `node --test tests/unit/consoleUnification.test.mjs`

Expected: PASS。

**Step 5: Commit**

```bash
git add front-codex/src/styles/console-unification.css front-codex/src/main.jsx front-codex/tests/unit/consoleUnification.test.mjs
git commit -m "style: unify console layout tokens"
```

### Task 3: 制造页栅格、响应式和微交互

**Files:**
- Modify: `front-codex/src/styles/manufacturing.css`
- Modify: `front-codex/src/styles/console-unification.css`
- Test: `front-codex/tests/e2e/specs/manufacturing.spec.js`

**Step 1: Write the failing test**

增加 1024、820、768 和 390 宽度的页面断言：页面不产生横向滚动；1024/820/768 在合理断点下三栏堆叠或摘要折叠；切换目标后目标图片 `complete && naturalWidth > 0`；减少动效模式下不出现持续旋转动画。

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- --project=chromium tests/e2e/specs/manufacturing.spec.js`

Expected: 新增断点或图片优先级断言至少有一项失败。

**Step 3: Write minimal implementation**

统一制造页 header/panel 间距与全站 token；经真实布局验证在 1099px 以下切换为单列工作流，在 640px 以下压缩缩进但保留 44px 触控目标；目标切换、数量步进、购买/自造切换只使用颜色/边框/轻微 opacity 过渡，不使用会改变布局的 transform。图片采用固定尺寸和静态加载纹理，避免持续 shimmer。

**Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- --project=chromium tests/e2e/specs/manufacturing.spec.js`

Expected: 制造页全部场景 PASS。

**Step 5: Commit**

```bash
git add front-codex/src/styles/manufacturing.css front-codex/src/styles/console-unification.css front-codex/tests/e2e/specs/manufacturing.spec.js
git commit -m "ui: refine manufacturing responsive console layout"
```

### Task 4: 全量验证与视觉自检

**Files:**
- Review: `front-codex/src/styles/console-unification.css`
- Review: `front-codex/src/styles/manufacturing.css`
- Review: `front-codex/src/components/GameItemImage.jsx`

**Step 1: Run focused tests**

Run: `npm run test:unit` and the manufacturing e2e command from Task 3.

**Step 2: Run build and budget**

Run: `npm run build`.

Expected: Vite build and bundle budget both exit 0。

**Step 3: Run full frontend regression**

Run: `npm run test:e2e`.

Expected: existing suite plus new responsive/loading assertions pass。

**Step 4: Review visual checklist**

在 1440×900、1280×720、1024×768、820×768、390×844 检查：标题层级、边距、空白、侧栏/主内容起点、图片占位、hover/focus、无障碍对比度、reduced-motion 和横向滚动。

**Step 5: Request code review and commit any fixes**

用 code-reviewer 检查设计覆盖层是否引入跨页面回归；修复 Critical/Important 问题后再合并发布。

## 实施记录（2026-10-03）

- Task 1 已提交 `7c9767057`、`b7f9b1b67`：当前目标及首层图片 eager/high，深层及未选候选项保持 lazy。
- Task 2/3 已在本地完成：共用深色 token、28px 页面标题、24/20/16px 内容边距，制造三卡与小屏单列，市场图表空间和报价档位优化。
- 实际 CSS 使用最后加载的 `console-unification.css` 覆盖层；不删除历史页面 CSS。通过明确作用域优先级兼容延迟加载的路由样式。
- 大屏内容上限由初始方案的 1440px 调整为 1800px，避免 1920px 屏幕双走势被过度挤压。
- 独立视觉审查发现并修复平板战术板选中态、统计范围、标签计数及地图搜索文字对比度；新增 4 项真实页面对比度回归。
- 未改变权限、API、WebSocket 协议、制造计算或线上部署；生产私有查看账户策略保留。
- 验证与截图见 `2026-10-03-site-console-unification-verification.md`。
- Task 4 已完成：515 项单元测试、377 项主站 / 169 项战术浏览器用例、30 项沙盒契约及生产构建通过；独立审查的可读性/危险操作问题已补齐。当前仅保存本地分支，保留 worktree 与预览，不自动合并、推送或部署。
