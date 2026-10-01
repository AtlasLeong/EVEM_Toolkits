# 生产查看权限

当前生产发布默认只允许 `2235102484@qq.com` 登录和查看市场、制造及其他站内页面。

后端门禁使用以下环境变量：

```dotenv
VIEWER_EMAIL_ALLOWLIST=2235102484@qq.com
VIEWER_PUBLIC_ACCESS_ENABLED=false
DEBUG=False
```

前端生产构建会使用同一默认账号，也可以显式设置：

```dotenv
VITE_VIEWER_ALLOWLIST_EMAILS=2235102484@qq.com
VITE_VIEWER_PUBLIC_ACCESS_ENABLED=false
```

以后完全开放时，同时重新构建前端并设置：

```dotenv
VIEWER_PUBLIC_ACCESS_ENABLED=true
VITE_VIEWER_PUBLIC_ACCESS_ENABLED=true
```

后端门禁默认开启；旧的 `VIEWER_ALLOWLIST_ENABLED` 或 `VITE_VIEWER_ALLOWLIST_ENABLED` 配置不会自动解锁。后端的 `VIEWER_PUBLIC_ACCESS_ENABLED=true` 是实际数据门禁，前端同名变量只负责路由体验；两边应一起切换。允许多个账号时，用逗号分隔邮箱。不要把生产密钥或真实 `.env` 文件提交到仓库。

门禁覆盖站内页面、动态业务 API 和战术 WebSocket；公开游戏配方 JSON、图标与构建资源不是保密数据。Django 管理后台继续采用原有 staff 权限。

发布前须先备份并升级服务器 root 管理的 `release.py`：支持门禁的候选版本可将匿名数据探针的精确 `401 + WWW-Authenticate: Bearer` 响应视为预期结果，仍必须通过版本、数据库/存储 readiness、服务、资源和 WebSocket 健康检查。旧版本的探针继续要求 200；不得用放开业务 API 来绕过发布检查。
