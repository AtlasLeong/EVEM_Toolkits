# 多板战术组织与海盗情报板实施计划

> **给实施者：** 按测试先行逐项执行；每一小项先运行目标测试确认因缺功能而失败，再写最小实现并重跑。全部内容只在 `codex/pirate-intel-board` 本地工作树进行。

**目标：** 一人最多创建三个组织，每组织最多三块独立战争/海盗板，旧数据安全归入首块战争板；海盗斥候只见自己的“角色名＋船型”目标目击，并可在真实星图查看标记。

**架构：** 组织继续承载成员/邀请/在线租约；新增 Board 承载类型、名称与范围。战争 Report/Force 加 board 归属并保持未传 board_id 的旧 API 兼容。海盗目击采用独立表与独立服务/HTTP 投影，不进入战争快照或组织广播。前端在组织创建、板切换、海盗工作区显示两种板，手机端列表优先。

**技术栈：** Django + DRF + SQLite CI / MySQL 生产兼容；React 18 + Vite + lucide-react；Python Django tests、Node test、Playwright。

## 任务 1：板模型与数据迁移

**文件：** `backend/TacticalCollaboration/models.py`、`backend/TacticalCollaboration/migrations/0007_*`、`backend/TacticalCollaboration/tests/test_multiboard.py`。

1. 测试：旧组织迁移获得一块战争板，原 Report/Force 归属它；新模型允许同组织三块同类型或混合类型；板范围相互独立。运行 `python manage.py test TacticalCollaboration.tests.test_multiboard --settings=EVE_MDjango.ci_settings --noinput` 看预期失败。
2. 实现 Board 模型及 nullable Report/Force.board；迁移回填旧数据和范围。增加必要索引；旧组织默认战争板，直接创建的测试组织可按兼容逻辑创建默认板。
3. 重跑目标测试和 `python manage.py makemigrations --check --dry-run --settings=EVE_MDjango.ci_settings`。

## 任务 2：组织创建额度与板目录

**文件：** `backend/TacticalCollaboration/services.py`、`views.py`、`urls.py`、`tests/test_multiboard.py`。

1. 测试：创建者第四个组织被拒，加入其它组织不计额度；组织创建可选首板类型、旧请求默认战争板、不同类型不可复用同一 UUID；统帅/指挥可在总数小于三时增板且同类型可重复，斥候不可增板；板名有上限且同组织不可重名。
2. 实现 `create_organization`、列表板投影、独立的幂等 `create_board`。现有组织管理命令与邀请码保持不变。
3. 跑目标测试，再跑全部 `TacticalCollaboration` 测试。

## 任务 3：战争板真正隔离及旧入口兼容

**文件：** `backend/TacticalCollaboration/services.py`、`graph.py`、`views.py`、`realtime.py`、`tests/test_multiboard.py`、`tests/test_realtime.py`。

1. 测试：两个同组织战争板的部署、上报、范围及地图互不串；跨板 id 不能更新/移动/关联；未指定 board_id 仍访问首块战争板；纯海盗组织不能用战争写入口；WS 握手指定板后仅接收该板快照。
2. 实现板解析与内容过滤，绑定新写入，板范围读写；在不破坏旧组织/测试的前提下扩充 HTTP/WS 参数。保留组织级租约和成员变更处理。
3. 跑目标测试、现有战术测试和静态星图测试。

## 任务 4：海盗目标目击和服务端隐私

**文件：** `backend/TacticalCollaboration/models.py`、`migrations/0008_*`、新 `pirate.py`、`views.py`、`urls.py`、`graph.py`、`tests/test_pirate_intel.py`。

1. 测试：角色名与精确船型的 Unicode 归一化；同目标多次目击的最新位置与历史；星系/星座二选一；UTC 时段可跨午夜；无效时间/位置被拒；撤下保留历史且需版本匹配；命令 UUID 幂等。
2. 测试：斥候 A 无法通过快照、列表、搜索、地图汇总、详情、撤下 ID 或错误响应得知斥候 B 的记录；指挥/统帅可见全板；被移除/禁用账号无访问；不同海盗板互不串；无板全局版本/事件泄漏。
3. 实现独立目击模型与查询投影、命令、星座目录及 HTTP 端点。查询先过滤可见作者再分组和统计。第一版不使用组织级 WS 推海盗记录。
4. 跑全部新测试和既有战术测试，检查迁移。

## 任务 5：创建/切换板的前端

**文件：** `front-codex/src/pages/TacticalCollaboration.jsx`、`src/services/apiTacticalCollaboration.js`、`src/hooks/useTacticalSession.js`、`src/utils/tacticalSocket.js`、`src/styles/tacticalCollaboration.css`、`tests/unit/tacticalOrganization.test.mjs`、`tests/unit/tacticalSocket.test.mjs`。

1. 前端测试先定义：两种板元数据与默认选择；创建请求携带类型，重试签名包含类型；板 URL 可深链，切换组织/板不会保留前板数据；战争 WS 鉴权与快照核对 board_id。
2. 创建表单加入 `Crosshair` / `Radar` 图标文字卡；组织内板切换器与添加板对话框；旧 URL 默认旧战争板。战争 API/会话传板 ID。
3. 跑 Node 单测与前端构建。

## 任务 6：海盗板页面、星图与移动端

**文件：** 新 `front-codex/src/components/tactical/PirateIntel*`、新 `src/utils/pirateIntel.js`、`src/pages/TacticalCollaboration.jsx`、`src/services/apiTacticalCollaboration.js`、`src/styles/tacticalCollaboration.css`、`tests/unit/pirateIntel.test.mjs`、`tests/tactical-e2e/*.spec.js`。

1. 先写目标聚合/地点精度/时间标签及地图投影的单测，看预期失败；后写纯工具函数。
2. 独立页面实现目标表单、搜索、可见历史、撤下、手动/低频自动刷新，复用成员管理；地图只投影服务端允许的数据，星座标记不落到某一星系。移动端先列表后地图。
3. 跑前端单测、构建、浏览器桌面和手机关键流程，检查对比度和拥挤度。

## 任务 7：回归与交付

1. `python manage.py test TacticalCollaboration --settings=EVE_MDjango.ci_settings --noinput`。
2. `python manage.py makemigrations --check --dry-run --settings=EVE_MDjango.ci_settings`。
3. `node --test tests/unit/*.test.mjs`（在 `front-codex`）。
4. `npm run build`（在 `front-codex`）。
5. Playwright 对创建两种板、三板上限、斥候隔离、真实星图定位及手机布局做本地验证。
6. 审查差异与安全边界。记录本地启动地址、未完成项；只在本地分支提交，不推送或部署。

## 实施时的收敛调整

- `0007_multiboard_pirate` 一次迁移包含板和目击表；没有另建计划中的 `0008`。
- 旧战争路径固定指向迁移生成的默认战争板，不在后来新建同类板时改指向；海盗首板组织无旧战争入口。
- 海盗快照服务端先按成员及斥候作者过滤，并计算可见目标数；客户端只在已授权的记录集合中分组、搜索、绘制标记。
- 地图星座标记、超过 48 小时的历史线索、移动端列表优先、失败退避和跨协作者板目录刷新均纳入第一版本地验收。
