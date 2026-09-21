# 战术板沉浸式星图验证记录

日期：2026-09-21（本地工作树）

## 结果

战术板已改为星图优先的沉浸式布局：桌面端地图铺满主区域，顶部状态栏、左侧检索/阵营筛选、缩放工具和右侧部署情报栏以浮层方式呈现；收起右栏不会改变地图视口。手机端不下载星图，只保留部署/情报与快速上报，并提供路径规划入口。

地图数据已在隔离演习数据库导入一份公开静态快照：

- 来源：`https://evemtk.com/api`，固定 HTTPS GET，无账号、Cookie、代理凭据或写入请求。
- 规范化数据：67 个星域、786 个星座、5,428 个星系、13,744 条有有效端点的星门记录（6,872 个无向连接）。
- 快照校验：`9babb98178588a1e2e11f6fec311b84f3a6770ad477806251987b45237e2a984`。这是可复现内容摘要，不是来源签名，也不保证游戏客户端数据时效。
- 公开接口缺少端点的 26 条星门及 4 个无公开星系的关系被记录到快照 omissions 并跳过；没有猜测坐标、层级或安全系数。
- “真实星图 · 本地演习”组织只使用 Derelik（德里克）及一跳边界作为默认局部范围；原有合成演习组织和用户编辑保留。

## 自动化验证

- `scripts/tactical/tests`：13 项安全/纯函数测试通过。
- Django 隔离回归：260 项通过，1 项既有条件跳过。
- Node 单元与预览测试：92 项通过。
- 战术板 Playwright：27/27 通过，覆盖真实安等显示、桌面浮层、面板收起、组织 URL、斥候权限、手机不下载地图、拖动相邻星门、局部范围筛选等。
- 原有前端 Playwright：211/211 通过，覆盖登录、军团、反馈、星图寻路、行星计算器等既有功能。
- `npm run build` 通过。现有主入口约 503 kB 的 Vite 提示仍存在，属于既有整体包体告警，不影响本次功能；战术页面分包约 57 kB。
- `git diff --check`、Python 编译与迁移漂移检查通过。

## 本地打开

在工作树根目录分别运行后端和前端命令（详见 `scripts/tactical/README.md`）：

```powershell
Set-Location backend
$env:DJANGO_SETTINGS_MODULE='EVE_MDjango.tactical_local_settings'
../.venv/Scripts/python.exe -m uvicorn EVE_MDjango.tactical_asgi:application --host 127.0.0.1 --port 8001 --ws-max-size 4096 --ws-max-queue 4

Set-Location front-codex
npm run dev:tactical
```

打开 `http://127.0.0.1:4194/login`，使用 `founder@tactical.local` / `TacticalLocal2026` 登录，再进入战术板。也可直接访问 `/tactical?organization=7`（登录仍然必须由后端验证）。

本地模式仅强制回环 API，不读取生产 `.env`，未推送、未合并、未部署，也未修改线上数据库。真实公开快照文件 `backend/.tactical-universe.json` 被 Git 忽略；重复导入使用固定回执，不重置组织改名、成员移除、密码或兵力编辑。

## 已知边界

这份快照是公开静态星图的可复现导入，不是游戏实时军情。现有战术板仍是单组织协同模型（最多 100 人），WebSocket 是授权快照同步而非完整事件回放；上线前仍需按 README 的 MySQL 并发、ASGI、Origin/代理与备份清单单独验收。本次工作没有触碰旧的 `/starmap` 路由和寻路算法。
