# 战术板本地验证

本模块未推送、未发布，未连接线上数据库。使用独立演习数据库；本地默认组织采用已导入的真实星系静态快照，军情为测试数据，不代表真实战况或线上容量。旧合成组织仍保留用于回归。

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

如果统一入口必须使用 `EVE_MDjango.asgi:application`，请显式设置
`$env:TACTICAL_ASGI_ENABLED='1'`，并确认已安装 Channels/Redis 依赖；未设置时入口仍保持原有 HTTP-only 行为。

前端独立终端：

```powershell
Set-Location front-codex
npm ci --no-audit --no-fund
npm run dev:tactical
```

访问 http://127.0.0.1:4194/login ，登录后从侧栏进入「战术板」。现有登录页默认跳往防诈页面；本演习后端不提供防诈等业务接口，切换至战术板即可。本设置不会读取生产 `.env`，也不覆盖原有登录接口。

请使用专用 `dev:tactical` 命令：仅在该开发模式强制 API 指向 `http://127.0.0.1:8001/api`，不会因遗漏临时环境变量回退至线上接口。普通 `dev` 和生产构建不受影响。这里不能使用线上注册账号；若无法登录，请先检查 8001 后端是否已启动，再使用下列本地账号。我们已用页面表单验证登录并核对浏览器请求来自 8001，未修改线上账号或密码。

| 角色 | 本地邮箱 |
|---|---|
| 统帅 | founder@tactical.local |
| 指挥 | commander@tactical.local |
| 斥候 | scout@tactical.local |
| 新成员，待邀请审批 | newcomer@tactical.local |

以上四个**仅限本地**的账号密码均为 `TacticalLocal2026`。不要在任何真实账号使用该密码。使用不同浏览器/无痕窗口同时登录不同角色；同一浏览器共享登录状态，普通多标签页仍是同一账号。

默认演习组织为「真实星图 · 本地演习」，使用 Derelik（德里克）及 1 跳边界的公开静态星图局部范围。部署与人数均为本地演示军情，不代表真实战况；原有「北境联合 · 本地演习」合成组织保留用于回归。星系人数是本地频道观察到的**敌方人数**，同星系取最新观察，不与独立舰队相加。旧舰队线索保留在情报列表，仍可选择性采纳。

添加四处星系敌情演示（仅已初始化的本地真实星图组织；重复执行保留现有编辑与观察时间）：

```powershell
.venv/Scripts/python.exe scripts/tactical/system_intel_demo.py
```

真实快照导入（仅当前隔离演习库，绝不连接线上 MySQL）：

```powershell
.venv/Scripts/python.exe scripts/tactical/real_universe.py fetch-import
```

脚本只从固定公开 HTTPS GET 地址读取四组静态数据和精确父级关系，导入前检查回环配置、数据库表和固定快照路径；会记录来源时间、内容摘要与公开数据缺口，重复执行不会重置组织、成员、密码或兵力编辑。导入结果和限制见 `docs/plans/2026-09-21-tactical-immersive-map-verification.md`。

建议体验顺序：

1. 用统帅账号进入战术板。默认展示真实星图，右侧列表收起；点击星系查看敌方人数、作者、观察时间、历史及相邻星门。点击密集星系放大局部，使用「返回」回到上一视野。极近重叠星系通过名称菜单选择。
2. 另开无痕窗口登录斥候：只能看到敌方部署，没有己方层和人员名单。「快速上报」默认「人数上报」：只需选择星系、填写敌方人数，不用判断舰队。留空代表未知，填 0 代表确认没有。知道舰队身份时切换「新增舰队」，可选“大航队、远炮战列队”等名称或自定义；构成与备注均选填。
3. 命名舰队提交后立即上图，无需确认。同星系最多展示三支舰队标签，其余点数量展开；标签各自居中、按内容宽度排列。再次发现同一舰队，用「更新已有舰队」或详情里的「更新这支舰队」增加自己的观察，不按名字合并，不重复增加部署。详情显示上报者与观察时间；只能修订自己的上报，旧观察保留历史且不覆盖新估计，修订不会撤销指挥移动。「星系总人数」仍是独立模式，绝不与各支舰队相加。
4. 统帅/指挥可将独立部署拖至任意已加载真实星系；重叠落点须先选择名称。拖动属于人工位置修正，自动审计原因，不伪称星门通行，不刷新观察时间或移动星系人数。明确的「通过相邻星门」操作仍校验真实星门。空白、地图外和原地松手不提交。斥候不能移动部署。
5. 总览默认统计当前战区，可切到组织全部；搜索、缩放不改变统计口径。逐星系优先使用最新人数上报，无人数上报时取舰队合计，不重复相加。未知、过期、范围外均明确标记；地图和列表双向选中，但实时更新不抢镜头。统帅/指挥右上角独立成员卡显示成员总数与在线人数，点击管理人员；「上报记录」单独保留观察历史。
6. 手机窄屏显示兵力总览、上报记录和操作，仍可上报，不下载星图；需要寻路时使用「星系导航」入口。请注意这个演习后端不包含原网站其他业务接口，原寻路回归由独立测试验证。

本地文件 `backend/.tactical-local.sqlite3*`、`.venv` 均被 Git 忽略。重复 seed 不重置已有操作、密码或军情。数据脚本拒绝非演习设置、其他数据库路径和数据库符号链接。SQLite 演习专用后端使用 `BEGIN IMMEDIATE` 串行化事务，避免并发读后写升级锁失败；这不是 MySQL 行锁验证。

2026-09-22 已为本地库执行 `0005_named_fleet_observations`；迁移前备份位于 `.venv/tactical-pre-named-fleets-20260922.sqlite3`。通过实际斥候页面在组织 7 的「玛斯帕」添加了“大航队 100人”“远炮战列队 50人”两支演示舰队；旧记录保留。这些是假想军情，不代表真实游戏战况。新功能验证见 `docs/plans/2026-09-22-tactical-named-fleets-verification.md`。

## 复现检查

```powershell
.venv/Scripts/python.exe -m unittest discover -s scripts/tactical/tests -v
.venv/Scripts/python.exe scripts/tactical/smoke_recovery.py --base-url http://127.0.0.1:8001
.venv/Scripts/python.exe scripts/tactical/load_board.py --base-url http://127.0.0.1:8001 --accounts 100 --duration-seconds 600
```

Smoke 使用真实 HTTP/WebSocket 验证审批、敌我隔离、报告归属、幂等、修订、移动、归档、在线降级和踢出，也验证星系人数即时共享、禁止采纳为独立舰队，以及修正舰队位置不改变观察时间或星系人数。具名舰队覆盖即时共享与来源作者、同星系独立 ID、明确 ID/版本更新不重复计数、旧观察不覆盖、来源修订不撤销移动。它会在本地创建一个独立测试组织，保留测试审计记录，不删除数据。重复运行达到演习统帅的组织数量上限时，可以加 `--fresh-owner`，创建仅用于该次演习的新本地拥有者（不可用密码），不重置现有账号或组织。

负载工具只接受显式 `http://127.0.0.1:<port>`，不能指向生产。它使用独立容量演习组织：100 个独立账号、101 人拒绝、同账号额外标签页去重、每 10 秒一次部署变更。目标为持续 600 秒且本地可见延迟 p95 < 2 秒。结果只覆盖小数据量，**不覆盖最大记录数、慢客户端、重连风暴或真实 MySQL 多进程争用**。

## 发布前必须补齐

- 在隔离 MySQL 上验证 99→100 并发准入、同时改同一部署、移除与写入竞争、数据库重启；不得用 SQLite 结果替代。
- 确认是否采用 ASGI 长连接；现有 WSGI 和发布脚本未切换。WS 不可用时前端使用授权 HTTP 快照降级。
- 审核默认“仅统帅恢复被移除成员”的保守策略；指挥仍可批准普通新申请、移除当前斥候。
- 备份数据库、执行新增迁移、检查 Origin/代理/版本健康，再单独批准上线。

详见 `docs/plans/2026-09-21-collaborative-tactical-board-runtime.md` 和验证记录。
