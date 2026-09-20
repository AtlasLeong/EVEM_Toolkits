# 军团页面三批需求：实现与验收记录

日期：2026-09-20。范围限定为 `codex/community-corp` 本地分支；未推送、合并、部署或修改生产数据库。

## 已实现范围

1. **页面布局与分享**：收紧发现页导航后留白，统一可搜索的星域、活动方向、招募状态选择器；详情页合并身份、标签与操作区；公开主页提供分享链接、复制失败回退和本地链接提示。未上架军团不提供公开分享入口。
2. **独立海报工作台**：详情页、管理页和审核页均使用独立弹窗，手机全屏，不再挤压正文。保留招募、介绍、活动三种内容模板；新增八款独立生成的宇宙场景，并移除旧六款可选背景。支持 1080 × 1440 PNG 导出、加载失败重试、快速切换取消保护、未审核标记、键盘焦点管理。
3. **关联驻地**：星域 → 星座 → 星系三级联动，允许只选部分层级，上级改变立即清除下级；后端校验真实目录关系并生成名称/安等快照。兼容旧文字驻地，不需要数据库结构迁移。

## 设计与素材

按用户指定的 taste-skill 项目内审美优化思路，保留现有暖白、炭黑和克制强调色，重点调整信息层级、空白、对齐、响应式与异常状态；不引入新 UI 框架或字体依赖。

八款背景分别为：远征舰队、星环巨行星、旋臂星河、轨道船坞、黑洞视界、创生星云、冰封边境、战舰残骸。每款由内置 image_gen 独立生成，保存于 `front-codex/src/assets/corporations/posters/`，完整提示词及源文件记录见该目录 `provenance.md`。1080 × 1440 原图合计约 1.81 MB，缩略图约 76 KB；按选中项加载大图。

## 审查与验证

- 后端需求审查、后端质量审查、前端需求审查、前端质量审查均通过；独立审查未发现需阻断交付的 P1/P2 问题。
- 后端 136 项测试通过：`python manage.py test Community Feedback License ActivationCode TacticalBoard EVE_MDjango.tests_deployment --settings=EVE_MDjango.ci_settings --noinput`。
- 迁移检查通过：`python manage.py makemigrations Community Feedback --check --dry-run --settings=EVE_MDjango.ci_settings`，无结构变更。
- 前端海报单元测试 8 项通过：`node --test tests/unit/*.test.mjs`。
- `npm run build` 通过；主入口约 501 KB 的既有分块体积警告仍存在，不影响构建，本次不扩展为全站打包重构。
- 前端全量 Chromium 浏览器回归 **180/180 通过（8.3 分钟）**：`VITE_API_URL=/api npx playwright test --workers=1 --output=output/redesign-final-tests`，包含 8 款背景 × 3 种模板共 24 组不同 PNG 的文件签名、尺寸与导出验证。
- 已实际检查桌面、820 px 平板、390 px 手机界面，独立弹窗不会压缩正文；平板导出入口固定可见，手机无横向溢出。
- 回归中复现并修复“重复点当前背景/模板后无法导出”的状态失效问题，另补快速切换和 Tab 焦点环绕用例。
- 第一轮全量回归 176/177 通过，唯一失败为旧背景名称断言；该测试在运行期间已更新为新名称。最终稳定代码重跑全部通过，并纳入追加的三项边界用例。

## 本地体验与边界

- 本地预览：`http://127.0.0.1:4190/corporations`。
- 示例详情：`http://127.0.0.1:4190/corporations/1`。
- 示例管理：`http://127.0.0.1:4190/corporations/manage?id=1`。
- 预览使用测试资料与模拟接口，不连接或更新线上业务；分享出的本地地址仅本机可用。真实目录的后端关系校验已通过隔离测试验证。
- 当前浏览器自动化基于 Chromium；尚未进行 Safari/Firefox 实机验收。
- 不包含星海见闻、战报编辑、装配模拟器等后续模块。

## 截图

截图保留于本地 `front-codex/output/`，不加入代码提交：

- `corp-redesign-detail-desktop.png`
- `corp-redesign-poster-desktop.png`
- `corp-redesign-poster-mobile.png`
