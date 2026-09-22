# 阶段 3、4、5 验证记录

日期：2026-09-23。范围：当前本地工作树；未推送、未合并、未部署。

## 阶段 3：回归阻塞

- TacticalCollaboration 旧测试已迁移至当前权限契约，不再假设斥候可以创建 `fleet` / `fleet_intel` 或编辑舰队。
- 斥候场景改为 `system_count`，具名舰队场景由统帅/指挥执行；越权场景仍保留 403 断言。
- `state_version` 已从命令返回值与快照断言中明确区分。
- `python manage.py test TacticalCollaboration.tests --settings=EVE_MDjango.ci_settings --verbosity 1`：101/101 通过。
- 后端合并回归范围（战术协作、战术板、授权、反馈、社区、部署边界及传输测试）：332/332 通过，1 个 Windows 平台跳过。

## 阶段 4：前端分包

- `App.jsx` 的页面路由统一使用 `React.lazy` 与 `Suspense`。
- Vite 手动拆分 React、动画、图标、查询和图表依赖。
- 构建主入口从约 498 kB 降至约 17.7 kB；最大 JavaScript vendor chunk 约 157 kB。
- 前端单测：178/178 通过。
- `npm run build`：通过。
- 页面路由 smoke：11/11 通过；战术板浏览器回归：25/25 通过。

## 阶段 5：发布门禁

- 新增 `scripts/check-bundle.mjs`，构建会自动检查入口、JavaScript 和 CSS 预算。
- CI 增加独立 bundle budget 步骤，超预算直接失败并保留证据。
- 既有本地负载脚本仍明确拒绝非回环目标，不把 SQLite 演习结果包装成 MySQL 容量结论。
- 战术安全脚本：13/13 通过；部署脚本测试：38 通过、8 个平台能力跳过。
- `makemigrations --check --dry-run`：无未生成迁移。

## 仍需隔离环境完成

- 真实 MySQL 多进程并发、数据库重启、慢客户端和重连风暴。
- ASGI/代理/TLS/备份恢复配置验收。
- 这些不是本地代码阻塞，不在本轮连接线上或执行生产迁移。
