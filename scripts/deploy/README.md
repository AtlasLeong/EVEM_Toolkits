# 自动部署：实施与运行说明

## 当前状态（2026-09-08）

第一批本地实现，位于 `codex/automated-deployment` 独立工作区。尚未合并、推送、创建生产部署账号、配置 GitHub secrets、修改线上服务或启用自动发布。

已有产物构建、校验、组件差异判断、发布事务、健康检查、代码回滚入口和 GitHub 工作流。**不能把当前文件直接复制到服务器就开启自动发布**：首次初始化、Linux/SSH 集成验证、既有 E2E 失败处理和回滚演练仍是上线关口。

## 日常更新（完成首次上线后）

PR 运行 CI；推送 master 运行同一套 CI。只有仓库变量 `EVEM_AUTO_DEPLOY=true` 时，master 的成功检查才自动发布。未设置变量时，push 只验证，不上线。第一次通过 Actions → Production → Run workflow，在 master 上手动 publish；测试不通过就不会拿到生产凭据。rollback 入口不受当前新代码测试失败影响，但仍需 production Environment 和 master 分支。

构建机采用 GitHub Ubuntu runner、Node 22、Python 3.10。服务器沿用现有 CentOS/Python/Gunicorn，不运行 npm。

- `pack.py` 读取 Git HEAD 中的 backend 文件和刚构建的 dist，不递归复制工作目录；包含提交、组件 tree hash 和逐文件 SHA-256。
- `release.py` 校验完整清单与摘要，拒绝路径穿越、符号链接、`.env`、venv、日志和上传文件。
- 组件比较使用线上最后成功状态，不仅比较上一条提交；前端单独变更不重启后端。
- 服务器文件锁与 GitHub concurrency 防止重叠发布，切换不主动取消。
- 后端版本接口 `/api/deploy-version/` 在进程加载时固定 SHA；前端 `/deploy-version.json` 提供对应 SHA。首页、首页引用的 assets、API、服务状态与 SHA 共同检查。
- 失败恢复 current 链接和状态文件，再检查旧版本；如果恢复失败，保留 `transaction.json` 并阻止后续发布，不谎报成功。
- 源码和后台版本切换之间仍有短窗口，要求前后端接口向后兼容；后端 restart 可能造成短暂中断。

## 依赖与数据库边界

v1 不自动安装生产依赖，不自动执行数据库迁移。

`shared/environments.json` 用 requirements.txt 的 SHA-256 映射到在这台 CentOS 上验证过的 venv 绝对路径。现有 4.9 GB 环境只登记复用，不能每次复制，也不能在唯一可回滚环境中 pip install。依赖变更先准备独立环境、验证、登记，再发布。

发布前对 default 和 license 执行 `manage.py migrate --check`；有未应用迁移就停在切换前。需要迁移时先审查迁移、备份、验证兼容性并在维护流程中执行，然后重新运行发布。代码回滚不还原数据库；旧代码的兼容性仍需人工确认，`--check` 不是数据兼容性证明。

## 首次初始化检查清单（尚未执行）

1. 本机完成 `gh auth login --hostname github.com --web`，核验仓库 `AtlasLeong/EVEM_Toolkits` 的管理权限和 Actions 可用性，不在聊天中粘贴令牌。
2. 核验服务器 ED25519 指纹 `SHA256:oVFu/exNwy532ZBJrH0xal5ep2U1Ra82sf3hHgLEwlc`；保存实际主机公钥行作为 known_hosts，不能用指纹字符串代替，也不能用未经核验的 ssh-keyscan 直接信任。
3. 备份 Nginx 配置、systemd service/drop-in、当前真实前端目录、后端受跟踪代码；检查可用磁盘、数据库备份恢复流程。不要以旧 git HEAD 推断手工上传的前端版本。
4. 创建 `evem-deploy` 和独立 CI 密钥；保留管理员原有 SSH 登录途径。只允许该账户非交互 sudo `/bin/systemctl restart evem-backend.service`，不授权任意 shell、任意 systemctl、pip 或 Git。生产凭据只授予可信维护者。
5. 将审查后的 `release.py` 安装到 root 管理的 `/usr/local/lib/evem-deploy/release.py`；同目录 `runtime` 链接指向已验证 Python 3.10 venv。CI 不更新发布器本身。
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

隔离后端套件只覆盖 License/ActivationCode/版本探针，不等于完整 MySQL 业务集成。前端 2026-09-08 基线为 72 passed / 5 failed（举报管理3项、星系导航2项），CI 保留全量门禁，无 continue-on-error。必须先分析处理这些失败才能首次自动发布。

本机 Docker Linux engine 未运行，真实 Linux 文件锁/符号链接与 SSH/systemd 行为仍需 CI/演练验证，不把 Python 单测冒充线上演练。
