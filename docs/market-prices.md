# 市场价格模块：运行与发布

网站公开页 `/market` 展示启用物品的最低卖价、最高买价、采集时间和 1/7/30 天历史；`/market/admin` 供网站 staff 查看运行状态，并由具备相应 Market 模型权限的人修改物品和 35–51 分钟随机采集区间、排队一次手动采集。手动按钮只入队，HTTP 请求绝不连接游戏。

## 数据和会话边界

- `market_seed_catalog` 将本仓库随附的 5,052 条普通市场物品目录和已验证的“伊甸币” ID 插入为**停用**状态；重复执行不会覆盖现有启停设置、名称或价格。管理员通过服务端搜索和分页选择要采集的物品。
- 一个 `market_tick` 最多尝试 40 个物品，按最后**尝试**时间轮转；失败项不会永久占满队列。启用超过 40 件时，每件物品的重访周期会随轮转批次数增加，管理页显示容量提示。每个批次建立一次连接、进入角色、查询、断开，然后从完成时刻起抽取 2,100–3,060 秒的下一次间隔。过期租约可恢复，快照不可改写；没有买单或卖单的一侧保存为 NULL，不是 0。
- 当前协议固定使用 `region_id=8`；原采集器仅将其称为市场范围参数，没有证据证明它等于“全服”。API 的 `scope=global` 是本版内部兼容值，界面应明确标为“市场范围 8”。未来支持多个范围时须新增明确的数值范围字段和联合唯一键。
- `backend/Market/session_bundle.py` 加载 0600 且属于采集用户的私有 JSON 会话模板，默认路径由 `MARKET_SESSION_FILE` 指定。模板含可重放的登录材料，不是公开配置；不得放进 Git、发布包、网页、普通日志或数据库。当前实验性协议能在每轮用**已取得的会话模板**重新连接和登录角色，但**不能仅凭邮箱/密码完成首次认证或自动续期**。会话过期会停用自动重试并显示 `needs_auth`，管理员更换模板后可手动排队验证。
- 价格来自游戏市场 RPC 的可见盘口，不保证每个目录 ID 都可查询；公开页把未采集、近期空盘口、过期报价分别标明。协议异常不得清空上一次有效报价。

## 首次 Linux 发布顺序

1. 在隔离环境通过 CI、前端构建、部署测试、迁移检查和真实 MySQL 演练；确认当前网站备份及回滚位置。不要把账号密码作为命令参数、环境日志或提交内容。创建采集用户前先将网站 `.env` 精确收紧为网站及发布身份可读、采集身份不可读，并验证网站健康；不可递归更改发布目录权限。采集服务使用独立数据库凭据。
2. **发布新 Market 后端之前**，由 root 审核并升级服务器独立维护的 `/usr/local/lib/evem-deploy/release.py`。仓库里的 `scripts/deploy/release.py` 不会随网站归档自动覆盖这份文件。新版发布器在发布/回滚全程与采集器共用一个锁，并在切换链接前验证候选 Python 的 `msgpack==1.2.2` 与模块来源；此预检不读取会话或联网。
3. 建立系统用户/组 `evem-market`，只给它读取发布代码、自己的会话和受限 MySQL 账号的权限。在 root 拥有且不允许非 root 写目录项的 `/EVEMTK/deploy/shared/market/` 预置 `collector.lock`：普通文件、固定 inode，发布用户可读写，`evem-market` 可读并加锁。**不能删除重建锁文件**；发布锁缺失时必须失败关闭。目录应阻止网站 `nginx` 用户读取会话。
4. 将 `scripts/deploy/requirements-market.txt` 中的固定版本依赖安装到独立只读 `/EVEMTK/deploy/shared/market-python`，不是网站 venv；验证候选网站 Python 加相同 `PYTHONPATH` 可以导入 `Market.session_bundle` 和 `Market.collector_protocol`。该目标目录由 root/发布身份控制，采集身份只读。
5. 对现有数据库做可恢复备份，用现有发布/迁移身份应用 `Market` 迁移并运行 `market_seed_catalog`。然后创建仅能对 Market 的物品、配置、运行、快照、最新价表进行必要 SELECT/INSERT/UPDATE 的 MySQL 用户；不要用该受限账号执行迁移。数据库凭据放在 root 限制访问的 `/EVEMTK/deploy/shared/market/database.env`，以 `MARKET_DB_NAME/USER/PASSWORD/HOST/PORT` 五项供 systemd `EnvironmentFile` 读取。
6. 从**专用测试账号在游戏中完成登录与市场操作**的授权抓包导出会话模板，通过受控通道安装为 `/EVEMTK/deploy/shared/market/session.json`，归 `evem-market` 所有、0600，目录仅发布与采集身份可进入。不要把聊天中的明文账号列表写入服务器配置；额外账号无需导入。先在隔离模式查询一个确认过的物品并写/读真实 MySQL，检查过期会话、断网、重启和回滚。
7. 发布网站，再安装并启动 `evem-market-collector.service`/`.timer`（仓库中提供示例）。目标服务器的 systemd 219 不支持 `ProtectSystem=strict`，示例改用 `ProtectSystem=full` 加 `ReadOnlyDirectories=/EVEMTK`；安装前须在目标机器运行 `systemd-analyze verify` 并核对实际生效的限制。systemd 使用 `EVE_MDjango.market_worker_settings`，不会读取网站 `.env`、URL 或 WebSocket 设置。timer 每分钟只检查到期/手动任务；真正采集结束后才随机安排下一轮。确认服务用户、锁 ACL、`TimeoutStartSec=10min`、计时器和线上 API 状态；没有专用会话时保持 timer **未启用**。

## 回滚与安全检查

发布/回滚遇到正在采集的共享锁应在切换前失败并稍后重试；采集器遇到发布锁或未完成的 `transaction.json` 应安全跳过。若它在等待锁时加载了旧代码，持锁后会核对自身后端真实路径与 `current/backend`，不一致则退出。系统服务被中断的运行记录会在租约到期后标记失败，不会永久占住手动排队。页面和采集服务可独立回滚；旧价格历史在数据库保留，数据库迁移不随代码回滚自动删除。

`market_tick` 的一次本地合成测试和现有 DPAPI 会话的单物品真实报价只证明协议可用；不能替代专用账号、Linux 会话有效期、真实 MySQL 写入和 systemd 长时运行验收。
