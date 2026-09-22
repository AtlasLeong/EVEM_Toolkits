# 战术板体验修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成战术板最近反馈的布局、标签、移动反馈、情报标记和自适应尺寸修复。

**Architecture:** 保持后端真实星门、版本校验和作者专属修改权限不变；按“所有敌方都对斥候可见”扩展敌方报告的读取投影。前端增加独立报告标记、短时消息和统一地图 Dock，报告不并入 Force 聚合。后端不改数据库结构，不连接生产库。

**Tech Stack:** React, SVG, CSS, Node test runner, Playwright, Django/Channels（现有接口）。

---

### Task 1: 写地图行为回归测试

**Files:**
- Modify: `front-codex/tests/tactical-e2e/tactical.spec.js`
- Modify: `front-codex/tests/unit/tacticalMapLayout.test.mjs`

**Steps:**
1. 添加 toast、地图 wheel、无效拖动、报告标记和自适应宽度的失败断言。
2. 运行单测/E2E，确认新断言在旧实现上失败。

### Task 2: 修复地图消息、工具 Dock 和标签策略

**Files:**
- Modify: `front-codex/src/pages/TacticalCollaboration.jsx`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/styles/tacticalCollaboration.css`

**Steps:**
1. 将成功消息改为短时 toast，并恢复无效拖动反馈。
2. 合并地图底部控件，整理边界出口入口。
3. 按缩放和密度显示标签并提供名称兜底。
4. 运行针对性测试。

### Task 3: 增加独立情报标记

**Files:**
- Modify: `front-codex/src/pages/TacticalCollaboration.jsx`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/utils/tacticalMapLayout.js`

**Steps:**
1. 传入可见报告，过滤已被正式兵力采纳的报告。
2. 绘制带作者和船型摘要的独立 marker，不参与 Force 汇总。
3. 添加报告标记测试，验证确认前可见、确认后不重复。

### Task 4: 自适应兵力/情报标记宽度

**Files:**
- Modify: `front-codex/src/utils/tacticalMarkerLayout.js`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`

**Steps:**
1. 按内容长度计算宽度并限制上下界。
2. 超长内容用省略号，title 保留完整文本。
3. 运行布局单测。

### Task 5: 全量验证和本地服务重启

**Files:**
- None

**Steps:**
1. 运行前端单测、战术 E2E、星图性能 E2E 和构建。
2. 停止旧 8001 后端并用当前代码重启。
3. 验证公开星图数据不含本地合成数据。

### 审查补充

- 实屏发现 25 个星座卡片在总览重叠：总览使用自适应导航网格，不绘制虚构连线；局部作战图继续使用真实坐标和真实星门。
- 拖动以 pointer-up 的最终位置判定；拒绝屏幕外目标，不把隐藏星系当作有效落点。
- 斥候可读其他成员的敌方上报，但只能修改自己的上报；HTTP 和 WebSocket 采用一致的脱敏投影。
- 重复目击最多显示两条标记，并保留“查看全部”；长作者名和船型摘要截断，完整内容在标题和侧栏可查看。
- 开发模式首次加载的旧会话 snapshot 请求需在异步准入完成后再检查取消状态，避免 StrictMode 已清理会话继续请求。
