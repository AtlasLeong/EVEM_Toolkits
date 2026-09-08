# 隔离的 UI 演示

在 front-codex 执行 `npm run preview:ui`，打开 http://127.0.0.1:4182/planetary?previewRole=user 。

- 本进程只监听本机，使用内存假数据，不访问生产 API。
- `previewRole=user` / `admin` 设置演示身份；`guest` 清除演示身份。仅影响 4182 端口的 localStorage。
- 可直接访问 `/fraudlist`、`starmap`、`usersetting`、`fraudadmin`、`licenseadmin`、`infocenter`，登录页用 `previewRole=guest`。
- 资源图来自仓库 backend/static/planet-nobg。演示记录不对应真实用户。
- 演示 API 只覆盖视觉检查需要的操作；未配置操作返回明确 404，不转发生产。完整业务契约由 tests/e2e 的隔离测试验证。
- 这些脚本不导入生产入口，不进入 dist。不要将演示服务部署成生产服务。

停止后可重新执行命令；没有向服务器写入数据。
