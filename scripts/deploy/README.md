# 自动部署：实施与运行说明

## 当前状态（2026-09-08）

实现已合并并推送 master，生产账号、GitHub production Environment 与凭据已配置，服务器已切换到版本目录结构。真实发布、回滚、恢复新版均已验证；`EVEM_AUTO_DEPLOY=true` 已开启。实际证据见 [上线记录](../../docs/plans/2026-09-08-deployment-rollout-record.md)。

## 日常更新

确认代码后提交并推送 master（或将 PR 合并到 master），无需登录服务器、上传 dist 或手工重启。仅在本地改文件/commit、未推送不会上线。进度和回滚入口：[GitHub Actions → Production](https://github.com/AtlasLeong/EVEM_Toolkits/actions/workflows/deploy.yml)。需回滚时选择 Run workflow → master → action: rollback；它恢复上一成功发布，不回退数据库。

PR 运行 CI；推送 master 运行同一套 CI。只有仓库变量 `EVEM_AUTO_DEPLOY=true` 时，master 的成功检查才自动发布。未设置变量时，push 只验证，不上线。第一次通过 Actions → Production → Run workflow，在 master 上手动 publish；测试不通过就不会拿到生产凭据。rollback 入口不受当前新代码测试失败影响，但仍需 production Environment 和 master 分支。

构建机采用 GitHub Ubuntu runner、Node 22、Python 3.10。服务器沿用现有 CentOS/Python/Gunicorn，不运行 npm。

- `pack.py` 读取 Git HEAD 中的 backend 文件和刚构建的 dist，不递归复制工作目录；包含提交、组件 tree hash 和逐文件 SHA-256。
- `release.py` 校验完整清单与摘要，拒绝路径穿越、符号链接、`.env`、venv、日志和上传文件。
- 组件比较使用线上最后成功状态，不仅比较上一条提交；前端单独变更不重启后端。
- 仅文档/部署说明变更时仍验证并上传产物，但不切换业务组件、不重启服务；线上组件 SHA 保留各自最后实际发布的提交，不一定等于最新 master。
- 服务器文件锁与 GitHub concurrency 防止重叠发布，切换不主动取消。
- 后端版本接口 `/api/deploy-version/` 在进程加载时固定 SHA；前端 `/deploy-version.json` 提供对应 SHA。首页、首页引用的 assets、API、服务状态与 SHA 共同检查。
- 失败恢复 current 链接、按需重启后端，检查旧版本健康后还原状态文件；如果恢复失败，保留 `transaction.json` 并阻止后续发布，不谎报成功。
- 源码和后台版本切换之间仍有短窗口，要求前后端接口向后兼容；后端 restart 可能造成短暂中断。

## 依赖与数据库边界

v1 不自动安装生产依赖，不自动执行数据库迁移。

`shared/environments.json` 用 requirements.txt 的 SHA-256 映射到在这台 CentOS 上验证过的 venv 绝对路径。现有 4.9 GB 环境只登记复用，不能每次复制，也不能在唯一可回滚环境中 pip install。依赖变更先准备独立环境、验证、登记，再发布。

发布前用候选版本的 Python、settings 和数据库路由运行 `migration_check.py --database default/license`，读取迁移计划，忽略项目 app-level router 明确禁止在该库执行的迁移；真实未应用迁移会阻止切换。不执行 migrate、不 fake、不补记数据库记录。需要迁移时先审查、备份、验证兼容性并在维护流程中执行。代码回滚不还原数据库；迁移检查不是数据兼容性证明。若未来更改 router 为依赖 model/hints 的路由，须同步审查此检查器，不能假定 app-level 过滤仍适用。

## 军团模块发布门禁（2026-09-21，本地实现，未上线）

**以后上线前须由运维先升级 root 管理的 `/usr/local/lib/evem-deploy/release.py`，
再发布新业务版本。**CI 不会更新发布器本身；仅推送业务代码不能保证新的存储检查生效。
此次本地开发未连接生产、未升级发布器、未迁移数据库或重启服务。

- CI 新增前端 Node 单元/本地预览契约测试、独立配置的交互沙盒端到端测试、
  `scripts/community/tests` 安全测试。保留现有全量前端/后端/迁移/发布门禁和发布触发；
  不忽略失败。显式 Bash 保留管道失败状态，失败日志、两套浏览器截图和 trace 一并上传。
- 切换前用候选 backend 自己的配置执行只读 `manage.py community_preflight`。
  `COMMUNITY_UPLOAD_ROOT` 必须为已存在的绝对私有持久目录，不能位于候选源码、
  releases/current、公开上传、静态资源或 shared/assets 树。
  发布器传入实际部署根下的禁用树；Django 静态目录（包括带前缀配置）也纳入检查。
  本命令不创建目录、不改权限、不写试文件，不假定 deploy 用户就是服务用户。
- 切换重启后，`/api/community/ready/` 在真实后端服务进程内检查目录读/写/遍历权限、
  父目录遍历权限以及两次有界 Community 数据库存在性查询。成功只返回 `{"status":"ok"}`；
  失败返回通用 503，不暴露路径、凭据、SQL 或异常细节；所有响应 `no-store`。
  不扫描图片，不使用真实上传作探针。
- 发布器依据已验摘要 manifest 中的 `backend/Community/health.py` 标记记录能力；
  对含该模块的目标即使 state 没标记也强制新 readiness 检查。新接口的 404/503 是发布失败，
  不能当作兼容旧版本而跳过；仍保留原首页/资源/API/进程/精确版本 SHA 检查。
  自动恢复及手动回滚按实际目标能力检查，历史无此接口的旧版本使用原健康检查。
  预检失败不切换，运行时健康失败走既有事务回滚；恢复失败保留 journal 供人工处理。

只读权限检查不是一次成功写入的证明：它不能保证 SELinux、只读挂载、磁盘容量、
配额或之后的权限变化不会阻止上传。未知 Nginx alias 和服务账号配置仍需运维核对。
此轮 Windows 单元测试覆盖了只读检查和发布事务；Linux 专属 flock/symlink/HTTP 集成
用例在 Windows 会明确跳过，须在 Linux CI 及另行授权的实际部署演练验证，不能据此声称已上线。

## 首次初始化检查清单（供重建环境参考）

1. 本机完成 `gh auth login --hostname github.com --web`，核验仓库 `AtlasLeong/EVEM_Toolkits` 的管理权限和 Actions 可用性，不在聊天中粘贴令牌。
2. 核验服务器 ED25519 指纹 `SHA256:oVFu/exNwy532ZBJrH0xal5ep2U1Ra82sf3hHgLEwlc`；保存实际主机公钥行作为 known_hosts，不能用指纹字符串代替，也不能用未经核验的 ssh-keyscan 直接信任。
3. 备份 Nginx 配置、systemd service/drop-in、当前真实前端目录、后端受跟踪代码；检查可用磁盘、数据库备份恢复流程。不要以旧 git HEAD 推断手工上传的前端版本。
4. 创建 `evem-deploy` 和独立 CI 密钥；保留管理员原有 SSH 登录途径。只允许该账户非交互 sudo `/bin/systemctl restart evem-backend.service`，不授权任意 shell、任意 systemctl、pip 或 Git。生产凭据只授予可信维护者。
5. 将审查后的 `release.py`、`migration_check.py` 安装到 root 管理的 `/usr/local/lib/evem-deploy/`；同目录 `runtime` 链接指向已验证 Python 3.10 venv。CI 不更新发布器本身。必须以 deploy 身份用该 Python 验证线上 HTTPS（仅 curl 成功不够）：自编译 OpenSSL 的 CA 路径可能为空。生产服务器已将原本缺失的 `/usr/local/openssl/ssl/cert.pem` 链接到系统 `/etc/pki/tls/certs/ca-bundle.crt`，未禁用证书校验。
6. 创建 `/EVEMTK/deploy/{releases,incoming,shared,current}`。deploy 可写发布数据；nginx 能遍历读取 releases；bin/运行时、sudoers、Nginx/systemd 配置由 root 管理。为 deploy 与 nginx 配置持久化日志/上传目录的最小所需权限；`.env` 不公开，不能盲目递归 chmod 原项目。
7. 将当前真实文件建立一个 `legacy` baseline 快照。backend snapshot 排除 `.venv`、`.env`、uploads、logs 后分别链接到原位置，保持原始数据不移动。frontend snapshot 必须来自线上现有 dist，并将其 assets 预置到 `shared/assets`。保留旧手工包不清理。
8. 为 `current/frontend`、`current/backend` 建立 baseline 符号链接；写入 `state.json`，每个组件包含 `source`（实际 tree hash，不能确认前端时使用全零40位强制首发）、`sha`、绝对 `path`、`legacy:true`。已验证新版本不允许 legacy 标记。首次 `previous.json` 可复制 baseline 状态。登记环境哈希，配置 `config.json`（参考示例）。
9. 合并 Nginx location 示例，保留域名/TLS/API配置；应用 systemd drop-in 示例。**先完成备份、路径可读性检查和 nginx -t，才 reload/restart。**如果探测失败恢复原配置及服务。全部通过后写入 `initialized.json`（记录操作时间和 baseline）；不要提前放一个空标记绕过初始化。
10. 在 GitHub production Environment 配置 `EVEM_SSH_KEY`（专用部署私钥）与 `EVEM_KNOWN_HOSTS`；限制部署分支 master，可按账号功能设置审批。当前 root 检查私钥不进入 GitHub。
11. 修复/处理已有 E2E 失败后，合并并推送；手动 publish，确认 GitHub runner 能访问 SSH、版本 SHA 与 assets 正确，再手动 rollback 并复查首页/API/上传/后台静态资源，然后恢复目标版本。演练全过程记录证据。
12. 最后才设置 repository variable `EVEM_AUTO_DEPLOY=true`。此后 push master 就意味着生产发布。

生产数据状态示意（不要原样复制占位值）：

```json
{
  "frontend": {"source": "40位tree hash", "sha": "40位commit", "path": "/EVEMTK/deploy/releases/legacy/frontend", "legacy": true},
  "backend": {"source": "40位tree hash", "sha": "40位commit", "path": "/EVEMTK/deploy/releases/legacy/backend", "legacy": true}
}
```

## 故障处理

### 战术板 WebSocket 侧车

`/api/` 继续由 WSGI 服务处理；`/ws/tactical/` 独立代理到回环 ASGI 服务。发布器在服务器配置 `tactical_ws: true` 后同时重启两个服务，并把公开 WebSocket 升级（HTTP 101）纳入发布/回滚健康检查。前端仍保留经认证的 HTTP 同步兜底。

先通过完整 CI、本地隔离 100 人负载测试和线上现有配置核验。仅在目标应用版本已发布且后端时间契约验证通过后，由 root 将 `activate_tactical_ws.py`、`release.py`、`evem-tactical-asgi.service.example`、`tactical-nginx-location.example.conf` 放在同一受控目录，执行 `python3 activate_tactical_ws.py --bundle <目录> --expected-sha <已发布的40位SHA>`。脚本检查固定路径和当前布局，单独安装 pinned ASGI 依赖到 shared 目录，不改 WSGI venv；备份 Nginx、发布器、sudoers、发布配置，启动侧车并测试回环/公网升级后才开启发布门禁。失败自动恢复这些配置并停用侧车；保留备份与依赖目录供人工核对。不要将 `.env` 或生产令牌复制进验证日志。

激活后确认 `systemctl is-active evem-backend evem-tactical-asgi`、公网 `/ws/tactical/0/` 在正确 Origin 下返回 101（但无认证数据）、正常浏览器授权连接持续收到上报变化、普通网站/API 不受影响。回滚应用仍须遵守发布器的数据库迁移限制；如果侧车健康失败，应先用备份恢复配置并保持 HTTP 兜底，不要通过关闭健康检查强行发布。

- 校验/依赖/迁移失败：线上未切换。确认原因后重新运行同一 SHA，已准备版本会再次校验，不覆盖不同内容。
- 健康失败且回滚验证通过：workflow 仍然失败，但线上已恢复旧代码；检查错误与版本记录。
- journal 存在（包括断电/SIGKILL）：停止重试。读取 journal 的 old/new/previous_before，核对实际链接、systemd、数据库状态，按记录恢复链接和服务、验证健康后恢复 state/previous。**不要直接删除 journal 来强行发布。**目前这类不确定状态需要维护者人工恢复。
- 需要回滚：Actions 手动 rollback 恢复上一成功版本，不 checkout 任意未经验证提交，不反向 migrate。
- 磁盘增长：当前无自动删除策略。定期检查 incoming/releases/assets；未来清理只能精确处理不被 current/previous/journal 引用且超过保留期的流水线文件。原项目、用户数据和历史手工 ZIP 永不作为自动删除目标。

## 验证记录与限制

本地执行命令：

```text
python -m unittest discover -s scripts/deploy/tests -v
cd backend
python manage.py test License ActivationCode EVE_MDjango.tests_deployment --settings=EVE_MDjango.ci_settings --noinput
cd ../front-codex
npm ci --no-audit --no-fund
npm run build
npm run test:e2e -- --workers=2
```

隔离后端套件覆盖 License/ActivationCode/版本探针与迁移门禁，共 22 项通过，不等于完整 MySQL 业务集成。原 5 个前端失败已定位为旧接口 mock 和选择器问题，仅修复测试后全量 77 项通过；CI 保留全量门禁，无 continue-on-error。

29 项部署测试已在 GitHub Linux runner 和目标 CentOS/Python 3.10 的隔离临时目录通过，其中 Linux 集成测试使用真实文件锁、符号链接和 HTTP，但服务命令使用替身。真实生产 SSH/systemd 与发布回滚验证另见上线记录。
