# 全站控制台统一：验证记录

日期：2026-10-03。范围为本地前端实施和预览，未推送或部署。

## 1. 视觉证据与用户流程

在真实 React 页面上检查制造目标切换、数量步进、节点自造/购买、价格编辑、市场双走势/单走势、战术板选择和搜索、战报摘要及公共页面。截图使用测试 fixture 或本地沙盒数据，不代表实时行情、真实战报或制造成本。

- `output/ui-unification-2026-10-03/manufacturing-desktop.png`：1280×720；三张独立工作卡、真实客户端图标、统一标题、侧栏边距、琥珀动作色和大金额简写。
- `output/ui-unification-2026-10-03/manufacturing-mobile.png`：390px；单列配置 → 制造链 → 成本，44px 触控目标、缩小深层缩进，无横向溢出。
- `output/ui-unification-2026-10-03/market-desktop.png`：1920×1080；折线区域优先、单走势切换、完整五档报价和最新采集时间。
- 额外检查 1440、1280、1024、820、768、390px，战术板平板选中态与桌面搜索结果，减少动效模式及键盘焦点。

## 2. 自检后实施的优化

1. 排版与留白：统一主要标题 28px；桌面/平板/手机内容边距为 24/20/16px。大屏内容可用宽度上限 1800px。
2. 视觉层级与颜色：深海军蓝底、分层面板、琥珀主操作、蓝灰信息。警告/危险/成功保留语义，地图画布安全等级不改。
3. 动效与微交互：数量按钮不使用位移变换；固定图片盒子和静态加载纹理；减少动效规则关闭持续动画。控件使用单一清晰焦点处理。
4. 响应式：制造页 1099px 以下解除固定高度/内层滚动陷阱并堆叠，手机深层树缩进与操作可换行。
5. 图像加载：当前目标及首层 eager/high，其他节点 lazy；源切换重置加载态；读取失败提供真实缺图提示，不将全量素材提前请求。
6. 可读性：客户端/采集错误代码映射为中文；修复战术板平板选中内容和地图搜索文字对比度，关键普通文字测试最低 4.5:1。
7. 末次独立审查：补齐星海选中舰船、导入预览、粘性编辑底栏和退回原因；为 portal 战术弹窗单独提供字段/提示及选项深色 token；普通 ghost 按钮不覆盖危险按钮的默认和悬浮语义。新增 6 项实际交互回归先 RED 后 GREEN，没有插入模拟 DOM。

设计参考采用 [Anthropic 开源 frontend-design 指南](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) 的明确视觉方向、克制动效和截图迭代原则；具体主题来自用户认可的 EVE 市场控制台。未复制获奖网站品牌素材，未声称获得奖项。

## 3. 自动验证

所有命令在 `front-codex` 内执行。

| 验证 | 命令 / 证据 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm run test:unit` | 515/515，通过 |
| 构建和 bundle 预算 | `npm run build` | exit 0，通过；入口 CSS 113,539 bytes / gzip 18.99KB；制造 JS 40,508 bytes / gzip 13.31KB |
| 主站浏览器回归 | `PW_TEST_PORT=4173 npx playwright test --workers=3 --output=test-results-console-unification-verified` | 377/377，通过；5.0 分钟，exit 0 |
| 战报补充回归 | `PW_TEST_PORT=4175`，`console-killboard.spec.js` | 2/2，通过；1440/390px |
| 沙盒契约 | `node --test tests/preview/*.test.mjs` | 30/30，通过 |
| 战术板独立对比度 | `console-contrast.spec.js` | 6/6，通过；覆盖平板选中态、桌面搜索和 portal 表单，修复后断言未放宽 |
| 末次 P2 编辑/弹窗/危险交互 | `console-unification.spec.js` + 战术 `console-contrast.spec.js` | 两文件 20/20，通过；新增 6 项先 RED 后 GREEN，普通文字 4.5:1 / 精确颜色 / 功能断言不变 |
| 战术板完整套件 | `PW_TEST_PORT=4181 TACTICAL_TEST_PORT=4181 npx playwright test --config=tests/tactical-e2e/playwright.config.js --workers=2 --output=test-results-console-tactical-verified` | 169/169，通过；5.7 分钟，exit 0 |
| 通用按钮特异性修复 | `warm-neutral.spec.js` + `console-unification.spec.js` | 19/19，通过；计算器主按钮与危险按钮均保留原精确颜色/功能断言 |
| 补丁格式 | `git diff --check` | 通过 |

主站新增几何断言等待入场动画结束再读取准确位置，仍保留 24px 边距精确断言。Chrome 153 CDP 人工修改 DPR 不发出 resize/media 事件，测试补发真实 resize 后保留原 DPR 和无重复调整断言；没有向业务代码添加轮询。

战术板旧测试在 5 秒断言窗口内等待本身 5 秒轮询，trace 证实最后一次采样早于新 snapshot 响应。同步测试应等待撤销 system_count 后的实际 HTTP 响应，再维持原 has-count=0、force=1 数量断言；业务轮询频率不变。

末次全量回归发现普通 ghost 排除条件抬高 CSS 特异性，覆盖了行星计算器主按钮。将条件置于 `:where()` 后保持原通用规则优先级；先验证相关 19 项，再重新完成 377 项全套。危险按钮独立语义未削弱。

另一次并发启动的战术运行在主文档请求阶段超过导航预算（trace 为约 31 秒，尚未加载业务模块），人为中止保留 Trace、不计为通过。最终错峰启动后完整 169 项通过，没有放宽原导航或数量断言预算。两个最终 `.last-run.json` 均为 `passed`、`failedTests: []`。

最终主站与战术板合计 546 项浏览器用例通过；战报 2 项已包含在主站最终套件，不重复计数。

## 4. 本地预览与边界

`http://127.0.0.1:4185/manufacturing`，服务为 `npm run preview:ui`，仅绑定 127.0.0.1。本地沙盒不连接线上，部分实时行情接口不可用时会明确提示，并可手动填写方案价格。

未改身份认证或制造数值算法，未开放私有制造模块的生产访问。`2235102484@qq.com` 单账户查看限制保持。截图及自动测试不能证明任意网络下所有图片都立即显示；本次优化的是请求优先级、源切换反馈和布局稳定性。
