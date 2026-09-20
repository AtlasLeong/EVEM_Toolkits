# 军团默认封面与本地沙盒验收记录

## 范围

- 工作分支：`codex/community-corp`，实现基线 `4528195`。
- 仅本地实现与演示，没有合并、推送、部署或修改线上 MySQL。
- 四款新横图：舰队、行星、船坞、星云。1920 × 640 正图与 600 × 200 缩略图；共约 764 KiB。
- 图片由内置 imagegen 独立生成，精确提示词、原始文件及压缩参数在 `front-codex/src/assets/corporations/covers/provenance.md`。
- 缺省封面按军团 ID 稳定选择，自定义图片成功加载后优先；加载失败回退。原八款竖版海报背景保留。
- 三种海报移除顶部平台英文和已审核底注，军团内容、联系方式及未审核提示保留。

## 本地试用

入口：`http://127.0.0.1:4190/corporations`。

顶部工具条提供管理员、审核员、游客三种本地身份，不需要真实账号或密码。可直接编辑远航者军团，也可测试创建申请 → 审核归属 → 编辑/上传/保存/提交 → 审核发布 → 公开主页/导出海报。

刷新保留当前进程内的数据，重启服务后重置；这不是连接线上账号和数据库的后门。演示驻地数据仅为样本。完整命令及限制见 `front-codex/tests/preview/README.md`。

## 已执行验证

- 封面与海报专项浏览器回归：14/14，通过全部 8 背景 × 3 模板 PNG 导出。
- 单元、业务合同与实际 HTTP 测试：32/32。
- `npm run build`：通过；有约 501 kB 主 JavaScript chunk 的体积提示。
- `git diff --check`：通过。
- 构建产物未包含 `_preview/session`、本地身份工具条或预览中间件。
- 封面及海报已分别完成规格审查与独立质量审查；沙盒业务规格修后通过。

## 审查中发现的问题与处理

- 列表接口带查询参数，封面测试的尾斜杠路由未命中：按 pathname 精确匹配，未为测试修改生产组件。
- 本地上传原先仅检查文件头：现使用仅开发依赖 Sharp 真正解码，执行 5 MiB / 20M 像素 / 单帧 / 后缀格式校验、方向纠正、2400 内缩放、去元数据 WebP 重编码。
- APNG 独立默认图未被 Sharp 帧数统计计入：补容器帧数检查，拒绝默认图加动画帧的反例，保留真正单帧 APNG。
- 新封面组件包含隐藏的默认图和已加载上传图：实际 UI 测试定位到可见上传图，并验证 custom 状态。
- 本地工具条覆盖固定侧栏品牌区：预览专用布局在桌面避让 240px / 折叠 76px，登录页和手机全宽；真实矩形回归由 RED 到 GREEN，不改变生产界面。
- 原应用退出后工具条身份标签滞后：监听认证变更、跨标签存储变化及令牌过期；真实退出和跨标签退出回归由 RED 到 GREEN。
- 新版草稿重新挂载后的 textarea 带初始子文本，Playwright 精确 label 匹配不再命中：trace 证实创建返回 201、字段可用、内容正确，改用 textbox 的真实可访问名称定位并核验保留内容，没有修改业务 DOM 或放宽等待。

Sharp 与生产 Pillow 不是同一个编解码器，本地沙盒不能替代生产后端的限额、事务、持久化与上传测试。

## 最终集成

- 全站浏览器回归：`VITE_API_URL=/api npx playwright test --workers=1 --output=output/corp-covers-full-e2e`，**188/188 通过**。
- 实际本地服务浏览器回归：`npx playwright test --config tests/preview-e2e/playwright.config.js --output=output/preview-sandbox-verified-tests`，**4/4 通过**。覆盖创建、两阶段审核、编辑上传、刷新、撤回/新版、发布、游客读图、海报下载、普通用户无法审核、无外网请求、手机入口和工具条同步。
- 沙盒完成独立规格审查和质量审查，已修复全部已报告问题；角色标签真实脚本的退出、存储变化、过期及错误令牌类型也经独立 VM 检查。
- 最终截图已人工检查：`front-codex/output/corp-sandbox-toolbar-desktop.png`、`corp-sandbox-toolbar-mobile.png`、`corp-redesign-detail-desktop.png` 和 `corp-redesign-poster-desktop.png`。
- 一次早期全站回归受同时安装开发依赖影响而中断，安装完成后完整重跑得到上述 188/188；没有跳过或接受失败测试。
- 图片处理新增的 Sharp 仅为开发依赖，不进入生产前端包；锁文件未升级其他已有依赖。
