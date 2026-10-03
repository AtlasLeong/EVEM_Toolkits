# 前端工作台升级与发布验证

## 范围与当前状态

PR #30 将现有 EVE 工具站统一为“新伊甸工作台”。升级覆盖登录、全站导航、市场、KM、制造、行星计算、战术以及账户、采集、社区、管理等真实路由，保留现有功能、权限、数据策略和游戏采集预算。路由清单为 35 个显式路径及首页 index；部分路径包含别名、通配或仅开发使用的入口。

工作在独立 checkout 和 `codex/frontend-command-deck-20261003` 分支进行，原 checkout 未修改。基线 master 为 `dbd40c326ec9c4908f25ff5980a796f8b3926ad8`，保留 PR #29 的后端修改。本 PR 不改 backend、部署脚本、workflow 或安全权限配置。

当前 PR 尚为 draft，未合并或发布。最终提交的完整 CI、发行产物和部署版本以 [PR #30](https://github.com/AtlasLeong/EVEM_Toolkits/pull/30) 的最新记录为准；早期检查通过不能代替最终 head 的验收。

## 用户可见变化

- 登录入口解释真实查看权限，云端私有站点不再显示误导的访客入口；校验返回目的地，并保留登录后的原路由。
- 分组导航、跳过导航链接、移动菜单、键盘焦点及可保存的紧凑/舒适密度统一使用公共 token。
- 市场切换商品、分类或历史查询时不显示另一个查询的旧曲线；同一查询的有效缓存可在刷新失败时保留，同时显示错误、读取/采集时间和缓存状态。失败、空盘、未采集与旧数据深度状态分别说明。
- 市场与 KM 的加载结构保留最终布局所需空间；手机优先显示所选工具，再通过实际 disclosure 访问完整目录。数值、单位、表格滚动和图表键盘操作仍可用。
- KM 明细读取失败时保留列表摘要，并明确明细尚未读取；制造的成本摘要提前出现在移动端，报价失败提示紧邻刷新操作。
- 行星计算器保留公式、字段和完整结果表，支持 Tab、Escape、关闭后焦点恢复及内部表格滚动；长中文和放大文字保持可读。
- 设置区分加载、空值、失败、保留编辑和恢复；管理表格在窄屏保持字段身份。战术和其余页面继承同一配色、字体层级、间距、状态和焦点规则。
- 动效用于反馈与结构转换，提供 reduced-motion 处理，不增加外部字体请求或采集调用。

## 回归与已修复问题

首阶段 [CI 37150092777](https://github.com/AtlasLeong/EVEM_Toolkits/actions/runs/37150092777) 已通过，包括主浏览器 436 项、独立 preview 4 项、tactical 170 项、617 项 Node 检查（587 单元测试与 30 preview contract）以及既有后端、认证、迁移、发布安全和 MySQL 检查。

第二阶段本地完整主浏览器回归为 **466/466 passed，6.1m，正常退出**，617 项 Node 检查（587 单元测试与 30 preview contract）及 production build/原包大小预算通过。独立代码审查与实际桌面、手机、加载、错误及文字压力截图审核完成。

[CI 37152592131](https://github.com/AtlasLeong/EVEM_Toolkits/actions/runs/37152592131) 在 tree `48ca04e446a693a67787a7f951b6fa255ce0255f` 上得到 **463 passed / 3 failed**。三项都是 320px 登录、注册和找回密码双倍文字的页面宽度 332px；617 项 Node 检查、构建、包预算、后端检查和 MySQL 通过，preview、tactical 和发行打包被跳过。

失败 artifact `11284991846` 的摘要已核验，全部九次失败 trace 保留。实际 Linux Chromium 截图显示顶部英文品牌副标识越过右边缘。使用同一文字压力 helper，仅改本地回退字体为 Arial，可精确复现 332px。修复只在 `.login-intro-edition` 增加 `min-width: 0` 和 `overflow-wrap: anywhere`，使 flex 子项与较宽英文单词完整换行；不改字号、helper、断言、timeout 或页面 overflow。

该修复的原 43 项认证/导航回归与 8 项文字压力回归 **51/51 passed，正常退出**。独立浏览器核验三种模式 × 原字体/Arial 六种状态均为 320px，文字和按钮完整可见。Windows 截图是补证；后续 Linux CI 的 8 项认证文字压力用例已全部通过。最终候选仍需完整 CI 验收。

原生产 artifact 的军团编辑导航失败也已依据 trace 定位：React transition 更新 URL 后尚未提交目标页面，立即 Back 会取消中间转换。测试保留全部断言与 timeout，仅等待目标 heading 和旧编辑区域消失后操作历史导航；相关 trace 9/9 通过，没有产品逻辑或后端改动。

[CI 37155309249](https://github.com/AtlasLeong/EVEM_Toolkits/actions/runs/37155309249) 在 tree `d32acc013d4c6d842b408419d1bf1b0bfb3e0bf3` 上记录 **462 passed / 2 persistent failures / 2 flaky（重试通过）**。认证字号 8 项全部通过；617 项 Node 检查、构建、预算、后端与 MySQL 通过。主浏览器门槛失败后，独立 preview 浏览器、tactical 和打包被跳过，没有发行 artifact。

军团审核的两条持久失败共六次尝试均实际出现成功通知和被动空摘要同时匹配 `status`。共享空态恢复普通摘要语义，保留加载与操作通知的播报；原失败用例按 CI workers/retries 配置重复 **10/10**，没有使用重试。多个独立操作的状态通知仍然保留。全站检查覆盖 25 个共享空态调用和 106 个 status/alert 测试定位，未发现其他新增同型冲突。

移动导航的 trace 与受控真实浏览器复现证明：CSS 隐藏控件可能先清除焦点，媒体通知随后才触发。修复记录该隐藏控件的焦点来源，使断点关闭时移到可见主内容；主动移除焦点或移到其他控件保持原行为。新增四条针对两种事件次序和外部/主动焦点的回归，原断言及 timeout 保留。重复焦点场景 **15/15**、认证/导航/字号目标 **55/55** 通过，没有使用重试。

设置价格反馈使用与当前消息绑定的明确结果类别。保存失败后“恢复默认”现在以成功状态播报，后续保存错误仍以警报播报；没有重置 mutation、改变请求或放开保存中按钮。新增回归先在旧源真实失败，修后两项设置用例各重复五次 **10/10** 通过，没有使用重试。

许可证表格键盘横滚首次 `scrollLeft=0`、重试通过，根因尚未闭合。原测试按 CI workers/retries 配置重复 **5/5**；用户电脑浏览器的立即切宽与等待滚动对照均通过，不能据此认定增加等待是修复。本轮保留其源码、动作、断言和 timeout。

旧本地与 Linux CI 的 85 个测试文件、466 个首轮定位多重集完全一致，测试与配置 Git 对象相同。本地使用 2 workers 且实际无重试；CI 使用 1 worker、允许两次重试。两者默认 Playwright 1.58.2 / Chromium 145.0.7632.6 revision 1208；Chrome 153 只用于用户电脑的视觉核验。CI 实际 Node 22.23.3，本机当前 Node 24.13.1，旧完整日志未记录 Node 版本。环境差异不能单独证明失败原因。

## 构建与性能边界

本轮语义与焦点修复冻结后，617 项 Node 检查全部通过，production build 与原包预算通过。新构建 `index.html` SHA256 为 `ae8b7e21108de301105cc9fd2a593b93c14473f4b9732df026d801d19d7be983`；完整 471 项主浏览器及新 Linux CI 的结果以 PR 最新记录为准。

认证换行修复版本（9bb5e566…）构建的 `index.html` SHA256 为 `20dd9c266fa170a60fe02a661ac40fd1f76a1735d06eb35244d2545178288541`。主 CSS 为 120,124 bytes，原阈值 122,880 bytes；包大小门槛未放宽。

该版本同一冻结构建执行 12 次市场/KM 导航及匿名 `/market → /login` 检查，页面错误和 document 横向溢出均为 0。

| 页面 | viewport | LCP 中位数 | CLS 中位数 |
| --- | --- | --- | --- |
| 市场 | 1440×960 | 208ms | 0.009054 |
| 市场 | 390×844 | 180ms | 0.007458 |
| KM | 1440×960 | 232ms | 0.008390 |
| KM | 390×844 | 168ms | 0.000005 |

以上是本地即时合成接口、无网络节流的实验室观测，不能代表线上 field p75、INP 或真实授权查询。双倍文字是 computed text-only 压力模拟，不等同原生浏览器缩放。原始较早构建的观测另行保留，不冒称同一最终 artifact。

## 截图证据

[公共证据索引](frontend-workbench-evidence.json) 包含 117 份截图的文件名、阶段、环境与可用摘要，以 E001–E117 编号关联。实际 Windows 用户电脑截图、Linux CI 失败 before、本地 production build 与支持的合成 fixture 均注明来源；未结束动画和截取伪影不作为通过证据。

Library 原生附件标识和下载验证回执单独私下交付。公开仓库不含这些私有标识或授权传输地址。新一轮六张修复后截图与三张真实 CI 失败 before 均已独立查看；两个指定附件的下载字节、尺寸和 SHA256 与截图映射匹配。

## 生产预检与组件版本

2026-10-03 21:09 UTC，只读匿名 smoke 的 12 个请求通过：两个版本接口、首页、登录、六个引用 assets、精确 401/Bearer 访问边界和 community readiness；TLS 验证正常。既有战术 WebSocket 握手探针也通过并立即关闭，没有应用消息、凭据或采集操作。

当前实际前端组件为 `5cda8bef3b05dfb6361c51fb6abde2c07ad7492c`，后端组件为 `dbd40c326ec9c4908f25ff5980a796f8b3926ad8`。PR #29 只改后端，组件 SHA 不同符合既有发布策略。后端 tree 为 `626a19f323b409174a7d8fb5a4332d1900cd21d8`，本候选未改变它。

前端发布后应校验实际 merge/publish artifact 的前端 SHA；后端保持既有 `dbd40c…`，无需为同步 SHA 而重启。最终以服务器实际组件状态与发行 manifest 为准。

## 串行发布与回滚

遵循 [部署说明](../scripts/deploy/README.md)、[DEPLOY_PRODUCTION.md](../DEPLOY_PRODUCTION.md) 与 [访问边界说明](deployment-viewer-access.md)，保留既有锁、摘要/路径校验、迁移检查、健康探针、非 root publisher 和回滚。

1. 发布前重新确认 master、PR 的最终 head、完整 CI 和独立审查；核对没有其他正在进行的 Production 发布。由父线程统筹串行合并，使用预期 head 校验，不绕分支保护。
2. 通过既有 master Production 流程完成重新验证、artifact 打包和发布，不手工复制 dist、不跳过失败门槛、不改变 concurrency 或服务权限。
3. publisher 有 15 分钟 timeout；若发生失败或超时，先读实际状态与 journal，再按现有受控流程恢复。不得并发重发、覆盖成功状态或使用 root 导致 metadata 所有权改变。
4. 发布后分别核对 `/deploy-version.json`、`/api/deploy-version/`、新页面引用 assets、匿名权限边界、readiness 和实际浏览器桌面/手机 Login。私有站点应显示查看权限说明且没有误导访客链接。
5. 使用合法真实会话执行只读关键任务；没有合法会话时保留验收缺口，不向生产注入 fixture token，不触发采集、业务写入或账户权限变更。
6. 版本或健康检查失败时使用既有 Production rollback 流程恢复上一版本，不回滚数据库、不执行 migrate/fake、不可逆清理或安全关键 chown/chmod。回滚异常时保留 journal 并停止切换。

授权截止为 2026-10-04 02:32:24 UTC。截止前预留部署验证和回滚时间，截止后不开启新部署；进行中的操作安全收尾。

真实生产账号登录、邮件流程及已认证市场/KM/制造/战术/管理任务仍未验证。匿名 401、WebSocket 101、合成 fixture 和截图不代表这些任务成功；后续交付必须明确实际验证范围。
