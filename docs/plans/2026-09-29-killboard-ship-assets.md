# Killboard participant ships Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补齐参与击杀舰船名称映射，并从已安装客户端查找、核验舰船图片后用于本地预览。

**Architecture:** 保留原始 ship_type_id，不修改历史采集记录。详情序列化时使用已有客户端导出的只读市场目录进行名称映射，进程内缓存，避免逐角色数据库/网络查询。图片只能采用可追溯到准确型号的客户端资源；未确认的图片不填充。前端角色项保留名称、军团、伤害与前7条限制，补充紧凑舰船图和船名。

**Tech Stack:** Django/DRF、Python unittest、React、Vite、Node test runner、Playwright。

## 设计与范围

沿用用户确认的角色行补充方案，而非另做页面。优先复用已有客户端中文目录；不采用臆测ID、端游同名船图或第三方站点盗链。客户端只读，素材检索不读取账号/session，不改客户端配置。查找不等于已获得可用素材；打包或缺失情况如实记录。此次仅本地实现与验证，不推送部署。

### Task 1: 舰船名映射

- 新建 `backend/Killboard/catalog.py`，缓存按 category_id=1000 过滤的目录。
- 修改 `backend/Killboard/serializers.py` 为参与者增加 `ship_name`（未匹配为空），详情目标名保持已有采集名称优先。
- 先在 `backend/Killboard/tests/test_api.py` / `test_catalog.py` 增加已知型号、未知/空ID、非舰船、查询数量测试并看到失败；然后实现。
- 运行 `python manage.py test Killboard --settings=EVE_MDjango.killboard_test_settings`。

### Task 2: 客户端图片核验

- 独立只读定位客户端资源、类型表/图标表、图片格式。
- 仅在 `output/client-ship-assets/` 留取本地检索证据；如能确证具体型号，再导出必要的舰船缩略图及来源清单，不拷贝整包或私有数据。
- 检查实际图片与游戏截图对应情况；若不能可靠获取，保留占位并记录障碍。

### Task 3: 前端补充与回归

- `front-codex/src/utils/killboardPresentation.js`：增加船名回退与仅已核验图片的映射。
- `front-codex/src/pages/Killboard.jsx` / `src/styles/killboard.css`：参与者显示具体船型，固定图片尺寸，不引入逐条查询、不扩大列表数量。
- 在 `front-codex/tests/unit/killboardPresentation.test.mjs` 补充空船型、图标缺失及已知类型测试，先失败再实现。
- 运行所有前端单测、`npm run build`、`git diff --check`，在19748417与19748418上验证船名、图片/占位及窄屏。
