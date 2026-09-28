# 客户端物品图片调查（2026-09-29）

## 结论

当前工作区无法验证或提取原始客户端纹理。`adb` 不在 PATH，未发现已拉取的 Android 客户端资源（`script.idx`/`script1.wpk`、`.pak`、`.bundle` 或纹理包），因此本次没有修改前端，也没有把推测图片标记为“客户端原图”。

现有市场图标目录包含 48 个 WebP 文件，来源记录明确写明它们是用户提供的游戏截图裁切（不是 APK/客户端资源提取）：

- `front-codex/public/images/market-items/README.md`
- `front-codex/src/utils/marketItemIcons.js`

这些文件可以继续作为当前 UI 的已批准临时素材，但不能据此证明完整物品图标库或客户端 ID 映射已经获取。

## 已验证检查

| 检查项 | 结果 |
| --- | --- |
| 市场 WebP 数量 | 48 |
| 文件头 | `RIFF....WEBP`（示例：`41000000002.webp` 为 `WEBPVP8L`） |
| 客户端资源目录 | 工作区未发现 `script.idx`、`script1.wpk` 或 Android 原始资源 |
| ADB 连接 | `adb` 命令不可用，因此无法读取设备或拉取资源 |
| 原图到 itemId 的可信映射 | 仅有当前 48 项的前端 allowlist；没有额外客户端映射证据 |

## 下一步（需要设备资源后执行）

1. 提供同版本客户端资源目录，或在已授权的测试设备上安装/启用 ADB。
2. 只读拉取 `.../neox/Documents/cloudfiles/res/` 下的资源，并记录文件 SHA-256。
3. 在不执行游戏脚本的前提下定位纹理索引、图集和 item/type ID 表。
4. 生成 `itemId -> 原始纹理路径/裁切坐标/哈希` 清单，抽样核对截图后再接入前端。

在获得资源前，不建议从网上第三方 EVE 图标包直接替换：端游/手游 ID 和美术资源可能不同，会产生错误映射。
