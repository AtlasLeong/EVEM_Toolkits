# 战术板本地验证

本模块未推送、未发布，未连接线上数据库。默认使用独立演习数据库和虚构星系，不能代表真实游戏星图或线上容量。

## 启动（PowerShell）

在本功能工作树根目录执行；已有 Django 项目环境可用 `--system-site-packages` 复用。全新环境改为安装 `backend/requirements-tactical-demo.txt`，其中包含隔离 Django 测试依赖、跨来源中间件和测试客户端。

```powershell
python -m venv --system-site-packages .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements-tactical.txt
.venv/Scripts/python.exe scripts/tactical/local_seed.py --load-accounts 101
```

后端独立终端：

```powershell
Set-Location backend
$env:DJANGO_SETTINGS_MODULE='EVE_MDjango.tactical_local_settings'
../.venv/Scripts/python.exe -m uvicorn EVE_MDjango.tactical_asgi:application --host 127.0.0.1 --port 8001 --ws-max-size 4096 --ws-max-queue 4
```

前端独立终端：

```powershell
Set-Location front-codex
npm ci --no-audit --no-fund
$env:VITE_API_URL='http://127.0.0.1:8001/api'
npm run dev -- --host 127.0.0.1 --port 4194 --strictPort
```

访问 http://127.0.0.1:4194/login ，登录后从侧栏进入「战术板」。现有登录页默认跳往防诈页面；本演习后端不提供防诈等业务接口，切换至战术板即可。本设置不会读取生产 `.env`，也不覆盖原有登录接口。

| 角色 | 本地邮箱 |
|---|---|
| 统帅 | founder@tactical.local |
| 指挥 | commander@tactical.local |
| 斥候 | scout@tactical.local |
| 新成员，待邀请审批 | newcomer@tactical.local |

以上四个**仅限本地**的账号密码均为 `TacticalLocal2026`。不要在任何真实账号使用该密码。使用不同浏览器/无痕窗口同时登录不同角色；同一浏览器共享登录状态，普通多标签页仍是同一账号。

默认演习组织为「北境联合 · 本地演习」：3 支敌方、2 支己方、1 条待确认情报，24 个虚构星系。局部范围默认加载其中 2 个星域及 1 跳边界。清楚区分“情报”和“已确认部署”，不会自动累加重复目击。

建议体验顺序：

1. 用统帅账号进入战术板，查看敌我筛选、人员管理、战区范围及地图缩放。点击一支敌军查看舰种和观察时间。
2. 另开无痕窗口登录斥候：只能看到敌方部署，没有己方层和人员名单。点击「快速上报」，搜索一个示例星系，填人数与舰种；留空代表未知，填 0 代表确认没有。
3. 回到统帅/指挥窗口，在「情报」中核对并确认，选择新部署或明确关联已有部署。再用斥候修改自己的上报，确认不会未经审核直接改掉部署人数。
4. 用统帅/指挥拖动部署至高亮相邻星系，或在详情中选择目标移动；斥候窗口同步位置。非星门相邻的位置修正必须单独填写原因。
5. 手机窄屏只显示情报列表和操作，仍可上报；需要寻路时使用「星系导航」入口。请注意这个演习后端不包含原网站其他业务接口，原寻路回归由独立测试验证。

本地文件 `backend/.tactical-local.sqlite3*`、`.venv` 均被 Git 忽略。重复 seed 不重置已有操作、密码或军情。数据脚本拒绝非演习设置、其他数据库路径和数据库符号链接。SQLite 演习专用后端使用 `BEGIN IMMEDIATE` 串行化事务，避免并发读后写升级锁失败；这不是 MySQL 行锁验证。

## 复现检查

```powershell
.venv/Scripts/python.exe -m unittest discover -s scripts/tactical/tests -v
.venv/Scripts/python.exe scripts/tactical/smoke_board.py --base-url http://127.0.0.1:8001
.venv/Scripts/python.exe scripts/tactical/load_board.py --base-url http://127.0.0.1:8001 --accounts 100 --duration-seconds 600
```

Smoke 使用真实 HTTP/WebSocket 验证审批、敌我隔离、报告归属、幂等、修订、移动、归档、在线降级和踢出。它会在本地创建一个独立测试组织，保留测试审计记录，不删除数据。

负载工具只接受显式 `http://127.0.0.1:<port>`，不能指向生产。它使用独立容量演习组织：100 个独立账号、101 人拒绝、同账号额外标签页去重、每 10 秒一次部署变更。目标为持续 600 秒且本地可见延迟 p95 < 2 秒。结果只覆盖小数据量，**不覆盖最大记录数、慢客户端、重连风暴或真实 MySQL 多进程争用**。

## 发布前必须补齐

- 在隔离 MySQL 上验证 99→100 并发准入、同时改同一部署、移除与写入竞争、数据库重启；不得用 SQLite 结果替代。
- 确认是否采用 ASGI 长连接；现有 WSGI 和发布脚本未切换。WS 不可用时前端使用授权 HTTP 快照降级。
- 审核默认“仅统帅恢复被移除成员”的保守策略；指挥仍可批准普通新申请、移除当前斥候。
- 备份数据库、执行新增迁移、检查 Origin/代理/版本健康，再单独批准上线。

详见 `docs/plans/2026-09-21-collaborative-tactical-board-runtime.md` 和验证记录。
