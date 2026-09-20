# 军团主要活动与编辑器精修：本地验收

日期：2026-09-20。分支：`codex/community-corp`。

## 完成范围

- 军团编辑页输入行统一 44px，下拉框与同排输入对齐。多行文本分别使用 110/140/180px，标签间距 8px，字段间距桌面 20px、手机 16px；未改全局输入样式。
- 单次活动编辑改为长期“主要活动”介绍，公开详情、审核和第三海报模板同步。支持最多 1500 个 Unicode 码点，不因 emoji 的 UTF-16 长度提前截断。
- 新可选方向为“主权生产”“海盗作战”及原有五个方向；旧“舰队作战”标签允许保留或移除，不推断映射。
- 自定义标签最多 5 个，每个最多 12 个 Unicode 码点，支持添加、删除、数量反馈、IME 输入和保存未点击添加的待输入标签；前后端统一重复及保留名称校验。
- 新字段使用现有版本 JSON，无数据库迁移。旧事件原文保留，旧已发布快照不变；明确清空新介绍不会回退显示旧事件。
- 原有 8 款海报背景、4 款默认横图、草稿水印、审核与发布隔离保留。

## 验证结果

以下命令均于本次实现后运行并退出 0。

| 验证 | 命令（在对应目录执行） | 结果 |
| --- | --- | --- |
| Django 扩展回归 | `python manage.py test Community Feedback License ActivationCode TacticalBoard EVE_MDjango.tests_deployment --settings=EVE_MDjango.ci_settings --noinput` | 156/156 通过 |
| 迁移漂移 | `python manage.py makemigrations Community --check --dry-run --settings=EVE_MDjango.ci_settings` | 无变更 |
| 前端单元与预览合同 | `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs` | 49/49 通过 |
| 军团页面浏览器回归 | `npx playwright test corporation --workers=1 --output=output/playwright/corp-activities-verified`（`VITE_API_URL=/api`） | 45/45 通过 |
| 实际本地预览流程 | `npx playwright test --config tests/preview-e2e/playwright.config.js --output=output/playwright/corp-activities-sandbox-verified` | 4/4 通过 |
| 生产构建 | `npm run build` | 通过；仍有约 501kB 主包体积提示 |
| 补丁检查 | `git diff --check` | 通过 |

实际预览流程覆盖演示身份登录、军团申请与审批、编辑保存与刷新、图片上传、提交/撤回、审核发布、新版本创建。浏览器回归还覆盖移动端、海报导出、筛选、分享、只读状态与焦点恢复。后端测试使用内存 SQLite，不加载线上配置。

独立需求审查与代码质量审查均完成。审查中修复了旧活动原文在保存时被重写、前后端保留标签不一致、原生 maxlength 对 emoji 计数错误等问题并补充回归。输入框高度、下拉框对齐与新内容合同均经历失败测试后修复通过。

截图人工检查：桌面主要活动、招募表单、海报弹窗；手机活动标签和主要活动。手动预览控制台未发现警告或错误。

## 本地试用

- 新入口：`http://127.0.0.1:4192/corporations/manage?id=1`。
- 顶部选择“演示军团管理员”，再进入“远航者军团”。角色切换与数据均在本地演示服务中，不是真实账号登录。
- 原 4190 预览服务未重启，避免丢失用户之前的内存测试数据。4192 刷新页面保留测试数据，重启服务会重置。
- 截图位于 `front-codex/output/playwright/`：`corp-activities-desktop.png`、`corp-recruitment-spacing-desktop.png`、`corp-main-activity-poster-desktop.png`、`corp-activity-tags-mobile.png`、`corp-activity-overview-mobile.png`。

## 发布边界

仅本地实现、测试和提交；未合并、推送、部署，未连接或修改线上 MySQL。截图、构建输出与浏览器临时文件不纳入本次提交。尚未进行线上环境验收；不据此承诺所有浏览器或所有业务场景无回归。
