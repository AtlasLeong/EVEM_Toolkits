# 犁地变化榜与统一管理中心：上线与回滚

本文件是后续运维流程，不是已执行的上线记录。实现获批不等于获准推送、修改生产配置或迁移数据库；执行这些操作前须另行取得明确授权。禁止为验证本功能额外探测游戏接口。

## 功能与安全边界

- 公开星图的当前总量继续公开。授权保护网站提供的变化榜和历史服务，不能阻止他人比较两次公开总量自行计算差值。
- 变化榜比较相邻两次成功记录的快照，只对两次都存在的星系计算有符号净变化，按正增量排序。新出现、缺失、回落和失败均不可当作新增摧毁；界面显示实际起止时间及间隔。
- 源接口的统计时间窗口尚未验证，文案为“快照净增量”，不是“精确的十分钟新增摧毁”。第一次成功记录仅建立基线，第二次成功记录后才有比较区间；不能补算过去未保存的数据。
- 管理中心的唯一所有者绑定为 `CONTROL_CENTER_OWNER_ID` 对应的稳定用户 ID，同时要求数据库中邮箱 `2235102484@qq.com` 唯一且该账号有效。JWT 中的邮箱、普通 staff/superuser 标记和激活码均不替代这一绑定。
- 查看变化榜是单独授权，不赋予管理中心权限。授权、撤销及审计保存在正常应用的 `default` 数据库；原有审核、激活码等模块仍执行自身权限检查。
- KM 继续下架。保持 `KILLBOARD_OWNER_EMAIL` 为空、`KILLBOARD_COLLECTION_ENABLED=false`，KM 采集、bootstrap、identity 服务及其定时器维持停止/禁用。不要把管理中心所有者设置复用到 KM 配置。

## 必须先完成的发布门槛

1. 候选提交通过完整 CI，包括独立的 `ControlCenter` 测试、迁移漂移检查，以及原有 AnomalyHotspots、隔离 worker 和发布安全测试。
2. 明确候选版本、已验证 Python 环境、生产配置来源和数据库路由。只读核实实际 `default` 目标，确认不是 QA、SQLite 测试库或 `license` 库；不得打印数据库口令、环境文件或会话内容。
3. 备份 `default` 数据库并验证恢复材料可用，审查候选迁移计划及旧版兼容性。数据库迁移属于独立维护操作，须获得明确操作授权。
4. 在启用历史配置或安装新服务沙箱约束前，按下节准备私有目录并验证 Linux 权限。
5. 只读核实所有者身份，再配置稳定 ID；不能猜测 ID、根据 JWT 认领账号，或在此流程中修改用户邮箱、权限标记。
6. 正式发布后再验证 HTTP 权限、历史持久化和正常定时采集，不额外运行一次游戏采集作为探针。

本次还修改了 `scripts/deploy/source_plan.py`，会改变 `policy_digest`；正式发布前必须按[既有受保护发布脚本的上线顺序](../scripts/deploy/README.md#发布规划与按需传输)，由已获授权的运维人员独立审查并安装与候选制品一致的 `source_plan.py` 到 `/usr/local/lib/evem-deploy/`，确认同目录 `release.py` 兼容并保留受保护的属主和权限。旧策略与候选摘要不一致时，`release.py` 的发布规划或 noop 校验会安全拒绝；CI 不自动安装这些脚本，不绕过摘要门禁，也不以此文档执行安装。

### CI 命令

在仓库 `backend` 目录执行隔离检查；这些设置不读取生产凭证：

```sh
python manage.py test ControlCenter --settings=EVE_MDjango.control_center_test_settings --noinput
python manage.py makemigrations ControlCenter --check --dry-run --settings=EVE_MDjango.control_center_test_settings
python manage.py test AnomalyHotspots --settings=EVE_MDjango.anomaly_test_settings --noinput
```

CI 中两个 ControlCenter 命令使用 `set -euo pipefail`，输出分别保留到 `control-center-tests.log` 和 `control-center-migration-check.log`。不以 `continue-on-error`、条件跳过或生产 settings 替代独立测试。

发布源策略只将 `backend/ControlCenter/tests.py` 和确切的 `control_center_test_settings.py`、`control_center_test_urls.py` 视为非运行时文件。模型、迁移、API、生产 settings、未经审查的测试目录及相似文件名仍是发布输入；CI 新步骤只有完整内容匹配审查摘要时才是控制项，修改命令或环境会使其回退为不透明构建输入。

## 所有者 ID 的只读核实

由具备已授权运维访问的人员，在已确认配置指向生产 `default` 的候选后端环境执行以下只读查询。使用已验证 Python、正常应用 settings，不能使用测试/worker settings。查询不输出密码或令牌；若零个、多个、停用账号或查询失败，立即停止，不配置 ID。

```sh
python manage.py shell <<'PY'
from django.contrib.auth import get_user_model

matches = list(
    get_user_model().objects.using('default')
    .filter(email__iexact='2235102484@qq.com')
    .values('pk', 'is_active')[:3]
)
assert len(matches) == 1 and matches[0]['is_active'], 'Owner identity is unavailable or ambiguous'
print('Verified active owner ID:', matches[0]['pk'])
PY
```

将确认的正整数 ID 配到正常 Web 应用的 `CONTROL_CENTER_OWNER_ID`；不要放进游戏采集 worker 环境。随后访问管理中心须再次通过服务器的新鲜数据库身份校验。该 ID 的邮箱被改动、邮箱出现歧义或账号停用时应拒绝管理，不能自动换绑另一用户。

## 数据库迁移：只在 default，人工批准后执行

`ControlCenter` 的新表属于正常应用数据库，不属于 `license` 数据库。不要给隔离采集账号发放任何 Web 数据库凭证。

先用候选版本查看只读计划：

```sh
python manage.py migrate ControlCenter --database default --plan
```

在确认目标、备份、依赖计划和明确操作授权之后，才可人工执行这一应用的迁移：

```sh
python manage.py migrate ControlCenter --database default --noinput
```

这是维护步骤，不应塞入 CI、服务启动命令或自动发布步骤。若计划包含预期之外的依赖/其他应用，先停止审查。不能使用 `--fake`、清空迁移表、回滚其他应用或对 `license` 执行此次迁移。

现有安装的 `scripts/deploy/release.py` 在候选后端切换前调用 `migration_check.py`，分别只读检查 `default` 和 `license` 路由允许的待迁移项；发现未完成迁移会拒绝发布，**不会自动执行 migrate**。完成维护后应由该门禁重新证明可发布，不跳过门禁或将只读检查改为自动迁移。新表和授权记录应与旧应用兼容，旧应用可暂时不使用它们。

## 私有历史目录与两端配置

建议独立路径：`/EVEMTK/deploy/shared/anomaly/history`。`ANOMALY_HISTORY_DIR` 在 Web 应用和隔离 worker 环境中必须指向**同一个绝对目录**；未配置则历史功能关闭/不可用，不影响公开的最后成功快照。保留现有 `ANOMALY_SNAPSHOT_FILE` 配置。

目录要求：

- 必须在 Git、静态资源、release 目录和私有会话凭证目录之外。不能通过静态文件服务公开，也不能使用符号链接、重解析点或相对路径。
- 使用采集服务用户（当前示例为 `evem-killboard`）作为目录及产物所有者，目录模式严格为 `0750` 或 `02750`，所属组为经确认的 Web 只读共享组。文件模式严格为 `0640`，与目录所有者/组一致。
- Web 进程只获得组读和目录遍历权限，不能写文件或目录，不能成为该目录所有者。若调整组成员或组配置，正常重启相关 Web 进程以应用，不给 Web 用户 sudo 或数据库外的新权限。
- 在安装含该路径的服务配置之前先创建目录。示例服务将历史路径加入可写沙箱列表；实际系统的 `ReadWriteDirectories`/`ReadWritePaths` 必须包含这一个已核实目录，其余只读限制不放宽。
- 采集仍通过现有全局锁串行执行。不要增加第二个历史写入者，也不要把目录组改为可写来“修复”权限错误。
- 环境配置只写入已存在的私有配置管理路径，保持原有凭证保护。不要把环境文件、原始 RPC、会话模板、抓包或令牌纳入仓库、日志或管理中心。

可在 Linux 上只读使用 `namei -l`、`stat`、`systemctl cat`/`systemctl show` 核实路径组件、所有者、组、沙箱和生效的环境文件路径；不要输出环境文件内容。还要以实际 Web 身份确认目录可读不可写、以采集身份确认可写；验证不能读取会话材料。

### 容量与保留

成功样本在写入和查询时都按 30 天窗口过滤，并设硬上限：最多 4,321 个已提交样本、已提交样本字节总量不超过 512 MiB。实际保留可能因容量上限更短，不能承诺所有情况下都有完整 30 天数据。

单写入者原子提交期间允许一个额外的暂存样本：最多 4,322 个物理样本文件，受管理的历史产物物理上限为 516.125 MiB（包括样本暂存和元数据替换空间）。单个样本最多 2 MiB，manifest 最多 1 MiB，尝试记录文件最多 128 KiB。不要把 512 MiB 描述为含暂存的全目录瞬时上限；无关的运维文件不属于清理对象，也不应放入此目录。

采集流水只保留最近 200 条经过白名单清理的尝试，记录计数、时间、轮换槽位、阶段/原因等安全字段，不保存账户凭证或 RPC 返回体。`status` 表示源采集结果，`history_status` 独立表示历史发布结果：源成功但历史失败时，公开总量仍可更新，变化榜基线不能伪造推进。磁盘满、权限错或原子提交失败须按历史故障处理，不能删库/清空快照来恢复。

## 定时器与游戏请求预算

示例定时器设置 `OnUnitActiveSec=10min`、`RandomizedDelaySec=30s`。这只是名义周期：执行耗时、调度精度和共享冷却可能使实际间隔更长；界面以实际两次成功样本时间为准。

保持既有每 RPC 随机延迟、账号轮换、全局协调锁、单轮有界请求预算及退避冷却不变；每轮只选择一个会话，不因历史写入失败额外请求，也不在一次失败后立即换账号重试。所有七个已配置会话仍用于星图，KM 不恢复。正常定时产生两次成功记录后再验证榜单，不能为了补齐基线突发连发请求。

## 发布后验证清单（需上线操作授权）

- Linux 权限、原子写入/崩溃恢复及目录 `fsync` 应在目标平台或等价隔离 Linux 环境验证。Windows 本地跳过的 POSIX 模式/所有者/耐久性检查不能当作生产验证通过。
- 版本证明、公开星图快照和原有模块工作正常；公开 JSON 不带授权、历史区间或私榜字段。
- 匿名、普通未授权用户、有效所有者、有效授权用户、撤销后的用户、停用用户分别验证实际响应。管理接口只允许所有者，查看者不能管理或授权；撤销后下一次请求即拒绝，不等待 JWT 过期。
- 验证私有成功及 `401`、`403`、参数错误 `400`、限流 `429` 响应均为 `Cache-Control: private, no-store` 且 `Vary` 含 `Authorization`。不在浏览器、代理或跨用户查询缓存中保留旧私榜；退出、换用户和拒绝访问后清空客户端数据。
- 验证参数错误、旧区间选择、分页及搜索有界；重置/负值、新增/缺失星系、失败间隔不产生虚假榜首。页面明确区分源采集故障与历史持久化故障。
- 查看正常定时日志的安全字段验证账号轮换、实际时间间隔和最新两次成功记录；不要主动调用额外游戏 RPC，不输出原始流量、私有路径内容、令牌或其他账户资料。
- 验证移动端/桌面总量与变化榜切换、搜索、定位、区间选择无错位，管理中心不重叠挤占星图。现有模块入口整合后仍保留原权限判断。

## 回滚与停用

优先停止/禁用新历史配置或回滚到前一个已验证应用版本；必要时在批准的维护流程中还原旧定时器设置。不要通过频繁手动采集来排障。

保留私有历史目录、新增数据库表、授权和审计记录以及原有备份，便于恢复；**回滚不自动删除文件、撤销所有授权、反向迁移或清空表**。旧版应用可以不使用这些新增表。停用 Web/worker 的 `ANOMALY_HISTORY_DIR` 后仍保留公开快照路径及原有采集保护。

任一回滚都不能重新设置 KM 所有者、打开 KM 采集或启动已禁用的 KM 服务。若需要删除历史或改变授权生命周期，必须另行明确目标、备份/保留策略和操作授权。
