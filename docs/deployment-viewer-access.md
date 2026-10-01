# 生产查看权限

当前生产发布默认只允许 `2235102484@qq.com` 登录和查看市场、制造及其他站内页面。

后端门禁使用以下环境变量：

```dotenv
VIEWER_ALLOWLIST_ENABLED=true
VIEWER_EMAIL_ALLOWLIST=2235102484@qq.com
```

前端生产构建会使用同一默认账号，也可以显式设置：

```dotenv
VITE_VIEWER_ALLOWLIST_ENABLED=true
VITE_VIEWER_ALLOWLIST_EMAILS=2235102484@qq.com
```

以后完全开放时，同时重新构建前端并设置：

```dotenv
VIEWER_ALLOWLIST_ENABLED=false
VITE_VIEWER_ALLOWLIST_ENABLED=false
```

后端开关是实际数据门禁，前端开关只负责路由体验；两边应一起切换。允许多个账号时，用逗号分隔邮箱。不要把生产密钥或真实 `.env` 文件提交到仓库。
