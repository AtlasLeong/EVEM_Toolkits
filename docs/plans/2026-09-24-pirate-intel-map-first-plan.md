# 海盗情报板地图优先布局 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将海盗情报板改为与战争沙盘一致的全幅星图、浮动搜索/卡片/详情，并增加有依据的“当前时段可能活跃”目标提示。

**Architecture:** 保留海盗 API、数据投影与独立 SVG 地图；只重构其页面外壳与地图目标卡。活跃判定为纯函数，使用服务端已过滤记录和 UTC 时间；不触碰战争业务状态或后端权限。

**Tech Stack:** React、CSS、Vite、Node test、Playwright E2E；工作区为 `.worktrees/pirate-intel-board`。

---

### Task 1: 当前时段候选判定

**Files:**
- Modify: `front-codex/src/utils/pirateIntel.js`
- Test: `front-codex/tests/unit/pirateIntel.test.mjs`

**Steps:**
1. 先写失败测试：UTC 起止跨午夜、开始含/结束不含、无完整时段、最新有效目击超过 48 小时、撤下记录不得入选；同身份只返回最新有效位置。
2. 运行 `node --test tests/unit/pirateIntel.test.mjs`，确认因缺少 `currentPirateTargets` 失败。
3. 实现纯函数 `currentPirateTargets(targets, now)`；不从全局状态读取其他斥候记录，排序按最近目击时间降序。
4. 重跑单测，确认全通过。

### Task 2: 地图上的目标卡与定位

**Files:**
- Modify: `front-codex/src/components/tactical/PirateIntelMap.jsx`
- Modify: `front-codex/src/styles/pirateIntelMap.css`
- Test: `front-codex/tests/unit/pirateIntelMap.test.mjs`

**Steps:**
1. 写失败测试：一个定位点一张紧凑卡（角色名/船型）；同地点多个目标聚合；卡锚与地点精度不变，星图缩放不使卡片漂移；外部选中目标可定位相应标记。
2. 运行 `node --test tests/unit/pirateIntelMap.test.mjs`，核对预期失败。
3. 保留 `createPirateMapGeometry` 和相机数学，在地图 HTML 浮层中绘制可点击卡；密集时聚合，历史状态弱化但保持可读；星座级不伪装为精确星系。
4. 重跑单测与现有地图单测，保持 SVG 星系/星门与拖拽/缩放行为。

### Task 3: 地图优先页面壳、浮动搜索与活跃面板

**Files:**
- Modify: `front-codex/src/components/tactical/PirateIntelBoard.jsx`
- Modify: `front-codex/src/styles/pirateIntelBoard.css`
- Modify if needed: `front-codex/src/styles/tacticalCollaboration.css`
- Test: `front-codex/tests/tactical-e2e/multiboard.spec.js`

**Steps:**
1. 先加失败 E2E：海盗/战争板切换后地图都占主舞台；桌面搜索与目标卡浮在地图内；点搜索结果/活跃候选打开地图上的详情；输入框只有一层边框；手机列表/详情优先和地图延迟加载保持。
2. 运行 `npx playwright test tests/tactical-e2e/multiboard.spec.js --config tests/tactical-e2e/playwright.config.js`，确认新断言失败在旧布局。
3. 将海盗板外壳改为与 `.tac-immersive` 同规格：地图铺底、顶端紧凑命令栏、左侧浮动搜索/目标列表、右侧详情、活跃候选浮层；不改变 `snapshot`/`refresh`/权限控制与表单流程。
4. 用服务器时间偏差驱动分钟级候选刷新；无时段、过期、地图失败时给清晰状态。修正搜索内框与焦点态。窄屏保留可访问的列表优先流程和按需地图加载。
5. 重跑 E2E；必要时按行为变化调整旧布局断言，不能删掉权限/撤下/手机按需加载覆盖。

### Task 4: 回归与本地视觉验收

**Files:**
- Test only unless发现缺陷: `front-codex/tests/unit/*.test.mjs`, `front-codex/tests/tactical-e2e/*.spec.js`

**Steps:**
1. 运行 `node --test tests/unit/*.test.mjs`、`npm run build`、相关 E2E；失败必须修复后重跑。
2. 在本地预览的海盗/战争板桌面与手机尺寸检查地图面积、浮层重叠、搜索可读性、目标卡定位、切板后主舞台尺寸；保留截图作为视觉依据。
3. 运行 `git diff --check` 并检查改动范围；仅本地提交，**不推送、不部署**。
