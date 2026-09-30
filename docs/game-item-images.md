# 客户端物品图接入

制造和市场页面使用 `front-codex/src/data/game-item-images.json` 作为精简的 ID → 内容哈希索引，实际 PNG 放在 `front-codex/public/images/game-items/`。索引只包含制造范围（566 个物品引用）及市场页当前批准的图标范围，当前快照共 575 个 ID、519 张去重 PNG，约 11.21 MiB。

素材来自共享 `GameData` 公共快照（revision `2557df2b3edfbb83d27620e40460c3935c9c81dc5d06ca1d2b3198976cc6feb7`），导入器在写入前校验当前指针、目录 SHA-256、`verified/item-icon` 角色、PNG 内容哈希和尺寸。浏览器索引不包含客户端安装路径、WPK 路径或其他本地来源信息。

## 更新素材

先执行无写入校验：

```powershell
cd front-codex
node scripts/import-game-item-images.mjs --source-root C:/path/to/EVEM_Toolkits
```

确认校验通过后加 `--apply` 写入 PNG 与索引。导入器会保留已存在且哈希一致的文件，并拒绝覆盖哈希不一致的内容；索引在所有素材校验完成后原子写入。

前端图片选择顺序是：API 返回的 `image_url` / `ship_image_url`、本地共享快照、已审核的客户端映射、旧市场图标。原图使用 `object-fit: contain`，不强行拉伸 156×128 等非正方形资源。
