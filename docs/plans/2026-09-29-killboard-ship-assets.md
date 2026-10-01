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
- 运行测试文件对应的显式模块标签（当前目录自动发现会得到 0 个用例）：`$killboardTests = Get-ChildItem Killboard/tests -Filter 'test_*.py' | ForEach-Object { 'Killboard.tests.' + $_.BaseName }; python manage.py test @killboardTests --settings=EVE_MDjango.killboard_test_settings`。

### Task 2: 客户端图片核验

- 独立只读定位客户端资源、类型表/图标表、图片格式。
- 仅在 `output/client-ship-assets/` 留取本地检索证据；如能确证具体型号，再导出必要的舰船缩略图及来源清单，不拷贝整包或私有数据。
- 检查实际图片与游戏截图对应情况；若不能可靠获取，保留占位并记录障碍。

### Task 3: 前端补充与回归

- `front-codex/src/utils/killboardPresentation.js`：增加船名回退与仅已核验图片的映射。
- `front-codex/src/pages/Killboard.jsx` / `src/styles/killboard.css`：参与者显示具体船型，固定图片尺寸，不引入逐条查询、不扩大列表数量。
- 在 `front-codex/tests/unit/killboardPresentation.test.mjs` 补充空船型、图标缺失及已知类型测试，先失败再实现。
- 运行所有前端单测、`npm run build`、`git diff --check`，在19748417与19748418上验证船名、图片/占位及窄屏。

## 本轮结果（2026-09-29）

- 已接入客户端目录中 343 个精确舰船型号映射，保留原始 ID。目录进程内缓存，无逐角色数据库或网络查询。
- 前端新增参与舰船名称行，继续仅展示前 7 个具名参与者；未匹配名称明确标为待补，未生成或猜测图片地址。
- 客户端只读检索已定位 NeoX/WPK 资源目录。经隔离解码验证，两个较小资源包的 187 条有效 WPK 记录可走通 `AC → DTSZ → Zstandard`；额外从五个大包各取小样本后，11 条可验证为 KTX/ASTC 并转为 PNG。尚未得到可验证的船型 ID 到图片路径映射。没有完成舰船图片接入，也不能据此认定客户端没有图片或资源不可恢复。
- 本地检索证据在 `output/client-ship-assets/README.md`。两个资源包副本仅供本地格式分析，不得提交仓库或发布到网站。
- 后端显式测试模块运行 55/55；前端全量单测 372/372；生产构建及 bundle 检查通过。`git diff --check` 通过（存在工作区原有换行符提示）。独立代码审查无阻塞问题。
- 浏览器验证：1440×900 桌面页面保持一屏，无页面溢出，19748417 恰好展示 7 条参与者船型；390×844 窄屏无横向溢出，19748418 显示马齐奥级。移动端维持原有纵向布局。
- 仅本地实现与预览，未推送或部署。

## 本轮结果（2026-09-30，精确图片库接入）

- 2026-09-30 已升级为站点公共目录：`backend/GameData/` 与 `front-codex/public/images/game-items/`。44,833 条配置记录，其中 32,675 条有图片，2,702 张 PNG 以内容 SHA-256 去重。
- `Killboard/image_catalog.py` 是公共目录兼容入口，市场与战报使用相同图片查询和前端组件。旧生成目录可恢复备份位于 `output/client-ship-assets/legacy-killboard-public/`，不再重复打进前端发布包。来源及增量更新步骤见 `docs/game-data.md`。
- 参与舰船行补充固定尺寸缩略图，图片加载使用懒加载和异步解码；特殊植入体/大图资源保留 `image_role` / `image_warning`，不混称为标准图标。
- 资产同步可用 `scripts/sync_killboard_image_library.py` 重建；该脚本只复制已核验资源，不把研究快照中的原始客户端路径暴露给浏览器。
- 后端显式测试 59/59、前端 KM/市场相关单测 22/22，生产构建与 bundle 检查通过；本轮仍未推送或部署。
