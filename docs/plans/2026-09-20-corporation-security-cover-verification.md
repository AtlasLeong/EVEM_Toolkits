# 分级安等与默认封面：本地验收记录

日期：2026-09-20。分支 `codex/community-corp`；本轮基线 `2b8d2e1`，设计提交 `f882d21`。

## 实现

- 驻地 JSON 分别保存星域、星座、星系安等；后端从目录生成，不信任客户端传值。保持原末级 `security` 兼容，无数据库模型迁移。
- 下拉选项及选中值、编辑摘要、列表星域、公开详情、审核驻地显示对应层级两位小数安等。旧快照仅末级回退，不给未知祖先补 0；显式 null 不回退。前端拒绝布尔、数组、对象、十六进制等非十进制目录值。
- 编辑页未上传封面时使用公开页相同 ID 对应的默认横图，显示“当前使用默认封面，上传图片后可替换”。上传成功后隐藏提示，移除后恢复。徽标、公开页和海报没有增加默认图提示。左右上传按钮保持对齐。
- 不重启已有 4190/4192 服务；新预览使用 `http://127.0.0.1:4193/corporations/manage?id=1`。顶部选择“演示军团管理员”，进入“远航者军团”。演示数据仅存本地内存，刷新保留、服务重启重置。

## TDD 与审查

先添加失败测试，再实施：选中态安等缺失、公开页只显示末级、加载失败丢安等、编辑封面占位无提示、卡片漏星域安等均已观察失败再通过。审查补充非法类型用例（失败时出现 0/1/16 的假安等），修复后通过；截图发现提示占位造成 28.6875px 按钮错位，几何断言先失败再通过。

独立规格审查已通过，包括 18 个非法值与 7 个合法值的解析检查。独立代码质量审查通过，无待修问题；审查者独立运行后端驻地 22 项、Node 50 项测试和补丁检查，均通过。

## 已完成验证

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 后端扩展回归（backend） | `python manage.py test Community Feedback License ActivationCode TacticalBoard EVE_MDjango.tests_deployment --settings=EVE_MDjango.ci_settings --noinput` | 164/164 通过 |
| Community 迁移漂移（backend） | `python manage.py makemigrations Community --check --dry-run --settings=EVE_MDjango.ci_settings` | 无变更 |
| Node 单元和本地服务合同（front-codex） | `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs` | 50/50 通过 |
| 新增页面用例（front-codex） | `npx playwright test corporation-security-cover --workers=1 --output=output/playwright/security-review-green` | 6/6 通过 |
| 真实本地预览流程（front-codex） | `npx playwright test --config tests/preview-e2e/playwright.config.js --output=output/playwright/security-cover-sandbox` | 4/4 通过 |
| 构建（front-codex） | `npm run build` | 通过，仍有既有约 501kB 主包大小提示 |

完整 51 项页面回归在 `VITE_API_URL=/api` 下运行 `npx playwright test corporation --workers=1 --output=output/playwright/security-cover-final`：50 项通过，原海报重试测试再次受本地背景加载延迟影响。该测试隔离静态资源后重复 5/5 通过；随后 `npx playwright test corporations.spec.js --workers=1 --output=output/playwright/security-cover-final-corporations` 全文件 24/24 通过（39.7 秒）。其余 27 项规格用例已在上一批通过，生产代码未再变化：最终覆盖 51 项页面用例，采用分批验证，不宣称存在一次整批 51/51 的最终运行。

真实预览测试通过 UI 完成身份选择、申请、审核、关联三级驻地、保存刷新、上传封面、提交撤回、审核发布、新版草稿；无 API 路由 mock、无预注入登录；同时断言编辑、审核、公开页三级安等一致。

## 异常调查与已知边界

首次全量回归 49/50 通过，旧海报重试测试在 5 秒断言时仍等待背景图。独立 trace 检查确认：重试媒体请求 200 且约 3.8ms 完成，背景 `spiral-galaxy.webp` 在断言超时仍 pending；同次静态资源亦有 2–8 秒延迟。单项原测试连续重跑 5/5 通过，但全批复测仍出现同一等待。

因此仅为这条受保护媒体重试测试添加 test-scoped 路由，直接提供同一张仓库 WebP 文件，同时新增断言要求确实发出了成功重试请求。仍使用实际图片解码、绘制和导出就绪断言；真实八背景/三模板网络与导出用例保持原样。未改海报生产代码、未放宽测试超时。隔离后该用例重复 5/5 通过，所属文件完整 24/24 通过；独立质量审查再次确认该测试改动合理，无待修项。

未限定 app 的迁移检查发现已有 TacticalBoard 初始迁移漂移（四个星图模型），未纳入本轮修复，未生成迁移；Community 检查通过。本轮后端验证使用内存 SQLite，不加载线上配置。

截图已人工检查：`front-codex/output/playwright/corp-security-desktop.png`、`corp-security-mobile.png`、`corp-default-cover-editor.png`。手动浏览控制台无错误/警告，桌面/手机布局无横向溢出。

所有操作仅本地；不合并、不推送、不部署、不连接线上 MySQL。旧发布快照不自动回填祖先安等，重新保存并通过审核后获得完整新快照。
