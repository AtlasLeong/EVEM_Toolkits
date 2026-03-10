# Front Codex 自动化测试说明

## 1. 当前状态

- 测试框架：`Playwright`
- 用例位置：`front-codex/tests/e2e/specs`
- 当前用例总数：`69`
- 最近一次执行结果：`69 passed`
- 浏览器项目：`chromium`

这套自动化主要验证：前端页面流程、鉴权守卫、表单校验、按钮状态、接口请求结构、计算器 / programme / 管理员审批等核心业务流。

注意：大多数 E2E 用例通过 `tests/e2e/helpers/api.js` mock `**/api/**`，所以它验证的是前端逻辑和请求契约，不是完整的真实 `evemtk.com` 后端联调。

## 2. 启动步骤

### 安装依赖

```powershell
cd d:\Code\EVEM_Toolkits\front-codex
npm install
npx playwright install
```

### 运行全部自动化

```powershell
cd d:\Code\EVEM_Toolkits\front-codex
npm run test:e2e
```

### 有界面运行

```powershell
cd d:\Code\EVEM_Toolkits\front-codex
npm run test:e2e:headed
```

### Playwright UI 模式

```powershell
cd d:\Code\EVEM_Toolkits\front-codex
npm run test:e2e:ui
```

### 查看 HTML 报告

```powershell
cd d:\Code\EVEM_Toolkits\front-codex
npx playwright show-report
```

### 只跑单个 spec

```powershell
cd d:\Code\EVEM_Toolkits\front-codex
npx playwright test tests/e2e/specs/fraudlist.spec.js
```

## 3. 如何解读测试结果

- `69 passed`：表示当前已覆盖的前端功能流全部通过。
- `1 failed` 或更多：至少有一个已覆盖业务流失败。
- 失败时重点查看：`playwright-report/`、`test-results/`、控制台日志、screenshot、video、trace。
- 如果出现 `Unhandled API route`，通常意味着页面新增了接口调用，但 spec 里的 mock 还没补。

## 4. 已自动化覆盖的 Test Checklist 部分

下面这些一般可以优先跳过手测，至少不需要再做全量功能回归：

- `3. P0 冒烟测试`：`npm run build`、登录后用户名显示、退出、Logo 返回 `/fraudlist`、导航高亮。
- `4. 登录与鉴权`：登录成功 / 失败、注册验证码发送成功 / 失败、注册成功、注册错误验证码、重复用户名 / 邮箱、密码格式错误、两次密码不一致、找回密码发码成功 / 失败、重置成功、重置错码、`/login` / `/usersetting` / `/fraudadmin` 守卫。
- `5. 防诈名单`：空输入提示、命中查询、未命中空态、回车查询、排序、访客态隐藏举报和记录、登录态举报提交、无图不可提交、超过 5 张拦截、非法文件类型、上传失败、移除已上传图片、token refresh 成功 / 失败回退。
- `6. 行星资源`：取消上级清空下级、资源搜索过滤、只选地点不选资源、只选资源不选地点、全空提示、结果全选 / 取消全选、加入计算器、预设价格加载成功 / 失败、批量复制阵列数量 / 时长 / 单价、访客态提示登录、programme 保存 / 加载 / 更新 / 删除、关闭重开后保留当前方案、等级筛选。
- `7. 星系导航`：英文 / 别名搜索下拉、定位到星系、手动输入起终点计算路径、缺少起终点拦截、直线距离显示、路径表格和分段预览、重置视图。
- `8. 用户设置`：新密码不一致校验、修改密码成功、预设价格保存成功。
- `9. 诈骗管理员登录`：管理员登录成功 / 失败、普通登录态访问后台的权限拦截。
- `10. 管理员后台`：新增、必填校验、编辑、删除、行为流水、前后版本对比、审批列表、通过举报、驳回举报。
- `11. 顶栏与导航`：Logo 返回首页、登录后用户名显示、退出清掉 session、当前导航高亮。

## 5. 仍建议手测的部分

- 所有视觉、动画、hover、排版、favicon 相关项。
- 星图拖拽、缩放、定位的顺滑度和观感。
- 真实 `evemtk.com` 后端联调。
- 浏览器控制台稳定性，包括 JS 报错和 warning。
- `TEST_CHECKLIST.md` 里那些明确标为视觉 / 动画 / 布局 / 控制台 / 真实联调的条目。

## 6. 建议的使用方式

- 如果目标是先验证功能正确性：先跑 `npm run test:e2e`，再按 `TEST_CHECKLIST.md` 剩余手测项执行。
- 如果目标是上线前回归：自动化作为第一层筛查，但 `TEST_CHECKLIST.md` 仍建议全走一遍，只是可以把已覆盖部分降级为抽查。
- 如果你想逐项看哪些可以直接跳过，直接看：
  - [TEST_CHECKLIST_MATRIX.md](d:/Code/EVEM_Toolkits/front-codex/TEST_CHECKLIST_MATRIX.md)
