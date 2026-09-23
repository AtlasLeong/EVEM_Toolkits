# 战术板体验收尾验收 · 2026-09-22

## 范围

仅 `codex/tactical-collaboration` 本地工作树。未推送、合并、部署、运行生产迁移或访问线上 MySQL。8001 使用独立 SQLite 演习设置，4194 为本地前端。

## 用户反馈对照

| 反馈 | 完成方式与证据 |
|---|---|
| 移动后长横幅多余 | 改成限宽短时提示，成功 2.8 秒自动收起；E2E 验证宽度与消失 |
| 左下控件堆叠 | 搜索、阵营、相邻星门、视图与缩放归入单一底部工具区；文字按钮不再被 32px 图标宽度压缩 |
| 右上太挤 | 操作、范围说明和侧栏分层留距；桌面、平板及折叠侧栏回归 |
| 星系无名 | 中文/原名/ID 兜底，按密度与缩放显示；选中、悬停必显，“全部名称”开关可取消省略 |
| 拖动没有反应 | 按松手坐标重新命中，保留真实一跳限制；空白和非邻接有提示，屏幕外目标不提交移动 |
| 边界星系无法移动 | 选中部署可查看当前星系的已加载与范围外真实星门，并提交同一种版本校验移动 |
| 上报要先确认才看见 | 目击情报立即以独立标记显示人数、作者和船型，正式部署总数不累加重复目击；采纳为部署仍是指挥的可选操作 |
| 所有敌方对斥候可见 | HTTP/WS 均返回所有组织敌方上报；斥候仍只能修改自己的报告，己方部署和内部来源/审计元数据不泄露 |
| 方框过长和密集重叠 | 人数框按内容自适应；报告限制宽度，最多两条加“全部”入口，长文截断并保留完整标题/侧栏 |
| 星座总览挤成一排 | 总览作为自适应星座入口网格，无虚构连线；局部地图继续使用真实星系坐标与星门 |
| 滚轮同时翻页 | 地图区域滚轮不滚动外层页面，E2E 验证 |
| 影响星系导航 | 本轮没有改共享导航绘图或寻路代码；公开本地星图为 67 星域 / 786 星座 / 5428 星系 / 13744 星门，无旧演习星域；导航回归 8 项通过 |

## 自动化与联调

- `node --test tests/unit/*.test.mjs`：99/99。
- `npx playwright test --config=tests/tactical-e2e/playwright.config.js`：39/39，会话取消检查后的最终完整回归也通过（1.9 分钟）。
- `npx playwright test tests/e2e/specs/starmap-performance.spec.js`：8/8。
- `npm run build`：通过。保留已有主包 502.87 kB 提醒，未通过提高阈值隐藏。
- `../.venv/Scripts/python.exe manage.py test TacticalBoard TacticalCollaboration tests_tactical_transport tests_tactical_local tests_tactical_universe --settings=EVE_MDjango.ci_settings --noinput`：99/99。
- `.venv/Scripts/python.exe -m unittest discover -s scripts/tactical/tests -v`：13/13。
- 更新后的 `smoke_board.py` 对本地 8001 执行通过，创建独立测试组织 9；两个斥候和指挥共享目击，跨作者修改 403、旧版本 409、移动、归档、降级和踢出均通过。
- `git diff --check`：通过；仅 Windows 换行提示。

本轮多个新断言先在旧实现失败，再通过修复：工具遮挡、报告折叠、名称开关、屏幕外命中、25 星座卡片边界、斥候报告投影及会话取消竞态。

## 实屏

在真实星系组织 7 的坦欧提交了一条明确标注“本地验收：直接上图测试，不代表真实战况”的测试情报。68 人、巡洋舰 24、战列舰 12，提交后无需采纳即可出现作者“北境统帅”；正式敌方部署仍为 5 支。没有重置已有部队或组织。

- `front-codex/output/playwright/tactical-direct-report-final.png`：真实坐标局部图及直接上报标记。
- `front-codex/output/playwright/tactical-overview-final.png`：25 个真实星座入口，无重叠。
- `front-codex/output/playwright/starmap-real-regression.png`：原星系导航。

最新刷新后浏览器控制台 Errors 0 / Warnings 0。开发模式首次加载的旧会话 403 经独立审查定位为准入等待期间清理竞态，已加取消检查；真正有效会话的 403 仍正常撤销权限。

## 上线前边界

本地功能回归不等同于生产 100 人容量证明。隔离 MySQL 并发、ASGI/代理长连接、备份迁移与生产准入检查仍需发布阶段单独执行。真实星系源数据的既有缺口沿用之前的静态数据校验记录，不人为补造坐标、名称或星门。
