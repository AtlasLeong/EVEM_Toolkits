# 市场价格模块：运行与发布

网站公开页 `/market` 是市场行情终端：按目录一级分类、名称或 ID 切换已启用物品，查看真实采集的最低卖价与最高买价双线走势（24 小时、7 天、30 天），并可独立显隐两侧图例。`/market/admin` 供网站 staff 查看运行状态，并由具备相应 Market 模型权限的人修改物品和 35–51 分钟随机采集区间、排队一次手动采集。手动按钮只入队，HTTP 请求绝不连接游戏。

## 行情页数据含义

- 一级分类来自随仓库目录的原始 `category_id`；已有的三级组名继续作为物品类别显示。没有目录编号或无法核实编号的手工物品统一归入“其他”。一级中文名称是导航标签，不表示额外验证过的官方分类。分类计数和公开列表只包含管理员已启用的物品。
- `/api/market/items/?category_id=<编号或 other>&q=<关键词>` 支持分类与名称/ID 联合筛选；`/api/market/categories/` 返回各一级分类和启用数量。旧版 `/api/market/items/<id>/history/` 保持分页结构不变。
- `/api/market/items/<id>/series/?days=1|7|30` 按采集时间升序返回最多 240 个真实快照点，`count` 是时间范围内抽样前的快照总数。空盘口一侧为 `null`，图线遇到缺口断开，不把缺失价当零。涨跌额和百分比分别由区间内该侧首末两个有效观测计算；不足两个有效观测显示“样本不足”。
- 最低卖价和最高买价是采集时可见盘口，不是成交价格或成交量；走势图也不保证覆盖每次市场变动。页面应区分未采集、空盘口、超过两小时的旧报价和接口不可用。没有真实历史数据时显示空状态，绝不伪造趋势。

## 数据和会话边界

- `market_seed_catalog` 将本仓库随附的 5,052 条普通市场物品目录和已验证的“伊甸币” ID 插入为**停用**状态；重复执行不会覆盖现有启停设置、名称或价格。管理员通过服务端搜索和分页选择要采集的物品。
- 一个 `market_tick` 最多尝试 40 个物品，按最后**尝试**时间轮转；失败项不会永久占满队列。启用超过 40 件时，每件物品的重访周期会随轮转批次数增加，管理页显示容量提示。每个批次建立一次连接、进入角色、查询、断开，然后从完成时刻起抽取 2,100–3,060 秒的下一次间隔。过期租约可恢复，快照不可改写；没有买单或卖单的一侧保存为 NULL，不是 0。
- 当前协议固定使用 `region_id=8`；原采集器仅将其称为市场范围参数，没有证据证明它等于“全服”。API 的 `scope=global` 是本版内部兼容值，界面应明确标为“市场范围 8”。未来支持多个范围时须新增明确的数值范围字段和联合唯一键。
- `backend/Market/session_bundle.py` 加载 0600 且属于采集用户的私有 JSON 会话模板，默认路径由 `MARKET_SESSION_FILE` 指定。模板含可重放的登录材料，不是公开配置；不得放进 Git、发布包、网页、普通日志或数据库。当前实验性协议能在每轮用**已取得的会话模板**重新连接和登录角色，但**不能仅凭邮箱/密码完成首次认证或自动续期**。会话过期会停用自动重试并显示 `needs_auth`，管理员更换模板后可手动排队验证。
- 价格来自游戏市场 RPC 的可见盘口，不保证每个目录 ID 都可查询；公开页把未采集、近期空盘口、过期报价分别标明。协议异常不得清空上一次有效报价。

## 从授权的 Windows 抓包会话导出

先在**抓包所有者自己的 Windows 账号**下，按原 `EVE_Market_Collector` 的流程把本人授权抓包导入 `session.dpapi`。随后在本仓库根目录，用已安装 `msgpack==1.2.2` 的 Python 3.11 运行一次：

```powershell
$source = Join-Path $env:LOCALAPPDATA 'EveMarketCollector\session.dpapi'
$output = Join-Path $env:LOCALAPPDATA 'EveMarketCollector\portable-market-session.json'
py -3.11 scripts\market\export_session_bundle.py --source $source --output $output
```

也可以把两个参数改成自己的**绝对本地路径**，但输出目录须已存在并位于仓库、同步盘和网站发布目录之外。导出器不读取 PCAP、不联网、不读取数据库凭据；它验证原采集器的 DPAPI/msgpack 格式和 Linux 所需的模板后，才创建版本 1 JSON。输出目标只允许新建，不覆盖已有文件；Windows 卷必须支持持久 ACL，新文件从创建起只有当前账号的受保护访问许可。失败时只显示通用提示，不显示文件路径、会话内容或系统异常。若目标已存在，请先明确处理旧副本，再选择一个新的输出文件名。

这个 JSON **包含可重放的登录材料**，是短暂的私有迁移文件，不是普通配置或备份。不要将其放进 Git、聊天、工单、日志、网页、发布归档或云同步。通过受控私密通道转移后，在 Linux 私有目录中安装为采集用户 `evem-market` 所有、权限 `0600` 的 `session.json`，并删除 Windows 和传输暂存位置不再需要的明文副本。导出成功只表示格式正确；是否仍可登录、有效期和单物品报价必须在隔离环境另行验收。

## 首次 Linux 发布顺序

1. 在隔离环境通过 CI、前端构建、部署测试、迁移检查和真实 MySQL 演练；确认当前网站备份及回滚位置。不要把账号密码作为命令参数、环境日志或提交内容。创建采集用户前先将网站 `.env` 精确收紧为网站及发布身份可读、采集身份不可读，并验证网站健康；不可递归更改发布目录权限。采集服务使用独立数据库凭据。
2. **发布新 Market 后端之前**，由 root 审核并升级服务器独立维护的 `/usr/local/lib/evem-deploy/release.py`。仓库里的 `scripts/deploy/release.py` 不会随网站归档自动覆盖这份文件。新版发布器在发布/回滚全程与采集器共用一个锁，并在切换链接前验证候选 Python 的 `msgpack==1.2.2` 与模块来源；此预检不读取会话或联网。
3. 建立系统用户/组 `evem-market`，只给它读取发布代码、自己的会话和受限 MySQL 账号的权限。在 root 拥有且不允许非 root 写目录项的 `/EVEMTK/deploy/shared/market/` 预置 `collector.lock`：普通文件、固定 inode，发布用户可读写，`evem-market` 可读并加锁。**不能删除重建锁文件**；发布锁缺失时必须失败关闭。目录应阻止网站 `nginx` 用户读取会话。
4. 将 `scripts/deploy/requirements-market.txt` 中的固定版本依赖安装到独立只读 `/EVEMTK/deploy/shared/market-python`，不是网站 venv；验证候选网站 Python 加相同 `PYTHONPATH` 可以导入 `Market.session_bundle` 和 `Market.collector_protocol`。该目标目录由 root/发布身份控制，采集身份只读。
5. 对现有数据库做可恢复备份，用现有发布/迁移身份应用 `Market` 迁移并运行 `market_seed_catalog`。然后创建仅能对 Market 的物品、配置、运行、快照、最新价表进行必要 SELECT/INSERT/UPDATE 的 MySQL 用户；不要用该受限账号执行迁移。数据库凭据放在 root 限制访问的 `/EVEMTK/deploy/shared/market/database.env`，以 `MARKET_DB_NAME/USER/PASSWORD/HOST/PORT` 五项供 systemd `EnvironmentFile` 读取。
6. 从**专用测试账号在游戏中完成登录与市场操作**的授权抓包导出会话模板，通过受控通道安装为 `/EVEMTK/deploy/shared/market/session.json`，归 `evem-market` 所有、0600，目录仅发布与采集身份可进入。不要把聊天中的明文账号列表写入服务器配置；额外账号无需导入。先在隔离模式查询一个确认过的物品并写/读真实 MySQL，检查过期会话、断网、重启和回滚。
7. 发布网站，再安装并启动 `evem-market-collector.service`/`.timer`（仓库中提供示例）。目标服务器的 systemd 219 不支持 `ProtectSystem=strict`，示例改用 `ProtectSystem=full` 加 `ReadOnlyDirectories=/EVEMTK`；安装前须在目标机器运行 `systemd-analyze verify` 并核对实际生效的限制。systemd 使用 `EVE_MDjango.market_worker_settings`，不会读取网站 `.env`、URL 或 WebSocket 设置。timer 每分钟只检查到期/手动任务；真正采集结束后才随机安排下一轮。确认服务用户、锁 ACL、`TimeoutStartSec=10min`、计时器和线上 API 状态；没有专用会话时保持 timer **未启用**。

### 默认数据库备份与隔离恢复演练

在 Market DDL 前，由 root 审核并安装 `scripts/deploy/market_mysql_backup.py` 到 root 控制的位置。用**候选 backend 自己的** `.venv`、`EVE_MDjango.settings` 和链接的私有 `.env` 运行；必须显式指定候选 backend、预期数据库名和 `/EVEMTK/deploy-backups/` 下尚不存在的直接子目录。例如将以下占位路径替换为实际已验证的候选目录和新的时间戳目录：

```sh
cd /EVEMTK/deploy/<candidate>/backend
.venv/bin/python -B /usr/local/lib/evem-deploy/market_mysql_backup.py \
  --backend /EVEMTK/deploy/<candidate>/backend \
  --expected-database eve_echoes \
  --backup-dir /EVEMTK/deploy-backups/market-pre-<timestamp>
```

命令只读取网站默认 MySQL 配置，在进程内核对 `DATABASE()`，将凭据短暂写入备份目录内的 0600 MySQL 选项文件并始终移除；不会把密码放在命令参数或输出中。新目录为 0700，SQL 与校验清单为 0600。完整默认库 dump 包括表、例程、触发器和事件，使用 InnoDB 一致性快照；执行期间不得有并发 DDL。退出码、非空大小、完成页脚和 SHA-256 必须全部通过，失败时不得使用残缺 SQL。该目录与 MySQL 数据位于同一磁盘，因此还须将备份安全复制到异地并复核摘要。

Windows 操作员可使用 `scripts/deploy/market_backup_offhost_encrypt.py` 将**明确路径**的服务器备份经已有 SSH 私钥读取到进程内存，以 Windows 当前用户 DPAPI 加密后保存为其 `LocalAppData` 下全新的 `.dpapi` 文件；需要显式传入私钥路径、清单中的大小和 SHA-256、输出路径。脚本只接受固定服务器与规定格式的备份路径，不会在本机写明文 dump，落盘后会解密回读并再次验证摘要。输出文件采用从创建时生效的当前用户独占 ACL；同一 Windows 用户配置文件是恢复该加密副本的必要条件，因此还应按组织的容灾策略另外保管可恢复的密钥/备份。不要把 `.dpapi` 文件放进仓库、发布包或公共同步目录，也不要把聊天里的游戏账号密码写入备份脚本或命令。

优先在**独立的非生产 MySQL 8.0 实例**恢复；如果服务器暂时没有第二个实例，可在同一 MySQL 实例上使用新建的 `evem_market_qa_<12 hex>` 测试库与同名、仅 `@127.0.0.1` 登录的独立账号。后者只能验证库名和权限隔离，**不能**模拟实例级故障或替代异机容灾。先用 `market_mysql_restore_rehearsal.py --verify-only` 重算备份摘要并检查 SQL；`market_mysql_qa_provision.py --provision-qa` 创建只对该测试库授权的随机账号，凭据只落在私有备份目录；再用恢复脚本验证实际登录身份、服务器 UUID、授权范围、库不存在，并只在新库恢复。生产库 `eve_echoes` 不能作为恢复目标。随后用 `EVE_MDjango.market_rehearsal_settings` 运行三条 Market 迁移与目录种子，确认目录默认全部停用。任何步骤失败时保留现场人工核查，不自动删除测试库或账号，也不要用生产 root 数据库账号做恢复演练。只有恢复和迁移演练成功、生产 `migrate Market --database=default --plan` 确认为预期迁移后，才在维护窗口执行生产迁移；MySQL DDL 失败时不要 `--fake`、盲目重跑或在持续写入的网站上直接整库恢复。

## 回滚与安全检查

发布/回滚遇到正在采集的共享锁应在切换前失败并稍后重试；采集器遇到发布锁或未完成的 `transaction.json` 应安全跳过。若它在等待锁时加载了旧代码，持锁后会核对自身后端真实路径与 `current/backend`，不一致则退出。系统服务被中断的运行记录会在租约到期后标记失败，不会永久占住手动排队。页面和采集服务可独立回滚；旧价格历史在数据库保留，数据库迁移不随代码回滚自动删除。

`market_tick` 的一次本地合成测试和现有 DPAPI 会话的单物品真实报价只证明协议可用；不能替代专用账号、Linux 会话有效期、真实 MySQL 写入和 systemd 长时运行验收。
