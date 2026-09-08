# 深空控制台 UI — 完整验收

日期：2026-09-08。范围：front-codex 的全部现有页面、计算器及主要弹窗；仅本地独立分支，不是生产发布批准。

## 视觉依据与比较

- Source visual truth: `docs/design/dark-console-reference.png`，1487 × 1058 px，用户选择的方案 2。
- Implementation: `docs/design/full-planetary-final.png`，1477 × 1051 px。
- Viewport: 请求 CSS 1487 × 1058；内置浏览器导出轻微缩放截图。原图与实现图在同一个工具输入中共同打开，按各自完整内容框比较；未声称逐像素相等。
- State: 深色、已登录演示身份、光泽合金结果、前 3 行选中。源图的总结果数 56 / 计算器 102 为示意值，实现为 8 / 0；没有为了匹配示意数字而修改业务数据。
- Full-view evidence: 对比确认左侧导航、紧凑四筛选区、密集结果表及右下方青色主操作的层级一致。
- Focused region evidence: 同一组原始尺寸图片中分别检查筛选字段、前三行图标/数字/安等、底部主按钮；这些区域文字在原图中可辨识，未另外生成裁剪文件。再以 DOM/CSS 回归核对 58px 行高、48px 主按钮、主题色和键盘焦点。

有意保留的差异：真实品牌图片加浅底以保持可见；沿用 Lucide 图标及真实资源 PNG；保留已有表内五项过滤和所有可排序列，因此比示意图多一行过滤区，页脚可在页面末尾滚动访问；不实现示意图中不存在于业务的“相关度排序”。字号与图片尺寸按用户授权调整，不改业务含义。

## Findings / 迭代记录

1. 阶段 1：品牌在深底上不清晰，已增加浅底；业务区仍为浅色，当时 full redesign 结果为 blocked。现在所有现有页面已迁移，阶段阻塞解除。
2. [P2，已修复] 第一轮 `full-planetary.png` 中通用样式将行高撑到 68px，首屏仅约六行。增加特定表格规则并移除图标行内基线空隙；`full-planetary-final.png` 显示八行，自动化确认 58px。
3. [P2，已修复] 错误输入框边框与普通输入相同、保存/审核按钮 hover 变灰。恢复红色错误边框与对应强调色；`full-review-validation.png` 及自动化颜色断言验证。
4. [P2，已修复] 键盘离开多选筛选仍保持展开。焦点离开时关闭，Escape 关闭并返回 summary；先红后绿测试通过。
5. [P2，已修复] 授权页面板没有间距，操作列需横向滚动；初次固定后末按钮仍有裁切。增加 18px stack 间距、360px 固定操作列；`full-license-1280.png` 显示全部四项动作，1280/1440/1920 的每个按钮边界断言通过。
6. [P2，已修复] 三列价格表沿用 840px 最小宽度，产生无谓横滚。仅价格表改为 min-width:0；`full-prices-final.png` 复查无横滚。
7. [P1，已修复] 全量回归暴露星图原有偶发白屏：rAF 首帧时间早于启动时刻，进度为负，Canvas arc 收到负半径。三处进度限制到 0～1。确定性早到帧用例先失败后通过；`full-starmap-located.png` 确认正常定位和信息卡。正常目标缩放、路径公式及图节点不变。

## 五项设计检查

- Fonts / typography：系统中文无衬线字体；正文 14px、页标题 28–32px、分区 20px、弹窗标题约 28px。数字等宽；字段、表头和长名称没有互相覆盖，必要处省略/滚动保留全文入口。
- Spacing / layout：固定侧栏、28px 工作区边距、统一 7–10px 圆角与紧凑间距。大表独立滚动，计算器在较窄桌面重排方案/批量输入；1280 宽完整数值表仍允许横滚访问末列。
- Colors / tokens：背景 #0b1117、面板 #131c24、文字 #e7eef5、次级文字 #a7b7c5、主色 #18bfdc、按钮文字 #07151d；错误/成功/警告保留语义。星图底色统一，安等及路线颜色不变。
- Images / icons：真实品牌及资源图片保留，资源图框 44px、contain 不拉伸；没有生成替代业务图片或 CSS 伪图。图标延续同一线性图标家族。
- Copy / content：保留真实功能与字段，移除“恢复”“接口已接回”等开发过程文案。备案号和工信部链接保持不变。

## 逐页证据

全部位于 `docs/design/`：

- 行星资源：`full-planetary-final.png`，`full-planetary-1440.png`（1430×1017），`full-planetary-1920.png`（1910×1074）。
- 计算器：`full-calculator.png`、`full-calculator-1280.png`。
- 防诈查询/举报：`full-fraud.png`、`full-report.png`。
- 设置/价格：`full-settings.png`、`full-prices-final.png`。
- 管理员/审批/授权：`full-admin.png`、`full-review-validation.png`、`full-license-1280.png`、`full-permissions.png`。
- 登录/注册/管理登录：`full-login.png`、`full-register.png`、`full-admin-login.png`。
- 星图/信息：`full-starmap.png`、`full-starmap-located.png`、`full-info.png`。

## 验证与边界

- 最终全量：`npm run test:e2e -- --workers=4 --reporter=list`，98 passed，54.3s。
- 最终构建：`npm run build`，成功，19.85s。没有推送或发布 dist。
- 九个路由补充 console.error / pageerror 检查通过；星图早到帧测试同时检查页面异常。
- 回归覆盖鉴权、注册/找回密码、管理员操作、筛选级联、排序、计算器批量编辑/去重、方案保存与持久、价格、路径与备案。
- 独立代码复审两轮及动画修复专项复审：未发现剩余 P0/P1/P2。
- 预览在 127.0.0.1:4182 使用内存假数据，未知 API 操作返回 404，不转发线上；仅用于外观和交互演示。
- 未进行生产数据联调、真实邮件/上传/授权操作或 Safari/Firefox 验证。不承诺绝对零回归。
- 保留原有 <=1180px 桌面使用提示，不新增手机业务适配。系统字体在不同设备存在正常字形差异。

## Implementation checklist

- [x] 所有现有页面和主要弹窗统一
- [x] 醒目的加入计算器按钮与选中计数
- [x] 字号、图标、图片、间距统一
- [x] 交互回归、代码复审与视觉复查
- [x] 本地预览与隔离分支保留
- [x] 不合并、不推送、不 SSH、不部署

final result: passed
