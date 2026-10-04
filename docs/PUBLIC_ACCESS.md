# 公共只读访问与账号运维

本次授权范围是普通页面供游客只读浏览，正常邮箱可以申请验证码、注册和登录。登录不自动授予 staff、superuser、用户组、模型权限、KM owner、usage owner 或战术组织成员身份。管理页面、个人数据、私人附件和协作资源继续执行各模块原有身份与资源权限。

路由调查基线为 `1e4da99f6f7d17c2c45348c91b26a1a1001d60cc`，树 `57599c5693db2f77973ca9b7ff0b6e3964b22991`：116 个现有 HTTP 路由、36 个前端路径及 1 个战术 WebSocket。新增默认行星价格接口后是 117 个 HTTP 路由。以下为目标访问契约，测试及生产结果必须绑定随后冻结的实际提交，不能以基线的 CI 代替。

## 开关与兼容配置

| 配置 | 默认值 | 含义 |
|---|---|---|
| `PUBLIC_READ_ACCESS_ENABLED` | `true` | 后端允许下列精确路径和方法的匿名业务读取。 |
| `VITE_PUBLIC_READ_ACCESS_ENABLED` | `true` | 前端允许游客进入普通工具和已发布内容页面；改变值需重新构建前端。 |
| `VIEWER_EMAIL_ALLOWLIST` | 保留既有配置 | 仅保留旧 `/api/uploadimage/` 上传接口的账号限制，不再定义全站注册或查看资格。 |

只有 `1`、`true`、`yes`、`on`（忽略大小写及首尾空白）开启新公共只读开关。后端关闭该开关时，普通业务读取要求有效、活跃 DB 用户的 JWT；正常认证入口、既有激活码校验入口和健康探针仍按各自契约工作。前端开关只控制页面体验，不能授予 API 或资源权限。

旧 `VIEWER_PUBLIC_ACCESS_ENABLED`、`VIEWER_ALLOWLIST_ENABLED`、`VITE_VIEWER_PUBLIC_ACCESS_ENABLED`、`VITE_VIEWER_ALLOWLIST_ENABLED` 与前端邮箱名单已退出全站门禁判定。无论旧配置取何值，都不能跳过私有 API、owner、staff、组织成员或资源归属校验。不要通过修改旧开关来恢复匿名写入。不要把真实环境文件、密钥、账号名单或私人证据下载链接提交到仓库。

## 公开业务读取：28 个 GET 契约

`Authentication/viewer_access.py` 使用精确静态路径或完整匹配的数字 ID 路径；不是按整个命名空间开放。对应 GET 支持 HEAD。OPTIONS 仅允许预检进入后续处理，不授予数据读取或写入权限。斜杠以表中路径为准。

| 模块 | GET 路径 | 可见数据 |
|---|---|---|
| 集市 | `/api/bazaarinfo`、`/api/bazaarnamelist`、`/api/bazaarbox` | 游戏排名、分数与集市资料。 |
| 军团目录 | `/api/community/corporations/`、`/api/community/corporations/<id>/`、`/api/community/corporations/<id>/media/<asset_id>/` | 仅上架且已批准的发布版本，以及该发布版本实际引用的 logo/cover。 |
| 游戏目录 | `/api/game-data/items/`、`/api/game-data/items/<id>/`、`/api/game-data/status/` | 游戏条目、配方及目录版本信息。 |
| 市场 | `/api/market/categories/`、`/api/market/items/`、`/api/market/items/<id>/series/`、`/api/market/items/<id>/history/` | 已启用商品的公共行情投影。管理配置、采集日志和任务控制不在此范围。 |
| 行星与地点 | `/api/planetresources`、`/api/planetresourceprice/default`、`/api/regions`、`/api/constellations`、`/api/solarsystem` | 游戏资源、默认价格和静态地点。默认价格接口无尾斜杠，只读取默认价格表，不读取个人价格。 |
| 星海 | `/api/starsea/posts/`、`/api/starsea/posts/<id>/`、`/api/starsea/media/<id>/`、`/api/starsea/ships/`、`/api/starsea/locations/`、`/api/starsea/corporations/` | 仅上架且已批准的内容及公共目录。媒体只向游客提供发布版本实际引用的图片。 |
| 星图 | `/api/boardsystems`、`/api/boardconstellations`、`/api/boardstargate`、`/api/boardregions` | 静态游戏星图，包含原有公开范围过滤。 |

星海媒体同一 URL 还可能服务作者或 staff 的草稿图片；其对象权限、`private, no-store` 与 `Vary: Authorization` 保持有效。不得把命中公开路径理解为任意附件 ID 都公开。军团的草稿、认领申请、联系方式和私有媒体不属于公开目录；战术成员名单也不属于军团目录投影。

## 5 个只读 POST 查询例外

| POST 路径 | 用途 |
|---|---|
| `/api/searchplanetresource` | 查询游戏行星资源。 |
| `/api/fraudsearch` | 查询既有公开防诈记录；不返回私人举报联系方式、证据或管理员操作日志。 |
| `/api/bazaardate` | 查询集市历史日期。 |
| `/api/bazaarchart` | 查询游戏历史分数曲线。 |
| `/api/jumppath` | 计算游戏星图路线。 |

这些 handler 不修改用户业务资源。保留现有请求验证、数据范围、缓存和计算/采集预算；不得扩大为所有 POST 或整个 `/api/` 匿名开放。旧集市曲线本身已有 `throttle_classes=[]`，公共读取模式不意味着新增无限请求保证，也不改变游戏客户端采集预算。

## 认证、验证码与私有权限

匿名账号入口是 `/api/user/login`、`register`、`emailcode`、`signupcheck`、`forgetemailcheck`、`forgetPassword` 和 `token/refresh` 的明确 POST 路径。刷新必须提供有效 refresh token；修改密码 `/api/user/changepwd` 仍要求认证。普通邮箱不再因全站 viewer 邮箱名单被拒绝，邮箱格式、重复账号、密码、验证码和活跃账号检查继续有效。

验证码有效期为 600 秒，年龄达到 600 秒即过期。成功注册或重置密码在事务锁内一次消费验证码。生产发送预算与账号入口预算如下；返回 429 时客户端应尊重 `Retry-After`：

| 入口 / 维度 | 预算 |
|---|---|
| 验证码，单邮箱 | 1 次/分钟、5 次/天；邮箱大小写归一，保留原预算键命名。 |
| 验证码，传输 IP | 60 次/小时、200 次/天。 |
| 账号预检查，IP | 300 次/分钟。 |
| 登录，IP / 邮箱 | 60 次/分钟 / 10 次/分钟。 |
| 注册或密码重置，IP / 邮箱 | 30 次/分钟 / 5 次/分钟。 |
| refresh，IP | 120 次/分钟。 |
| 已认证修改密码，IP | 30 次/分钟。 |

IP 身份仅取连接的 `REMOTE_ADDR`，不信任客户端 `X-Forwarded-For`。当前没有已验证的可信代理来源契约，因此不能把自报 XFF 用于放宽预算。反向代理后的用户可能共享传输 IP 预算；这些限制沿用现有 Django cache 范围，没有新增分布式共享 cache 配置。不要宣称它们已在所有进程或主机之间共享。测试使用隔离 cache、数据库和邮件 mock，不向生产 SMTP 发信。

| 私有范围 | 保留的权限 |
|---|---|
| `/api/planetresourceprice`、`/api/programme` | JWT；个人价格及方案只按当前用户查询/修改。游客默认价格使用新接口，不把原混合接口改为 AllowAny。 |
| Feedback、举报与个人记录 | JWT；当前作者资源过滤、staff 全量查看与附件归属检查。 |
| Community / Starsea 管理、草稿、审核、私有媒体 | JWT 加作者/owner/staff 与对象权限；公开读取不新增审核或编辑资格。 |
| Market / License / ActivationCode 管理 | 既有 staff、模型权限或独立授权检查。 |
| Fraud 管理 | 既有授权用户组；PATCH 同时要求源记录组和目标组权限。只允许更新 `fraud_account`、`account_type`、`remark`、`fraud_type`；分组名称及图标从已授权目标组取得，客户端不能改 `id` 等任意模型属性。 |
| KM 与 collector | JWT 加 `KILLBOARD_OWNER_EMAIL` 对应的唯一活跃 DB owner；staff 身份不单独授予 KM。 |
| 战术 usage | JWT 加既有唯一活跃 usage owner；与 KM owner 是不同判定。 |
| 战术组织、roster、board、commands、presence、snapshot | JWT、活跃成员/角色、board 范围、lease 等既有校验。成员名单要求 founder/commander，普通 scout 不因此获得 roster。 |
| `/ws/tactical/<organization_id>/` | origin、JWT、活跃成员、角色投影、board、lease/socket generation、到期及撤权检查。接受预认证连接不等于允许发送状态。 |
| `/admin/` | 原 Django staff/session 权限。 |

旧 `/api/uploadimage/` 使用 MIME 与原扩展名保存文件，其媒体安全不作为本次新开放能力。它仍需要有效、活跃用户 JWT 和实际 `VIEWER_EMAIL_ALLOWLIST` 成员资格；名单为空时全部拒绝。新公共只读开关和旧公开开关都不能解锁此上传入口。私人 Feedback/Starsea 附件继续采用自己的存储及对象授权，不能与旧静态证据上传混为一谈。

既有 `/api/activationcode/validate-code/`、`/api/license/validate-code/` 保留独立激活码和机器标识授权。它们可能影响绑定状态，不属于新授予游客的普通业务写入。既有 `/api/deploy-version/`、`/api/community/ready/` 健康 GET/HEAD 保持公开。

## 验证、发布与恢复

前端身份切换时取消在途查询、清理共享查询和 mutation 缓存，并重建页面状态。退出、重新登录和其他标签页的 storage 事件都执行此边界，避免下一账号复用前一账号的私人价格、方案或管理缓存。同一用户正常 access/refresh token 轮换保持稳定身份，不重建页面；客户端身份只用于缓存隔离，不能替代后端 JWT 与资源授权。不同账号的 token 对在更新完成前暂按访客处理。登录与注册响应只有在提交时的会话仍一致且页面仍挂载时才能写入凭据，迟到响应不能覆盖另一标签页的新会话。

1. 冻结源码提交并独立审查。按 `.github/workflows/ci.yml` 执行完整检查，包含账号/公共读取/私有拒绝测试、Fraud 源/目标组和字段白名单、原 backend 权限回归、MySQL、前端 unit/preview、build/bundle budget、完整主 E2E、独立 preview 与 tactical E2E。不要削弱断言、跳过失败项或用旧提交结果证明候选代码。
2. 核对精确候选 head/tree、CI 最终 job/step 状态、实际数量与 retries、release artifact 元数据。对下载产物验证 manifest、frontend/backend tree 和全部文件摘要；记录编译首页/资源的真实 hash。截图或本地 fixture 不能替代 backend 授权测试。
3. 确认没有正在进行或排队的 Production publisher，再按审过且 CI 完整通过的 expected head 正常合并。master push 使用既有 `.github/workflows/deploy.yml`：`verify` 完成后才 `publish`，`evem-production` 串行锁及服务器锁保持不变。仅 verify 成功不能宣称已发布。
4. 保持既有非 root publisher、15 分钟发布超时、包校验、健康检查和自动失败恢复。不得并发手动发布、改安全敏感 chown/chmod、绕过保护，或以 root 发布导致 metadata owner 改变。
5. 发布后核实际版本、HTTPS GET、编译资源摘要与真实浏览器匿名关键页面；私有 API/WS 保持拒绝。公开 `boardregions` 返回 200 是正常预期，使用原 publisher 支持的健康判断，不以开放私人数据来满足健康探针。真实注册/验证码发信验证必须使用明确获准的测试账号及接收方，不能用公共 QA 任意向第三方邮箱发信。
6. 失败时由发布负责人按既有 Production `rollback` 流程恢复上次成功版本；不回滚数据库，不改服务器权限。关闭新只读开关只会收紧游客业务读取，不能代替恢复旧代码或恢复旧邮箱注册门禁。前端配置变更需要重建并发布。

此文档记录契约和检查流程，不包含本次尚未产生的远端 CI、artifact 或上线成功结论。运行号、提交、最终检查数量、实际生产版本和回滚结果应写入后续绑定该候选版本的证据记录。
