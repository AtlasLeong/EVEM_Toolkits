# 网站公共游戏数据与素材目录

`backend/GameData` 为战报、市场、战术板和后续功能提供只读客户端数据。它不依赖业务数据库，也没有额外迁移。

当前快照包含 44,833 条客户端配置记录，32,675 条存在已验证图片，复用 2,702 张 PNG。配置中包含 NPC、活动和未发布变体，不能把这些数量当成可交易物品数量。市场采集仍由既有启用物品配置决定。

## 模块接入

- 后端：`GameData.registry.item_record(id)`、`item_name(id)`、`image_metadata(id)`、`image_url(id)`；可传 `version=revision` 查询历史版本。
- 前端：`GameItemImage` 与 `selectGameItemImage`；由现有业务 API 附带图片信息，不为每个列表行单独请求。
- 公共接口：`GET /api/game-data/items/?ids=10706000201,10607001409`（最多 100 个）；`GET /api/game-data/items/?q=元帅&kind=ships&page_size=50`；`GET /api/game-data/items/10706000201/`；`GET /api/game-data/status/`。
- 公共查询按 IP 限制为每小时 240 次，并限制分页/搜索长度，避免外部大量检索占用服务；模块内调用只读函数不受此 HTTP 限制。`status` 是版本清单元数据，不替代应用健康检查。
- 接口支持 `?version=<revision>`，显式版本使用不可变缓存与 ETag。默认版本指针最多每 5 秒检查一次，JSON 按版本缓存，避免每名参与者重复解析。
- 角色、军团和联盟身份由真实 KM/身份接口提供，公共静态素材目录不推测这些名称。
- 舰船识别使用客户端分类：`client_category_id = type_id // 1000000000`，其中 `10` 为舰船；市场分类是另一套命名空间。未进入市场清单的新舰船也可以通过 `kind=ships` 查询。
- 公共查询会固定同一版本，避免更新时名称、图片和 ETag 混用。不可读取或校验失败返回 `503` 且不缓存；文件恢复后可重新加载。业务模块仍可展示自身数据，不用错误图片代替缺失素材。

## 来源路径与取得方式

原始游戏资源：雷电模拟器的 `com.netease.EVE`；下载资源路径 `/sdcard/Android/data/com.netease.EVE/files/neox/Documents/cloudfiles/res`，并使用 APK 的 `assets/res` 作为原始资源来源。研究副本在仓库的 `output/client-ship-assets/`。

逐项对应链路：`staticdata/items/<分片>.sd` 中的物品 ID/名称/icon_id → THX 中的逻辑图标路径 → 原始纹理 MD5 → 对应 WPK/散文件 → AC/DTSZ 解封装 → KTX ASTC 解码 → RGBA PNG。非标准图标路径来自显式验证的客户端路由证据。

每个版本保留：源 THX SHA-256、全部导入 JSON（含路由覆写证据）的 SHA-256、导出目录、提取/验证脚本路径、代码哈希和方法，以及 decoder 的文件路径、固定提交/哈希与原始链接。每条物品记录保留其版本、静态表及图标引用；共享的表/图片证据保留原始资源包路径、表 MD5/SHA-256、纹理 MD5/SHA-256、PNG SHA-256、逻辑路径和尺寸。内部可用 `item_provenance(id)` 检查；公开 API 不暴露机器本地目录。

图片角色与合成警告完整保留：植入体前景/技能图标不一定是完整合成图标。未知或缺引用项保留明确状态和空图片地址。

## 更新舰船与物品

1. 将新客户端资源复制到独立目录，保留旧资源和验证成果。受维护工具位于 `scripts/game_data/client_assets/`，依赖及固定 decoder 获取方式见其 `README.md`。以下命令从仓库根目录运行，路径替换为对应的私有目录；解析环境不属于网站运行依赖：

   ```sh
   python -m scripts.game_data.client_assets.build_item_image_library --client-root /private/client-snapshot --export-root /private/exports/new-snapshot --decoder-file /private/decoder/decryption.py
   python -m scripts.game_data.client_assets.verify_library --client-root /private/client-snapshot --export-root /private/exports/new-snapshot --decoder-file /private/decoder/decryption.py --write-report
   ```

   提取目标必须为空目录，防止覆盖旧证据。覆写证据绑定 THX SHA-256：默认按当前 SHA 选择 `scripts/game_data/client_assets/routing/<SHA>.json`；未知 SHA 只提取标准路径，将未识别项保留为空。也可显式 `--routing-overrides /private/evidence/<SHA>.json`；不匹配时拒绝使用，不能盲用旧图片。`--no-overrides` 可禁用全部覆写。验证器默认只读；显式 `--write-report` 才生成供导入的校验报告。传 decoder 时还重新解码原始纹理并逐像素比较。

2. 更新经验证的市场分类导出后，导入公共目录：

   ```powershell
   # 可从已验证导出目录导入；同一命令可在 Linux 发布环境执行：
   python scripts/sync_game_data.py --source-root /private/exports/new-snapshot --market-catalog /private/market_catalog.json
   # 本地默认导入 output/client-ship-assets/maintained-export-20260930：
   python scripts/sync_game_data.py
   ```

3. 维护工具的成功验证报告绑定被核验 JSON 的哈希；验证后改动任何导出内容都会拒绝导入，必须重新验证。原始研究旧报告仅作为兼容输入保留。导入还检查 ID/路径、PNG 内容与尺寸及全部历史版本哈希，再发布图片和不可变版本，最后原子切换 `backend/GameData/data/current.json`。相同输入重复导入不会创建新版本；同尺寸损坏图片也会通过哈希检测。中断后重试时，已有版本文件必须与确定性生成的内容完全一致。
4. 新版本增加或更新舰船；消失的旧 ID 保留最后有效记录并标为 `current=false`。旧版本文件与旧 PNG 保留，历史接口仍可指定原版本。版本标识包含输入与父版本，重新导入旧导出也不会丢失中间新增的 ID。恢复旧版本应重新导入对应已保存导出，不手工修改不可变版本文件。旧指针若没有可认证的历史哈希，应恢复对应的已验证目录，而不是给损坏文件补造哈希。
5. 将公共目录与图片作为正常应用发布产物一同部署；浏览器仅请求其需要的记录和图片，不下载完整配置表。原始 APK/WPK、会话和研究环境不进入网站资源目录。

## 存储位置

- 版本指针：`backend/GameData/data/current.json`
- 不可变目录：`backend/GameData/data/versions/<revision>.json`
- 通用 PNG：`front-codex/public/images/game-items/<png-sha256>.png`
- 受维护提取/验证工具：`scripts/game_data/client_assets/`
- 当前本地导出证据：`output/client-ship-assets/maintained-export-20260930/` 的 `item-image-mapping.json`、`assets.json`、`tables.json`、`verification.json`；原始研究导出保留在 `verified-item-images/`
- 旧战报专用生成目录的可恢复备份：`output/client-ship-assets/legacy-killboard-public/`

此流程保留客户端后续更新的接入能力；自动监控客户端补丁和定期重新解包不包含在本次改动中。
