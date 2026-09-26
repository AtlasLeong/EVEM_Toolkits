# Market focus terminal — 2026-09-27

final result: passed

## Target and evidence

- Source visual truth: `C:/Users/22351/.codex/generated_images/01a0d2b6-27fb-7af0-b435-8ec1a318dbea/exec-3edad2b5-7e23-4556-9094-82baa3a52759.png`, the user's selected first concept.
- Browser-rendered implementation: `output/market-focus-qa/implementation-1672.png`, from the actual `/market` React route. Source and implementation are both 1672 × 941 pixels; CSS viewport 1672 × 941, device scale factor 1, no density normalization or browser chrome.
- Full combined comparison: `output/market-focus-qa/comparison-full.png`; focused combined comparisons: `comparison-controls.png`, `comparison-catalog.png`, `comparison-quotes.png` in the same directory. Each contains both source and implementation, not separate remembered views.
- State: guest, expanded product sidebar, currency selected, single sell chart, 29 fixture observations. Source prices and curve are illustrative; implementation uses deterministic API fixtures for visual regression. Source selects 7 days; regression capture uses the retained 24-hour default. Both states were exercised. Live API observations were also inspected at `http://127.0.0.1:4180/market` through IAB, without production writes.
- Responsive captures: `front-codex/test-results-market-focus-final/` includes 1920 × 1080, 1672 × 941, 1440 × 960, 1280 × 720 and 390 × 844. The viewport-sized terminal is desktop-only; phones deliberately reflow into a scrollable document.

## Findings and iteration history

1. Initial implementation blocked: small-screen panels inherited desktop zero flex bases, allowing 300px plots to overlap readouts. Corrected auto-height flow below 1180px. Existing 390px chart containment regression now passes; live DOM confirms both plots end within their own panels.
2. Independent quality review blocked on two P2 issues: adjacent quote levels collapsed to the same compact value, and cyan focus rings had poor contrast on the warm toolbar. Normal-length quote levels now retain exact decimal strings (ISK is in the rail heading); only very long values compact. Header focus now uses dark `#17333d`. Added a regression that first failed on five identical `2100万` labels, then passed with distinct values, along with focus contrast and very large price coverage.
3. First combined visual comparison identified a dark square strip behind the rounded terminal's top gap (P2). Made only the outer container transparent. Final combined capture shows the intended warm inset around the rounded terminal.
4. An intermediate automated screenshot preceded lazy-image decoding. This was capture timing, not missing assets: live rendering and icon load tests already showed the icons. Capture now waits for onscreen image decoding. Regenerated full and focused comparisons show the actual approved game artwork.
5. Final combined comparison: no remaining actionable P0/P1/P2 findings. Independent specification and quality reviews approved the current implementation.

## Required fidelity surfaces

| Surface | Result |
| --- | --- |
| Fonts / typography | Retains the product sans-serif stack and Lucide family; current price is the strongest metric, other metrics align on one line. Values use tabular numerals. Compact labels remain at least 12px in charts/statistics; dense peripheral metadata is smaller. Exact values remain available to hover and assistive technology. |
| Spacing / layout rhythm | Warm compact toolbar, rounded inset, narrow 212px catalog, dominant central plot, 232px quote rail; single-row desktop controls. The existing 240px application sidebar is intentionally retained instead of the mock's approximate 210px navigation. No obscured controls or desktop horizontal overflow. |
| Colors / tokens | Solid dark teal terminal, amber sell, cyan buy, restrained separators; warm navigation remains consistent with the site. The illustrative glow/gradient is omitted for crisp data reading. Separate high-contrast focus colors on warm/dark surfaces. |
| Image quality | 48 approved lossless 128px WebP assets, rendered at 40px, mapped by stable IDs. Real supplied images replace the mock's generated imagery. Fixed-size lazy loading, unknown-ID and load-failure library fallback are tested. |
| Copy / content | Real catalog names and API fields, no invented descriptions, trade volumes or LIVE claims. Uses 报价档位 and 30天高/30天低. Preserves all-items search, observation count, exact hover/readout and legal footer absent from the mock. |

## Verification and boundaries

- 364 Node unit / preview contract tests passed.
- 110 market + related shell E2E tests passed in one final two-worker run. Subsequently all 10 focus-specific cases passed, including the additional very-large quote case and decoded-asset captures.
- Production build and bundle budget passed after the final production edits.
- Covered category/search/item switching without chart unmount, periods, sell/buy/both, tooltip alignment, keyboard navigation, null gaps, zero/huge decimal values, missing final quotes, empty/error/stale states, short desktops and mobile stacking. Manual live IAB checked single/dual views; error console contained no errors.
- 48 icon bytes match the approved exports; no backend, database, collection schedule or account changes.
- P3 follow-up only: optional extra intermediate time ticks / sampled extrema annotations. The current range and 30-day statistics already expose true backend extrema; no downsampled curve is mislabeled as the historical extreme.

## Previous QA record (preserved)

# 暖白客户界面：视觉验收

final result: passed

## 目标、环境与证据

- 源视觉：`docs/design/warm-neutral-approved.png`，用户认可的去“工作空间”、黑色透明头像版本。
- 实现：`http://127.0.0.1:4183/planetary?previewRole=user`，独立本地预览数据，不连接生产服务。
- 最终实屏：`output/playwright/warm-planetary-final.png`。
- 源图与实屏均为 **1487 × 1058** 像素；浏览器 CSS 视口 **1487 × 1058**，deviceScaleFactor 1，无缩放或设备外框。
- 同态：已登录演示账户、展开侧栏、选中光泽合金、8 条搜索结果、首行选中、高级筛选收起、计算器计数 0。
- 源图与对应实屏在同一个工具输出中一起打开比较，先比较全局构图，再检查可读的导航、表头、资源图、选中行和按钮区域。原始分辨率已足够辨认这些细节，无需另裁剪放大。
- 额外视口：`warm-planetary-1280.png`（1280 × 720）、`warm-planetary-1920.png`（1920 × 1080）、`warm-collapsed-1280.png`。低高度下账户入口和两个计算器按钮仍可用。保留原项目 <=1180px 桌面端提示，不声称完成移动端改版。

## 比较历史与修正

1. **第一轮（blocked）**：`warm-planetary.png`。P2：资源图受原图透明留白影响显得过小；结果区比参考低约 30px，留白偏大。修正表格字号至 15px，减少高级筛选与结果区的重复间距，扩大资源图展示。
2. **第二轮**：`warm-planetary-v2.png` 与源图同输入比较，结果标题、表格行节奏恢复。独立评审发现两个 P2：审核按钮悬停使用浅绿配白字；浅色星图浮层沿用画布亮色安等文字。分别改为深绿悬停背景、独立的浅色表面安等颜色；深色画布保持原有颜色。新增测试先失败，再修正通过。
3. **资源图补查**：评审扫描全部资源素材，发现方形 cover 对部分非光泽合金素材有轻微主体裁切。改为 64 × 40 的 contain 图框，保留完整透明素材；回归断言覆盖 object-fit 和宽度。
4. **最终比较（passed）**：`warm-planetary-final.png` 与源图同输入重新打开。资源主体完整，选中态、双操作入口、行节奏与视觉方向一致；无剩余可执行的 P0/P1/P2 视觉问题。

## 五项必检表面

| 表面 | 验收结果 |
| --- | --- |
| 字体与层级 | 沿用 Segoe UI Variable / Segoe UI / PingFang SC / Microsoft YaHei 系统字体栈，不额外加载网络字体。标题 36px、结果标题 24px、主体/表格 15px，次要标签 13–14px。数字等宽，未发现关键文案截断或重叠。AI 参考字形存在轻微栅格差异，不将其当作精确字体文件。 |
| 间距与布局 | 固定 240px 侧栏，折叠后 76px；同一主内容对齐线；筛选、结果标题、表格层次清晰。按钮 48px 高，数据行 58px。1280px 与 1920px 检查无页面级横向溢出，长表保留内部滚动。 |
| 颜色与状态 | 暖白 #faf9f6、侧栏 #f0efeb、炭黑 #242422、陶土 #a6533e；表面和弹窗白色。语义状态使用深色前景与浅底。六档安等文字对白底对比度测试 >=4.5；审核悬停修正；焦点、禁用、选中状态可辨认。 |
| 图像与图标 | 复用原有透明兔子头像，通过 brightness(0) 呈现黑色，无新增底色/边框。资源使用现有 PNG，contain 保留全图；导航和操作使用项目现有 Lucide 图标，未绘制替代 logo 或伪造资源素材。 |
| 文案与内容 | 不出现“工作空间”。保留多选说明、上级依赖提示、星系安等及真实格式化值，不为追求参考像素一致而删除业务信息。所有示例内容来自本地演示数据，非客户生产记录。 |

## 全站与交互检查

- `warm-calculator-final.png`：添加资源，编辑阵列数 5、时长 72、单价 4800，产量与总价即时更新；表头排序、批量设置、方案行为由原回归用例覆盖。
- `warm-feedback.png`、`warm-feedback-detail.png`：保留提交/列表左右布局；详情、图片与文件入口、回复和管理状态与主题一致。文件上传业务未改动，由已有上传/权限用例验证。
- `warm-starmap-selected.png`：搜索“夫斯”并定位，保留深色画布与可读浅色详情卡；起终点与路径计算由回归用例覆盖。
- `warm-fraudlist.png`、`warm-usersetting.png`、`warm-fraudadmin.png`、`warm-licenseadmin.png`、`warm-infocenter.png`、`warm-login.png`、`warm-fraudlogin.png`：已打开检查，包括空态、表单、管理数据和登录入口。
- 独立代码评审确认两项 P2 修复，无剩余业务功能阻塞；其资源图 P3 建议也已处理。
- 浏览器日志无 console error；有 React DevTools 提示、主动启用减少动画的开发提示、原有密码 autocomplete 建议。早期登录截屏处于入场动画中，已等待不透明状态后重新截图，不将加载中的画面作为成品证据。

## 有意保留与测试边界

- 仅行星资源页有选定的完整视觉稿，其他页面应用共享视觉系统，未擅自重构反馈业务或新增页面。
- 参考图简化了星系安等、依赖筛选说明和备案页脚；实现保留全部业务字段和独立文档流页脚。备案号与链接仍存在，较长页面需要滚动到底部。
- 参考侧栏约 249px，实施采用 240px；少量字体、按钮宽度和图标光学尺寸差异为 P3，不影响层级或任务完成。
- 验证基于本地 Chromium 与模拟 API，不代表已做生产服务器、真实短信/邮件、真实上传存储或全部浏览器兼容性验收。

## 完成清单

- 最终验证：`npm run test:e2e -- --workers=4` **118 passed (1.6m)**；`npm run build` 成功。均在最后的 contain 图框修正后重新执行。

- [x] 同视口同状态比较与迭代
- [x] 五项视觉表面检查
- [x] 黑色透明头像、客户措辞、折叠导航
- [x] 唯一双计算器入口、高级筛选与原业务保留
- [x] 全站页面和主要状态检查
- [x] 独立评审问题修复
- [x] 本地预览保留，不合并、不推送、不部署
