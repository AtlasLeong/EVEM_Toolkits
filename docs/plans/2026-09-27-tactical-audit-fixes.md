# Tactical Audit Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复审查确认的战术板正确性、恢复和密集地图性能缺陷，并补齐搜索和移动端路径。

**Architecture:** 保留渲染器和真实投影。完整数据命中与抽样标签分离，实时相机与卡片求解解耦；业务权限与幂等性由后端继续强制保证。

**Tech Stack:** React 18, Vite, SVG, Node test runner, Playwright, Django/DRF, Channels.

---

## 执行清单

- [x] 基线：`node --test tests/unit/*.test.*`；`python manage.py test TacticalCollaboration --settings=EVE_MDjango.ci_settings`（后端隔离内存数据库）。
- [x] Task 1：连接与幂等恢复。
- [x] Task 2：海盗完整命中与连续缩放补绘。
- [x] Task 3：战争板有预算稳定排版与补绘。
- [x] Task 4：角色能力入口、海盗星系搜索及移动布局。
- [x] Task 5：集成回归、视觉检查、构建和独立审查。

结果及保留限制见 [验收报告](2026-09-27-tactical-audit-verification.md)。浏览器完整运行的一条定位器歧义已修正并定向复测；本轮未发布。

### Task 1: 连接与幂等恢复

Files: `backend/TacticalCollaboration/services.py`, `realtime.py`, `tests.py`; `front-codex/src/hooks/useTacticalSession.js`; corresponding unit tests.

1. 添加相同请求跨连接重放、内容变更冲突、撤权拒绝、过期租约与前端重新入场测试。
2. 运行新增测试，确认旧实现按预期失败。
3. 最小修复摘要与可恢复关闭码，保留权限核验、历史摘要安全比较和真实撤权清理。
4. 隔离后端和 hook 测试通过；记录兼容限制。

### Task 2: 海盗地图完整命中

Files: `front-codex/src/components/tactical/PirateIntelMap.jsx`, dedicated helper and new unit/E2E tests.

1. 测试超过 200 星系的非标签采样点可选、拖拽不触发上报、密集候选明确、连续缩小出现新星点。
2. 先运行失败；再实现全量坐标命中和有界实时底图更新，保留键盘焦点规则。
3. 运行海盗几何、焦点恢复和密集 E2E；不以延长超时替代修复。

### Task 3: 战争板性能

Files: `front-codex/src/components/tactical/CollaborationMap.jsx`, `src/utils/tacticalMarkerLayout.js`, dedicated performance/helper tests.

1. 添加同屏卡片预算、选中优先、平移稳定、持续缩放补绘测试；测量旧失败或超预算。
2. 缓存相机无关数据，限制昂贵卡片求解输入，手势期间轻量变换；未展示数量可见且记录可访问。
3. 对 50/100/300/900 同屏上报重新测量，验证不再平方爆炸，名称仍有空间。

### Task 4: 权限与界面路径

Files: `front-codex/src/components/tactical/TacticalReportForm.jsx`, `PirateIntelBoard.jsx`, `src/pages/TacticalCollaboration.jsx`, tactical CSS and tests.

1. 添加斥候只显示人数模式、海盗按战区搜索无目标星系、手机可进入地图路径测试。
2. 确认失败；实现能力驱动入口、分离目标筛选与星系定位、地图/列表切换。保留命名舰队指挥权限。
3. 统一缩放步幅和尺寸规则、改善小文字与占位符颜色；桌面和手机回归。

### Task 5: 验收

1. 并行工作只修改约定文件；根代理集成并审查 diff。
2. 执行全量单元、隔离后端、定向及完整战术 Playwright 测试。
3. `npm run build` 和 `git diff --check`；验证 390/768/1100/1440 截图及细圈恢复。
4. 独立代码审查处理具体问题；报告实测结果、局限和未发布状态。
5. 必要时本地提交检查点，不执行 push/merge/deploy。
