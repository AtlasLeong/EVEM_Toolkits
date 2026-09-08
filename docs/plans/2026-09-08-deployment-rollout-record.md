# 自动部署上线记录（2026-09-08）

## 已验证的准备工作

- GitHub：`AtlasLeong/EVEM_Toolkits`，管理员授权，production Environment 仅允许 master，部署凭据使用独立账号/密钥，不使用 root 检查密钥。
- 候选版本：`8ce32e1a7d1b38e5ce4dcf2366549825606f33e2`，已 fast-forward 合并到 master 并推送。
- [最终分支 CI](https://github.com/AtlasLeong/EVEM_Toolkits/actions/runs/34180035314) 通过：29 项部署测试、22 项隔离后端测试、77 项前端 E2E、生产构建与产物校验。
- 同一组部署测试在目标 CentOS/Python 3.10 的独立 `/tmp` 中通过。真实发布账号的配置/运行时/日志访问与双库只读迁移门禁通过。
- 原有 5 个 E2E 失败根因是旧接口 mock 和失效选择器，修复测试而未改变业务逻辑。
- 多库门禁按现有 app-level router 过滤迁移；仍检查冲突、历史一致性和真实未应用迁移。没有执行 migrate/fake 或补写生产迁移记录。

## 服务器目录及权限

- 原项目保留：`/EVEMTK/EVEM_Toolkits`，没有 git pull、删除或移动原始上传/配置/虚拟环境。
- 配置备份：`/EVEMTK/deploy-backups/20260908-initial`，root 私有。
- 原版文件快照：`/EVEMTK/deploy/releases/legacy-20260908`，前端来自实际 live dist，不用 Git SHA 冒充手工上传版本。
- 发布器：`/usr/local/lib/evem-deploy/{release.py,migration_check.py}`，root 管理；runtime 链接使用原 Python 3.10 venv。
- 发布账号：`evem-deploy`，只能 sudo 重启 `evem-backend.service`；应用仍以 nginx 运行。
- 当前代码：`/EVEMTK/deploy/current/{frontend,backend}`，版本产物保存在 releases，旧哈希资源保存在 shared/assets。
- `.env`、logs、static/uploads 和原 venv 使用原路径链接；未复制 4.9 GB venv，约 40 MB 用户上传未移动。
- 已核验的 requirements SHA-256：`7f32fcef4154e5a15fc39f518bf65641b02da33cfda9b00d991015ff9d14b90f`；线上 `pip check` 无冲突。

## 首次目录切换

第一次尝试因 CentOS 老 curl 不支持 `--retry-connrefused`，触发脚本回退。随后确认原配置恢复、首页/API 200；保留失败 drop-in 在备份目录。调整探测参数后第二次成功：legacy 快照运行于新目录，首页 SHA-256 与原版相同，API 与真实静态图片 200。

此过程短暂重启后端，没有数据库变更。Nginx TLS/域名/API/admin 代理保持原配置语义，上传路径仍固定原目录。

## 发布与演练状态

- [首次 GitHub 手动发布](https://github.com/AtlasLeong/EVEM_Toolkits/actions/runs/34180360530)：第二次尝试成功；线上 `/deploy-version.json` 与 `/api/deploy-version/` 均返回 `8ce32e1a7d1b38e5ce4dcf2366549825606f33e2`，www 首页与真实静态 PNG 为 200，服务 active，无未完成 journal。
- 首次尝试的故障：云端全部检查通过，但 Python HTTPS 探测因缺失默认 CA 文件失败。链接自动退回 legacy，首页 200；恢复健康验证也受同一 CA 问题影响，因此保留 journal 阻止后续切换。管理员补齐原本不存在的 `/usr/local/openssl/ssl/cert.pem` 到系统 CA 的链接（不关闭证书验证）；以发布账号核验 HTTPS、实际链接、state/previous 均对应旧版后，将 journal 归档为 `/EVEMTK/deploy/recovered-transaction-34180360530.json`。仅重跑失败发布 job，复用同一流水线已验证产物，成功发布。
- [GitHub 手动回滚](https://github.com/AtlasLeong/EVEM_Toolkits/actions/runs/34180977736)：成功；实际链接与状态均回到 legacy，线上首页 SHA-256 与旧版快照一致，API、首页引用资源和服务健康，无未完成 journal。
- [恢复新版](https://github.com/AtlasLeong/EVEM_Toolkits/actions/runs/34181018896)：完整云端验证与 publish 成功；同 SHA 重新构建的产物通过已有版本完整性校验。再次核验两组件 SHA 为 `8ce32e1a7d1b38e5ce4dcf2366549825606f33e2`、实际链接一致、首页/assets/API 健康，无 journal；www 首页和真实静态 PNG 200，后端 active，MainPID `27561`。
- 所有上述门禁通过后，于 `2026-09-08 10:47:10 +08:00` 开启 repository variable `EVEM_AUTO_DEPLOY=true`（GitHub API 回读确认）。此后 master 推送会自动发布。
- 本记录随仅文档/配置示例的提交推送，用于验证自动触发；预期组件源 tree 不变，不切换业务代码、不重启后端。该推送运行结果可在 [Production 流水线](https://github.com/AtlasLeong/EVEM_Toolkits/actions/workflows/deploy.yml) 按本文件提交查看。

## 验证边界

隔离后端测试覆盖 License、ActivationCode 与部署探针，不代表完整 MySQL 业务覆盖。自动发布不包括自动迁移/依赖升级，也不承诺零停机。未来改动数据库路由、systemd/Nginx、发布器自身或 Python 依赖时需独立审查。
