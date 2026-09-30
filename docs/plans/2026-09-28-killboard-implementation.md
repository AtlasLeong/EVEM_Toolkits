# 击毁情报板 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 EVEM Toolkit 中加入可测试的击毁报告采集、连续 ID 探测、战舰分类策略和击毁情报板页面。

**Architecture:** 新建独立 Django `Killboard` app，解析、探测、策略和 API 分层，避免耦合现有 Market worker。前端新增懒加载的 `/killboard` 页面与独立 API service，列表和详情只消费已清洗字段；采集凭据只由服务器配置注入。

**Tech Stack:** Django 4.2、Django REST Framework、现有 JWT、MySQL、React、React Router、Vitest/Testing Library（按仓库现有脚本）。

---

### Task 1: 建立领域模型与迁移

**Files:**
- Create: `backend/Killboard/__init__.py`
- Create: `backend/Killboard/apps.py`
- Create: `backend/Killboard/models.py`
- Create: `backend/Killboard/admin.py`
- Create: `backend/Killboard/migrations/0001_initial.py`
- Modify: `backend/EVE_MDjango/settings.py`
- Modify: `backend/EVE_MDjango/urls.py`
- Test: `backend/Killboard/tests/test_models.py`

**Step 1: Write the failing test**

编写模型测试，断言 `KillReport.kill_id` 唯一、`KillItem.status` 只接受四种值，且 `KillParticipant`/`KillItem` 可关联报告。

**Step 2: Run test to verify it fails**

Run: `python backend/manage.py test Killboard.tests.test_models --settings=EVE_MDjango.test_settings -v 2`

Expected: FAIL because the app and models do not exist.

**Step 3: Write minimal implementation**

实现设计文档中的六个模型、索引和选择约束，将 `Killboard` 加入 `INSTALLED_APPS` 并挂载 `/api/killboard/` URL 前缀。迁移只新增表，不修改其它 app。

**Step 4: Run test to verify it passes**

Run the same command; expected PASS.

**Step 5: Commit**

```bash
git add backend/Killboard backend/EVE_MDjango/settings.py backend/EVE_MDjango/urls.py
git commit -m "feat: add killboard domain models"
```

### Task 2: 实现严格响应解码与击毁详情解析器

**Files:**
- Create: `backend/Killboard/parser.py`
- Create: `backend/Killboard/protocol.py`
- Test: `backend/Killboard/tests/test_parser.py`

**Step 1: Write the failing test**

用最小合成响应覆盖：空响应、已知 `get_kill_info` 包装、参与者字段、装备 `d/x/c`、缺失装备块、重复属性、超长 blob、无时区时间和非法数字。

**Step 2: Run test to verify it fails**

Run: `python backend/manage.py test Killboard.tests.test_parser --settings=EVE_MDjango.test_settings -v 2`

Expected: FAIL because parser functions do not exist.

**Step 3: Write minimal implementation**

实现有上限的协议解包和 XML-like 解析器：限制响应/节点/属性/深度，拒绝重复属性与危险控制字符；将 `d` 进入 `quantity_dropped`、`x` 进入 `quantity_destroyed`、`c` 进入 `quantity_unknown`，缺少装备块返回明确的 `equipment_status`。

**Step 4: Run test to verify it passes**

Run the same command; expected PASS，且测试输出不包含原始令牌或账号信息。

**Step 5: Commit**

```bash
git add backend/Killboard/parser.py backend/Killboard/protocol.py backend/Killboard/tests/test_parser.py
git commit -m "feat: parse bounded kill reports"
```

### Task 3: 实现连续 ID 探测器与入库服务

**Files:**
- Create: `backend/Killboard/discovery.py`
- Create: `backend/Killboard/services.py`
- Create: `backend/Killboard/management/commands/killboard_probe.py`
- Test: `backend/Killboard/tests/test_discovery.py`
- Test: `backend/Killboard/tests/test_services.py`

**Step 1: Write the failing test**

用可控的 fake client 测试：连续报告推进游标；连续空响应达到阈值后停止；跳跃后邻居回探；鉴权/限流/网络/格式错误立即停止；时间逆序不推进；超过 `max_requests` 不再调用客户端；低完整度记录不能覆盖高完整度记录。

**Step 2: Run test to verify it fails**

Run: `python backend/manage.py test Killboard.tests.test_discovery Killboard.tests.test_services --settings=EVE_MDjango.test_settings -v 2`

Expected: FAIL because discovery/service functions do not exist.

**Step 3: Write minimal implementation**

实现 `ProbeClient` 接口、状态分类、步长与邻居回探、连续空洞阈值和单轮请求上限；入库服务用事务写入报告/参与者/装备，按 `CollectionPolicy` 过滤，并用 completeness 规则合并更新。管理命令默认 dry-run，需要显式配置才写库。

**Step 4: Run test to verify it passes**

Run the same command; expected PASS。

**Step 5: Commit**

```bash
git add backend/Killboard/discovery.py backend/Killboard/services.py backend/Killboard/management backend/Killboard/tests/test_discovery.py backend/Killboard/tests/test_services.py
git commit -m "feat: add bounded killboard discovery"
```

### Task 4: 提供只读 REST API 与权限边界

**Files:**
- Create: `backend/Killboard/serializers.py`
- Create: `backend/Killboard/views.py`
- Create: `backend/Killboard/urls.py`
- Test: `backend/Killboard/tests/test_api.py`

**Step 1: Write the failing test**

断言列表分页/筛选、详情嵌套参与者与装备、过滤器、状态摘要、非法筛选参数、未授权管理探测接口拒绝；断言响应不包含原始响应、账号、会话或 token 字段。

**Step 2: Run test to verify it fails**

Run: `python backend/manage.py test Killboard.tests.test_api --settings=EVE_MDjango.test_settings -v 2`

Expected: FAIL because API views/serializers do not exist.

**Step 3: Write minimal implementation**

实现公开 GET API，统一分页上限和输入长度；详情明确返回 `participant_count_source`、`equipment_status`、`time_quality`；采集控制接口使用独立 staff/permission 检查并只返回安全状态码。

**Step 4: Run test to verify it passes**

Run the same command; expected PASS。

**Step 5: Commit**

```bash
git add backend/Killboard/serializers.py backend/Killboard/views.py backend/Killboard/urls.py backend/Killboard/tests/test_api.py
git commit -m "feat: expose read-only killboard API"
```

### Task 5: 建立前端 API 与情报板页面

**Files:**
- Create: `front-codex/src/services/apiKillboard.js`
- Create: `front-codex/src/pages/Killboard.jsx`
- Create: `front-codex/src/styles/killboard.css`
- Modify: `front-codex/src/App.jsx`
- Modify: `front-codex/src/components/layout/AppShell.jsx`
- Test: `front-codex/src/pages/Killboard.test.jsx`

**Step 1: Write the failing test**

覆盖列表加载、舰船类别筛选、点击行打开快速预览、装备 `d/x/c` 三种徽标、缺失装备提示、采集状态和错误态；断言切换筛选不触发整页动画/闪烁。

**Step 2: Run test to verify it fails**

Run: `npm --prefix front-codex test -- --run src/pages/Killboard.test.jsx`

Expected: FAIL because the page/service/route do not exist.

**Step 3: Write minimal implementation**

新增懒加载路由 `/killboard`，沿用现有 AppShell 的深色科幻风格和小外边距；主区采用“列表 + 右侧预览”，筛选条件来自 `/filters/`，页面内部状态切换只更新列表/预览区域，不重挂载整个页面。

**Step 4: Run test to verify it passes**

Run the same command; expected PASS。

**Step 5: Commit**

```bash
git add front-codex/src/services/apiKillboard.js front-codex/src/pages/Killboard.jsx front-codex/src/styles/killboard.css front-codex/src/App.jsx front-codex/src/components/layout/AppShell.jsx front-codex/src/pages/Killboard.test.jsx
git commit -m "feat: add killboard intelligence page"
```

### Task 6: 集成验证与发布前检查

**Files:**
- Modify: `docs/plans/2026-09-28-killboard-verification.md`

**Step 1: Run focused tests**

Run backend Killboard tests and frontend page tests; expected all PASS。

**Step 2: Run full checks**

Run: `python backend/manage.py test --settings=EVE_MDjango.test_settings`; `npm --prefix front-codex run build`; `git diff --check`。

**Step 3: Validate behavior**

用合成数据验证列表/详情与权限；使用 dry-run 探测命令验证游标和停止原因；确认日志不打印凭据和原始 blob。

**Step 4: Document evidence**

记录命令、结果、迁移状态和已知限制到验证文档；只有所有检查通过后才进入后续部署/合并流程。

**Step 5: Commit**

```bash
git add docs/plans/2026-09-28-killboard-verification.md
git commit -m "test: verify killboard integration"
```

