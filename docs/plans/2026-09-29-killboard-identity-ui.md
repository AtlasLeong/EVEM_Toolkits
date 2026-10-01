# KM 角色身份与详情页 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 限制击毁报告首屏为前 7 个已识别角色，并用固定双栏布局清晰展示玩家、军团和装备。

**Architecture:** 在前端展示层过滤和截断参与者，不改变后端原始报告数据；将身份回退文案集中在 presentation helper；使用现有 KM CSS 的固定视口规则，让角色和装备列表各自滚动。

**Tech Stack:** React、Node test runner、Vite、现有 Killboard parser/API。

---

### Task 1: 参与者展示规则

**Files:**
- Modify: `front-codex/src/utils/killboardPresentation.js`
- Test: `front-codex/tests/unit/killboardPresentation.test.mjs`

**Steps:**
1. 为“仅保留有玩家名的前 7 条”与“军团缺失使用资料未返回”写失败测试。
2. 运行该单测确认先因新行为缺失而失败。
3. 实现过滤、截断和身份回退文案，保留真实 ID 作为次级信息。
4. 运行该单测确认通过。

### Task 2: 接入 KM 页面

**Files:**
- Modify: `front-codex/src/pages/Killboard.jsx`
- Modify: `front-codex/src/styles/killboard.css`

**Steps:**
1. 使用 helper 返回的前 7 条角色记录渲染角色区，并更新说明文案。
2. 让角色行显示玩家名、军团、联盟和伤害，缺失军团不显示“未知”。
3. 保持固定视口、角色区/装备区独立滚动，在窄屏下恢复顺序滚动。
4. 运行 KM 单测和构建，确认报告索引、装备分组和市场跳转不受影响。

### Task 3: 回归验证

**Files:**
- No new files.

**Steps:**
1. 运行 `node --test tests/unit/*.test.mjs`。
2. 运行 `npm run build`。
3. 运行 `git diff --check`。
4. 打开本地报告 19748417，确认没有“未知角色”，角色区最多 7 行且列表内部可滚动。
