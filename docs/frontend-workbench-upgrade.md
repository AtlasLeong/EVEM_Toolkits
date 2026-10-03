# 前端工作台升级：本阶段交付与发布记录

源码中保留的原生截图索引：[frontend-workbench-evidence.json](frontend-workbench-evidence.json)。它包含已接受的 Library 身份和证据边界；`output/` 内的完整本地日志、原始截图与测量文件是生成的审查材料，不随源码提交。

初始 draft 的待办：本地生产构建测量确认手机市场与 KM 的加载布局位移偏高（CLS 约 0.63 / 0.28；即时合成接口、无节流，不能代替线上 p75），正在以实际 loading/loaded 截图和 LayoutShift 元素记录补齐稳定加载布局。字体两倍压力模拟揭示市场刻度/按钮及部分固定高度控件的裁剪；有数据行星计算器的手机布局也需修复。尚未达到 merge / deploy 状态。

首阶段补查已修复：KM 采集后台两张手机表格的 15 个单元格补上与原表头一致的字段名；访客进入管理员登录时不再把未启用的查询显示为持续验证。新增与原管理员回归 5/5 通过，采集后台单元测试 3/3 通过；数据、权限和接口保持原样。

记录时间：2026-10-03 19:16 UTC。仓库：AtlasLeong/EVEM_Toolkits；候选分支：codex/frontend-command-deck-20261003。本记录供 PR 审阅和父代理串行部署使用，不代表已发布。

本阶段解决登录入口误导、商品切换与缓存状态混淆、小屏击毁报告裁切及主要工具在手机上难以快速读取的问题，并把现有深色工具站统一为“新伊甸工作台”。保持真实数据、表格密度、计算与权限流程，不宣称获奖、完美或全面可访问性合规。

## 1. 版本与发布状态

| 项目 | 本记录时状态 |
| --- | --- |
| 线上已发布版本 | 5cda8bef3b05dfb6361c51fb6abde2c07ad7492c（市场 PR #28） |
| 本地基线提交 | 5cda8bef3b05dfb6361c51fb6abde2c07ad7492c |
| 最新 master | 父代理通报已到 dbd40c32；提交/PR 前须吸收最新 master 并保留 PR #29 的后端修正 |
| [PR #29](https://github.com/AtlasLeong/EVEM_Toolkits/pull/29) | 后端修正已 merge；其 Production 全量前端回归失败，尚未 publish |
| 本阶段前端 PR | 待父代理创建 draft PR；本记录没有新增 PR 号码或提交 SHA |
| 本阶段远端 CI | Pending，尚未开始；不得把本地通过写成 GitHub CI 通过 |
| 本阶段 merge / deploy | Pending；PR #29 发布暂停未解除前不并发发布 |
| 用户常规自主权窗口 | 2026-10-03 18:32:24 UTC 至 2026-10-04 02:32:24 UTC；截止后不新开部署，进行中的事务安全收尾 |

最新 master 与线上组件版本分别记录。master 前进不意味着前端或后端已经切换上线；发布后须以真实版本接口和资源检查确认。

## 2. 设计方向与分阶段范围

方向是原创的“新伊甸工作台”：稳定分组导航、紧凑数据区、上下文详情。Awwwards、Webby、FWA 仅作为工艺参考，不使用获奖标识或获奖宣传。沿用真实 EVEM 罗盘 PNG、中文系统字体和工具站语境，给暗色原始标志增加浅色背板以提高辨识度。

共享 token 位于 [console-unification.css](../front-codex/src/styles/console-unification.css)。主要颜色为底色 #0b171d、面板 #12252e、抬升面 #19323d、分隔线 #294750、正文 #e8f0f1、次要文字 #9bb1b8、琥珀操作色 #efb566。字体使用 Segoe UI Variable / Segoe UI / PingFang SC / Microsoft YaHei；正文 15px、标签 13px、辅助文字 12px、页面标题 28px，数字使用等宽数字。留白用于分组与层级，不普遍放大表格行高。

默认紧凑密度；侧栏与移动导航提供“紧凑 / 舒适”，只存本地偏好 evem-content-density。舒适模式调整数据行、导航和目录间距，不任意扩大图表或星图，不调用 API。存储不可用时控件仍可操作。共享反馈动效约 160ms、面板约 200ms；登录与页面转场尊重 prefers-reduced-motion。

阶段顺序：

1. 捕获线上登录/访客行为和本地支持预览，先修认证入口、导航、市场数据识别与缓存反馈。
2. 修 KM、制造与战术小屏关键任务，再统一其余真实路由的标题、颜色、控件与状态。
3. 独立代码审查、同状态桌面/手机截图复核、完整回归和现有 CI。父代理审阅通过、CI 通过并解除 PR #29 发布暂停后，串行 merge / deploy。

## 3. 完整路由清单

以 [App.jsx](../front-codex/src/App.jsx) 实际声明为准：35 个显式 path 声明，加 1 个 index 重定向，共 36 个可定位路由入口；另有 1 个无路径 AppShell 包装节点，总计 37 个 Route 声明。

36 个入口包括 29 个生产内容路由模式、4 个旧链接别名、根路径重定向、通配兜底和 1 个 DEV 专用页。/killboard/:killId? 是一个声明，覆盖 /killboard 与带 killId 的详情地址；不能把任意 id 实例当成新的路由数。

“V”表示现有生产查看白名单门禁；“A”表示 App 的 RequireAuth；“K”表示 RequireKillboardAccess。页面与 API 的管理员、组织成员、编辑、审核权限继续由现有逻辑判定；截图和前端导航不证明服务端授权。

| 路由模式 | 页面 / 行为 | App 门禁 | 截图证据状态 |
| --- | --- | --- | --- |
| /login | 登录、注册、找回密码 | 独立认证入口 | 真实线上桌面/手机；候选本地 production 构建另行复核 |
| /fraudlogin | 诈骗管理员登录 | 独立认证入口，原管理员校验 | 本阶段基线仍缺截图 |
| /access-denied | 查看权限拒绝、切换账号 | 独立拒绝页 | 行为回归通过；基线仍缺截图 |
| /market | 市场目录、报价、历史图表 | V | 本地 fixture 桌面/手机；候选缓存失败等状态有文件 |
| /market/admin | 市场后台 | V + A | 本阶段基线仍缺截图 |
| /manufacturing | 制造估价、材料与方案 | V | 本地 fixture 桌面/手机 |
| /planetary | 行星资源、筛选、计算器 | V | 本地初始状态；填充结果/计算器状态仍缺基线截图 |
| /killboard/:killId? | 击毁报告列表及详情 | V + K | 本地 fixture /killboard 桌面/手机与裁切证据；独立数字详情地址需补同状态截图 |
| /killboard/admin | 击毁采集后台 | V + K | 本阶段基线仍缺截图 |
| /starmap | 星系导航 | V | 本地稀疏 fixture 桌面/手机，不能据此全面评价高密度星图 |
| /tactical | 组织战术协作 | V；成员/API 原判权 | 本地 fixture 桌面/手机 |
| /tactical/usage | 战术板概况 | V + A；概况 API 原判权 | 本阶段基线仍缺截图 |
| /fraudlist | 防诈名单、查询与举报 | V；举报/API 原判权 | 本地 fixture 桌面/手机；线上仅证实未认证入口回登录 |
| /feedback | 需求与反馈 | V；提交/管理/API 原判权 | 本地 fixture 桌面/手机 |
| /infocenter | 工具介绍与入口 | V | 本地 fixture 桌面/手机 |
| /usersetting | 密码与预设资源价格 | V + A | 本地 fixture 桌面/手机 |
| /fraudadmin | 诈骗后台 | V + A；管理员校验保留 | 本地 fixture 桌面/手机，捕获时已含早期壳层修改 |
| /licenseadmin | 授权码后台 | V + A；管理员校验保留 | 本地 fixture 桌面/手机，捕获时已含早期壳层修改 |
| /corporations | 军团大厅 | V；公开资料/API 原判权 | 本地沙盒桌面/手机 |
| /corporations/manage | 军团管理 | V；页面/API 原判权 | 本阶段基线仍缺截图 |
| /corporations/review | 军团审核 | V；页面/API 原判权 | 本阶段基线仍缺截图 |
| /corporations/:id | 军团详情 | V；公开版本/API 原判权 | 本阶段基线仍缺截图 |
| /starsea | 星海见闻列表 | V；公开版本/API 原判权 | 初始沙盒不支持 API 的失败状态；正常 fixture 另捕获 |
| /starsea/mine | 我的星海见闻 | V；页面/API 原判权 | 本阶段基线仍缺截图 |
| /starsea/new | 新建星海见闻 | V；页面/API 原判权 | 本阶段基线仍缺截图 |
| /starsea/review | 星海见闻审核 | V；页面/API 原判权 | 本阶段基线仍缺截图 |
| /starsea/review/:revisionId | 审核指定修订 | V；页面/API 原判权 | 本阶段基线仍缺截图 |
| /starsea/:id/edit | 编辑星海见闻 | V；页面/API 原判权 | 本阶段基线仍缺截图 |
| /starsea/:id | 星海见闻详情 | V；公开版本/API 原判权 | 本地 /starsea/1 fixture；捕获时已含早期壳层修改 |
| / | index → /market | AppShell V | 重定向回归通过；无独立内容页 |
| /bazaar | 旧链接 → /starmap | AppShell V | 重定向，无独立内容页 |
| /mobileuser | 旧链接 → /fraudlist | AppShell V | 重定向，无独立内容页 |
| /mobilelogin | 旧链接 → /login | AppShell V | 重定向，无独立内容页 |
| /mobileCalculators | 旧链接 → /starmap | AppShell V | 重定向，无独立内容页 |
| * | 未知路径 → /market | 目标页 V | 兜底，无独立内容页 |
| /dev/icon-verification | 图标验证 | 仅 DEV 编译 | 不进入 production 路由产物 |

## 4. 已确认问题与候选修复

下表描述候选代码的行为；是否上线以第 1 节及发布后的版本检查为准。

| 问题与 before 证据 | 本阶段 after 行为 | 验证范围 |
| --- | --- | --- |
| 真实线上登录页显示“访客模式”；点击 /fraudlist 返回完全相同的 /login，没有原因提示 | VIEWER_ACCESS_ENABLED 时展示准确的查看权限说明，移除不可兑现的访客入口；明确注册不会自动获得查看权限。明确公开模式与 DEV 保留访客链接 | 真实线上 before；production/private 与 public 的组件渲染回归；候选上线后需再次观察真实页面 |
| RequireAuth / KM 入口丢失目标地址；Login 忽略查看门禁的 state.from | 记录并验证站内目标，登录/注册后恢复页面；保留安全的 tactical organization 参数；拒绝外部、认证循环、未知路径与控制字符。切换账号真正清除会话并进入 /login | 10 项认证/返回单元测试及认证 E2E |
| 标签页均为 Tab 停靠点、缺少方向键；字段标签和错误没有关联 | 单一 roving Tab 停靠点，ArrowLeft/Right、Home/End；label/id、autocomplete、aria-invalid/aria-describedby；无效提交聚焦首个字段；减少动效 | 43 项 auth/shell E2E 含原认证流程 |
| 平铺导航没有跳过内容入口；移动菜单关闭和换页后焦点不明确 | 三组稳定导航、跳到主内容、Escape 关闭并返回开关焦点、导航后聚焦主内容；1180px 与 CSS 同边界；KM 详情保持所属高亮，后台只有一个 aria-current | auth/shell E2E；独立审查指出的两项边界已修复并回归 |
| MarketPrices 切商品可能让新标题对应旧曲线；缓存存在时刷新失败不可见 | 目录、商品、区间查询键之间不再沿用错误的 placeholder；保留同一键的真实缓存，并展示刷新失败/正在刷新/缓存读取状态 | 122 项市场 E2E、16 项市场单元；无生产请求 |
| 更新时间、空盘、未采集和失败容易混为一谈 | 区分游戏采集 observed_at 与前端读取时刻；已观测无挂单显示“暂无挂单”，未采集显示“尚未采集”，已有单价但无多档显示“未提供多档报价”；失败显示独立提示 | 市场状态回归；缓存不是实时行情声明 |
| 手机市场图表被长目录推到下方；横向统计缺少发现线索 | 手机目录可折叠/切换商品，保留当前选择摘要；统计滚动区提供可见滑动说明、键盘入口和关联描述 | 320/390px 市场状态截图及市场回归；所有精确值仍可读取 |
| 真实 Chrome 改变窗口宽度后，市场目录与 KM 索引的焦点被 CSS 隐藏并回到 BODY | 移动开关隐藏时移交可见搜索；桌面搜索转为移动时保留索引展开和原焦点；不抢目录外控件焦点。索引权限撤销且无启用控件时保留可见容器焦点 | 新增真实键盘 760↔761px / 767↔768px 回归；市场另测 760px；403 空索引另有回归 |
| KM 手机报告详情被固定高度 shell-main 祖先裁切；基线 clientHeight 699、scrollHeight 1612 | 小屏改为可滚动文档，收起报告索引后突出当前报告；加载、无匹配/无报告、复制反馈与长中文/大数保留清楚状态 | 工具回归与候选截图；不改变 KM API 或采集规则 |
| 制造手机总成本位于完整生产树之后 | 当前方案摘要提前显示；完整报价显示总成本，缺报价显示已覆盖小计和待补项，保留明细与原计算语义 | 工具 30 项 E2E、108 项单元；不把部分报价当完整总成本 |
| 战术/军团控件仍有浅色残留，页面标题和间距不一致；原暗色罗盘在暗底不易辨认 | 统一深色 token、焦点、标题与字段层级；真实罗盘配浅色背板；战术布局与共享控件相协调 | 本地截图与完整回归；不修改战术协作/传输/权限策略 |
| 授权码手机页 scrollWidth 429 > clientWidth 390；粘性操作遮住记录身份，后台表单拥挤 | 窄屏表单单列；授权码工具条可收缩；窄屏取消操作列 sticky，并显示表格滚动说明，保留全部字段/动作 | 候选 320/390/1440 截图已在工作树；完整 E2E 仍进行中 |
| 信息中心只介绍三项旧工具；设置页错误、空状态与加载边界不清 | 增加已有工具的真实入口；设置密码标签/自动填充/结果状态；预设价格加载失败有重试并保留编辑内容 | 其余路由候选与回归；未把未加载的价格误写为无数据 |

未删除真实路由、功能、字段、权限校验或测试。此处 UI 改动不包含 PR #29 的后端字段修正；整合最新 master 时须保留其结果。

## 5. 截图与证据边界

### 5.1 真实 production 观察

使用用户电脑浏览器访问 https://evemtk.com，捕获并检查真实未登录页面。没有绕过真实认证，没有授权账号的 production 功能截图，没有生产业务写入。

| 观察 | 本机捕获 | Library native ID |
| --- | --- | --- |
| 登录桌面 | ../../output/playwright/01-production-login-desktop.png | libfile_5acfcab877588191a520e652c6be7a57 |
| 点击访客入口后回 /login 且无提示 | ../../output/playwright/02-production-guest-bounce.png | 本记录未收到该文件的 native ID，待父代理补充 |
| 登录手机 | ../../output/playwright/03-production-login-mobile.png | libfile_4abc9c5e11ec8191ac75e37ef17f0564 |

这组证据只说明登录入口及未认证导航行为，不说明通过认证后的市场、KM、管理或游戏采集功能。

### 5.2 本地支持预览与 fixture

完整基线索引为 [baseline-audit-manifest.json](../output/playwright/baseline/baseline-audit-manifest.json)：用户电脑 Chrome headed 独立会话，127.0.0.1:4186 支持的 preview:ui 沙盒，API 强制到闭合的本地 /api；市场/制造/KM/战术/星海/后台使用已有合成 E2E 数据。

manifest 记录 15 个路由/状态步骤、33 个已成功上传并标记视觉检查接受的图片。主基线 01/02/03–13 在共享 UI 修改前捕获；11b、11c、14、15 在早期壳层/导航修改后捕获，属于初始工作树证据，不能宣称 untouched master 基线。11 的沙盒 API 不支持状态与 11b 正常 fixture 状态均保留，没有用正常 fixture 替代真实失败记录。

候选检查文件包括：

- ../output/playwright/market-data-verified/：320/390 手机已选商品、1440/390 缓存刷新失败、1280 短桌面；[verification.json](../output/playwright/market-data-verified/verification.json) 记录市场 122/16 和文件摘要。
- ../output/playwright/secondary/：军团、诈骗后台、信息中心、授权码、行星初态、设置和战术的 320/390/1440 候选截图。
- ../../output/playwright/phase1-local-production-login-desktop.png 与 phase1-local-production-login-mobile.png：本地 production 构建入口，不是线上新版本；父代理负责接受终版截图并补充 native ID。

本地 fixture 截图不证明真实服务端权限、真实邮件流程、生产数据准确性、游戏采集有效性或现场性能 p75。截图不能替代键盘交互测试，也不能证明完整 WCAG 合规。没有把实验室或一次运行当成真实用户 LCP / INP / CLS 分位数。

Library 图片 read 可能只返回文字/描述；它不等于已经看到像素。消费端应通过当前环境支持的 Library 下载/materialize 路径取得图片字节，确认路径存在、尺寸和图像内容后再预览。本机 Windows 路径不能当作另一环境中已存在的路径。manifest 保存准确 native ID、版本及本地路径；Windows helper 的 xattr 未持久化，不能宣称已写入 xattr。不要记录或传播带签名下载 URL。

### 5.3 基线 Library native 图片索引

下列 ID 从 manifest 原样读取，33 项均记录 status=succeeded。这些是本地预览证据，不是 production 已认证截图。

| 文件名 | Library native ID |
| --- | --- |
| 01b-market-desktop-clean-1440.png | libfile_4155227d002881918e8e2b708e4cd563 |
| 02b-market-mobile-clean-390.png | libfile_b300f95c7fd88191a2cc657451d27a3b |
| 03-manufacturing-desktop-1440.png | libfile_6f65f2cb16388191b3217b2efb4c6269 |
| 03-manufacturing-mobile-390.png | libfile_7b84166933288191b0ea9cec3f9ba1cd |
| 04-planetary-desktop-1440.png | libfile_c32ec463c76481918b6ab0e39abf0b37 |
| 04-planetary-mobile-390.png | libfile_36a1616ecfd881918851ddefd3033cb2 |
| 05-starmap-desktop-1440.png | libfile_c37bc4f964e88191bd351e2afc2ad650 |
| 05-starmap-mobile-390.png | libfile_de041133efe48191973c4bc565baf553 |
| 06-fraudlist-desktop-1440.png | libfile_9ed6703f85248191aec3f0da16120a85 |
| 06-fraudlist-mobile-390.png | libfile_b54fda4c14dc8191af9695406e87f5d1 |
| 07-feedback-desktop-1440.png | libfile_c616e5b3e7f481919508facb059263c6 |
| 07-feedback-mobile-390.png | libfile_42bd88aa86ac819195f4a79571c57b49 |
| 08-infocenter-desktop-1440.png | libfile_3fb4eb315cb48191972cff69e37c7a35 |
| 08-infocenter-mobile-390.png | libfile_058d4efaa1308191a5465a66320d7cb2 |
| 09-settings-desktop-1440.png | libfile_6060351c79748191b1f7d3144fcb2dc4 |
| 09-settings-mobile-390.png | libfile_2fe6177f401c819184d2d92482ea83a8 |
| 10-corporations-desktop-1440.png | libfile_3d46365a48a481918e500508bb43e0bd |
| 10-corporations-mobile-390.png | libfile_80227beddc888191b33085f6b2220871 |
| 11-starsea-desktop-1440.png | libfile_a73dec593dfc819185d486aca9335a8b |
| 11-starsea-mobile-390.png | libfile_2f5a81590ab881919c011fe889fa9f3e |
| 12-killboard-desktop-1440.png | libfile_8bce28461bac819183a5ac252d827941 |
| 12-killboard-mobile-390.png | libfile_067e3c5db940819196b821dafaaf2052 |
| 13-tactical-desktop-1440.png | libfile_b35815faf38c8191a60ba6327610813a |
| 13-tactical-mobile-390.png | libfile_505209e94a1881918362ac535ed92dbd |
| 12b-killboard-mobile-scrolled-390.png | libfile_2a7ddf498b4c8191996c2e41a0ec4fec |
| 11b-starsea-fixture-desktop-1440.png | libfile_63903de8934081919bee69f51e1da2f7 |
| 11b-starsea-fixture-mobile-390.png | libfile_20717655314081919ceacd8ca24e1b1c |
| 11c-starsea-detail-desktop-1440.png | libfile_944bc0e20dc08191a6e1e28370f4d165 |
| 11c-starsea-detail-mobile-390.png | libfile_10dfd5b262188191ad5a5e70c427a9e0 |
| 14-fraudadmin-desktop-1440.png | libfile_c8165b2937e08191a56e7f7ec2d85da3 |
| 14-fraudadmin-mobile-390.png | libfile_eed30c905ae08191a700fd162ec7467d |
| 15-licenseadmin-desktop-1440.png | libfile_defb642dca588191b3a3c280f6ec64e3 |
| 15-licenseadmin-mobile-390.png | libfile_b3b528e6f7dc8191876ae6b4d7f1b6cd |

### 5.4 已上传候选截图

[after-library-mapping.json](../output/playwright/after-library-mapping.json) 记录下列 27 个候选图片身份。它们仍是本地合成证据；焦点边界修复由实际浏览器交互回归验证，不能用旧截图证明新交互。

| 候选图片 | Library native ID |
| --- | --- |
| tool-refinement/manufacturing-1440.png | libfile_d86d405544b88191ac702f1999486035 |
| tool-refinement/manufacturing-390.png | libfile_152e1ee7d7a48191a267c457be19363e |
| tool-refinement/manufacturing-1280.png | libfile_7fc3623e7478819180561214e64a9f8b |
| tool-refinement/killboard-1440.png | libfile_3cbdd479b3ac8191ad71d2944200f982 |
| tool-refinement/killboard-390.png | libfile_5b2455ff3f7881918d211c63d1ccefd4 |
| tool-refinement/killboard-1280.png | libfile_ba19e65591a881919ff996a4f3ac97ae |
| tool-refinement/killboard-equipment-390.png | libfile_179fc80791348191a9be0fd226308e98 |
| tool-refinement/killboard-long-content-320.png | libfile_823efa2495d48191928a726187d9530e |
| tool-refinement/killboard-long-content-copy-visible-320.png | libfile_35d9aa24b808819192c9aaf43d7bf7fb |
| secondary/tactical-after-390.png | libfile_97449b993c508191b5625f225a3fe5bb |
| secondary/tactical-after-320.png | libfile_1536c277513881918fc465e7f47d9077 |
| secondary/licenseadmin-after-390.png | libfile_72e51efc0690819193255c0376e79a92 |
| secondary/licenseadmin-after-320.png | libfile_42e563bc31d48191beda56155e5d4921 |
| secondary/settings-after-390.png | libfile_2e9d852da55c8191b2a458a5d531d6c7 |
| secondary/planetary-after-320.png | libfile_5c32e9d01fb081919a5b6d235f164dde |
| secondary/corporations-after-390.png | libfile_fb4f6f8543e8819186c6eafe86b4e3f1 |
| secondary/infocenter-after-1440.png | libfile_5d320a172f60819199aef224a4b2ac5e |
| secondary/fraudadmin-after-390.png | libfile_e2b78bfe95848191aae7d6a72e381a92 |
| market-data-verified/cached-refresh-failure-1440.png | libfile_6310c8b836f08191a2068166120e9c8e |
| market-data-verified/cached-refresh-failure-390.png | libfile_302c03eab2388191ba5303aba8f7c62f |
| independent-tools/market-stat-hint-390.png | libfile_6b2d64ee6d888191b301f93e3bcf8160 |
| independent-tools/market-stat-hint-320.png | libfile_361bb56043048191a38996459dcaa2d5 |
| market-data-verified/short-desktop-1280.png | libfile_625ef6ab05d8819190f8a2d13eb4ec81 |
| secondary/settings-error-after-390.png | libfile_8c562c4ae7fc819199df6d9648ae8ec6 |
| secondary/settings-error-after-320.png | libfile_0a069f25fdf88191863ae02726fb99bf |
| secondary/settings-recovery-after-390.png | libfile_41ae108a81508191be3cfa1da91c9764 |
| secondary/licenseadmin-actions-viewport-390.png | libfile_6514ac3508f48191bc9f04f74f812655 |

## 6. 本记录时验证结果

| 验证 | 结果 | 说明 |
| --- | --- | --- |
| Auth / shell E2E | 43 passed | 含原登录/注册/找回流程、390/768、键盘、返回路径、KM 当前导航、1180 边界、密度偏好与存储失败 |
| Auth / return / viewer 单元 | 10 passed | 含 private production 不提供误导访客入口、显式 public / DEV 保留访客 |
| Market E2E | 122 passed，0 failed | 本地 loopback 与截获 fixture，无生产请求；verification.json 记录 1.8m |
| Market 单元 | 16 passed | 数据状态、轮询、价格、范围 |
| KM / manufacturing 工具 E2E | 30 passed | 本地合成关键任务与响应式 |
| 工具单元 | 108 passed | 现有业务与表示逻辑，不证明 production 访问权 |
| 目录断点焦点增量 | 最终 3/3 passed（8.9s，exit 0） | 真实 keyboard/focus 760↔761px、767↔768px、市场 760px；403 空索引容器 fallback；KM controlled-source 35/35 passed；不与完整专项重复相加 |
| Market 状态 + KM/制造表示专项复跑 | 31/31 passed（31.0s，exit 0） | 最后 403 fallback 补充前的完整两份专项；最终 3 项焦点回归和全部 617 单元在补充后通过；最终全量终轮仍待父代理记录 |
| 全体 frontend unit / preview contract | 617 passed | 父代理已确认的当前本地结果；不可与分项重复相加 |
| production build 与 bundle budget | Passed | entry 29,183 bytes；主 CSS 120,067 bytes < 122,880 bytes，余量 2,813 bytes；保留原预算门禁 |
| 全量 frontend E2E | 首轮 429 passed / 3 failed，共 432 项；冻结后实际清单 439 项 / 81 文件，终轮 Pending | 两项筛选案例遇 Chrome crash，一项 1280px 市场捕获到 HMR 中间态；新补筛选与断点焦点回归扩大清单，不能忽略首轮失败或写全量 passed |
| 独立 tactical E2E | 170/170 passed（5.0m） | 父代理确认的完整本地结果，原 CI 配置保留 |
| 独立 preview E2E | 4/4 passed，正常退出（17.0s） | Windows 外部配置仅移除自动 server 清理，复用手动 4191 服务；CI 原配置未削弱 |
| 完整后端 / 发布安全门禁 | Pending，待最终 CI | 各专项通过不替代现有完整 CI |
| 远端 PR CI 与部署 smoke | Pending | 尚未开始本阶段远端 CI、merge、deploy |

Windows 初次使用自动 webServer 启动 npm 的专项运行在完成案例后卡于退出；仅中断自己的运行会话，没有全局杀浏览器。最终专项使用独立 node Vite 服务和 reuseExistingServer，得到正常 exit 0。中断的早期运行不计入通过数量。没有忽略失败、删减测试或放宽 bundle 预算。

## 7. 仍需补齐的截图与验证

基线 manifest 仍列出：市场后台、KM 采集后台、军团详情/管理/审核、星海我的列表/新建或编辑/审核、战术概况、诈骗管理员登录、查看权限拒绝、填充行星结果与计算器交互。路由表进一步展开了具体模式，数字 KM 详情地址也需与当前数据状态一致的截图。

终版审阅还需确认管理/编辑/审核页面在适用角色下的正常、加载、空、错误与拒绝状态；长中文、大数字/单位、键盘焦点、200% 文字缩放、窄屏与 reduced-motion。已存在 E2E 覆盖不应写成所有状态均已截图。真实 production 授权账号的只读关键任务回归仍未执行，须使用真实认证且遵守现有访问边界。

无明显高优先级问题的判断应来自明确截图、交互、审查和回归证据；不能用“绝对完美”作为结束标准，也不做无目的无限改动。

## 8. 串行发布与回滚要求

沿用 [部署说明](../scripts/deploy/README.md)、[DEPLOY_PRODUCTION.md](../DEPLOY_PRODUCTION.md)、[查看权限部署说明](deployment-viewer-access.md) 及现有 CI / Production 工作流。本阶段不更改发布锁、concurrency、摘要/路径校验、迁移检查、健康/版本检查或事务回滚。

发布顺序：

1. 父代理重新核验 master、PR #29 和当前线上组件 SHA，保持 PR #29 发布暂停；候选整合最新 master，解决冲突时保留其后端修正。
2. 创建 draft PR，完成独立代码审查和终版同状态截图复核。保留现有全量前端/后端/权限/迁移/发布安全检查，全部 CI 通过；发布前补写真实 PR、run、SHA 和截图 native ID。
3. 父代理明确解除 PR #29 发布暂停后串行 merge，再由既有受控发布路径 deploy。不得与现有发布并发，不手工覆盖线上 dist 或绕过失败门禁。
4. 使用既有 deploy 身份和锁；避免 root 发布导致 metadata / state 所有者改变。不更改 security-critical chown/chmod，不绕保护，不扩大凭据或持久访问。
5. 已知 publisher 上传可能有 15 分钟超时。保留既有校验、锁和事务 journal，核对实际状态后依既有流程恢复；不把重试当成新并发发布，不手写成功状态。
6. 发布后确认 /deploy-version.json、/api/deploy-version/、页面与引用 assets、服务/就绪/权限门禁及真实账号只读关键任务。401 门禁健康不能替代授权查询成功。
7. 任一健康/版本检查失败使用现有事务回滚；确认旧版本恢复及所有权。回滚代码不回滚数据库，不执行未经审查的 migrate/fake。若回滚未恢复，保留 journal 并阻止后续切换。

授权截止前留足 deploy smoke 与回滚时间；2026-10-04 02:32:24 UTC 后不自行开启新部署。发布成功后由父代理将本记录的 Pending 状态替换为真实 PR/run/version/test 证据。
