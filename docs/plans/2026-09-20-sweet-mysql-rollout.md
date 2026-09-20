# SWEET 原始快照 MySQL 导入记录

执行日期：2026-09-20。范围：只新建隔离静态库，不改变现有业务表、授权库、Django alias、发布器或运行中的服务。

## 输入与只读预检

- SWEET SQLite 版本 218811，22 表、899,630 行。
- SQLite SHA-256：`c47d33925de2d61c44880dfc2fd45e41ada168c596961deb696ecefc8818dd6a`。
- 压缩包 SHA-256：`eed6ef1921965b7c5a031a9283e80337def10cfe6c3b1382644c4c806592846d`。
- SSH 核验 ED25519 指纹：`SHA256:oVFu/exNwy532ZBJrH0xal5ep2U1Ra82sf3hHgLEwlc`；未关闭主机密钥检查。
- 实测 MySQL 8.0.37，当前业务库 `eve_echoes`；STRICT_TRANS_TABLES 已启用，max_allowed_packet 64 MiB，utf8mb4。
- 目标 `evem_sweet_` 前缀 schema 在操作前不存在；现有账号具备建库权限，没有新增/扩大账号权限。
- 预检磁盘可用 18,506,489,856 bytes；`evem-backend.service` active；业务迁移记录数 32。

## 可恢复输入

私有目录 `/EVEMTK/deploy-backups/sweet-20260920-c47d3392`，权限 0700；已上传原始压缩包与归档清单。包哈希已在服务器复核，tar 仅含 `echoes.db`，不含路径跳转或链接。该目录不是 Web 公开目录。

原始快照及本地副本保留，足以从零重建新增静态库。此次不修改业务数据，因此不以恢复业务库作为回退步骤；发生导入故障时停止使用未验证新库，不反向修改业务库，也不自动删库。

另外于 UTC 2026-09-20 04:11:18 完成业务库 `eve_echoes` 的只读 single-transaction mysqldump，保存在同一私有目录 `business-before-static-import.sql`，权限 0600，27,219,274 bytes，SHA-256 `50a5eb50f4fafb0ddedf3949f3413fde756088eb45e3e38df7fe481c04a69ee1`。命令退出成功且完整结束标识已核验；没有在生产库执行恢复。本次新增静态库的恢复输入仍是完整 SQLite 原始包。

导入器提交 `0459407`；上传文件 SHA-256 `6fc98407310fb7c6fd74c29bed9242a3599b3e3c6e99e119cb5633c7898db83f`。服务端 Python 3.10.6 / SQLite 3.7.17 实测不支持 `table_xinfo`，测试驱动加入 `table_info` 兼容后，服务端只读 inspect 通过，22 表所有摘要与本地一致。未升级服务器运行时。

## 执行状态

- [x] SSH / 权限 / 严格模式 / 空间 / 服务预检
- [x] 私有原始包上传及压缩包摘要复核
- [x] 新业务库备份完成及哈希、结束标识核验（未演练恢复）
- [ ] 导入工具测试、规格审查、代码审查
- [ ] 全量 MySQL 演练：逐表行数、内容摘要一致
- [ ] 正式静态版本库导入与独立再次校验
- [ ] 导入后业务健康复核

本记录不表示尚未执行的步骤已完成。原始快照日期不保证国服当前内容覆盖；舰船/装备完整图鉴仍为待办。软件许可也不代表游戏数据或图片的公开分发授权，因此未开放原始数据下载。
