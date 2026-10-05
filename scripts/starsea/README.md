# 星海见闻：隔离本地试用

本目录提供隔离本地开发和只读来源审计，不自动上线。本地演示与种子脚本只在 `codex/tactical-collaboration` 工作树运行，不要换成生产 settings，也不要把演示账号导入生产。生产舰船目录接入见文末。

## 地址与账号

- 页面：`http://127.0.0.1:4195/starsea`
- 审核：`http://127.0.0.1:4195/starsea/review`
- API：`http://127.0.0.1:8002/api/starsea/`
- 作者：`pilot@starsea.local`
- 审核员：`reviewer@starsea.local`
- 隔离测试账号：`another@starsea.local`
- 上述本地账号初始密码均为 `Starsea2026`；再次运行种子脚本不会重置已存在账号的密码。

4195 是星海见闻与军团专项预览：支持星海见闻、军团大厅/详情/编辑及关联公开军团详情，不代理其他功能的线上 API。此前的战术板预览 4194 / 8001 保持不变。正式网站账号不能用于此处登录；本地注册、邮箱验证码和密码找回不启用。

## 初次准备或重启

前提：工作树 `.venv`、前端 `node_modules`、本地真实地理快照 `backend/.tactical-universe.json` 已存在；原始舰船库位于主仓库 `.local-data/eve-echoes/sweet/218811-c47d33925de2d61c/echoes.db`。脚本不下载数据，不访问线上数据库。

在工作树根目录运行：

```powershell
.venv/Scripts/python.exe scripts/starsea/local_seed.py
.venv/Scripts/python.exe scripts/starsea/seed_examples.py
```

`local_seed.py` 拒绝其他 settings、MySQL 或其他 SQLite 路径；地理数据验证后只填补缺失记录，不覆盖现有记录。`seed_examples.py` 只创建缺失的固定示例，保留已编辑、隐藏或未完成的示例。

两个终端分别运行：

```powershell
# backend 目录
../.venv/Scripts/python.exe manage.py runserver 127.0.0.1:8002 --settings=EVE_MDjango.starsea_local_settings --noreload
```

```powershell
# front-codex 目录
npm run dev:starsea
```

这里只监听回环地址，不开放局域网或公网。后端采用 `--noreload`，修改 Python 后需重启该进程；不要停止原有战术板服务。

## 数据边界

- 独立数据库：`backend/.starsea-local.sqlite3`，已加入忽略规则。
- 私有图片：主仓库被忽略的 `.local-data/starsea-preview/tactical-collaboration/images`，不在当前工作树或公开静态资源目录内。
- 舰船源：只读、固定 SHA-256 的 SWEET 218811 历史快照。418 条市场舰船目录候选、18 个舰种；不代表当前国服完整或已实装列表。未收录型号可明确标为未知/自填。
- 示例战报、趣闻、宣传均明确标注虚构，配图沿用已有科幻插画，不冒充游戏 KM。
- 本地共享链接只在本机可访问，不是公开发布地址。

## 快速验收

```powershell
# 工作树根目录；只向固定回环端口请求，会创建并隐藏一条带标识的测试帖
.venv/Scripts/python.exe scripts/starsea/smoke.py
.venv/Scripts/python.exe -m unittest discover -s scripts/starsea/tests -v
.venv/Scripts/python.exe scripts/starsea/seed_examples.py --test
```

完整验收证据和正式发布前边界见 `docs/plans/2026-09-22-starsea-verification.md`。

## 生产舰船目录接入与回滚

2026-10-04 只读核查：线上 backend `902ea227a4265c72bed0333bab2e82722c4e0304` 使用标准 settings；未定义 `STARSEA_SHIP_DB`，`.env`/systemd 也没有该值；`/api/starsea/ships/` 返回安全 503。已检查 `/EVEMTK/deploy/shared` 和原仓库归档路径，未找到 `echoes.db`，不据此推断服务器其他位置绝无文件。

可复用的既有本地归档：`D:/Code/EVEM_Toolkits/.local-data/eve-echoes/sweet/218811-c47d33925de2d61c/echoes.db`，139,812,864 字节，SHA-256 `c47d33925de2d61c44880dfc2fd45e41ada168c596961deb696ecefc8818dd6a`，`user_version=218811`。本次只读独立审计确认 `integrity_check=ok`、418 条市场舰船、18 舰种，逐项与 API 匹配且源未变化。来源与限制见既有 [目录筛查记录](../../docs/plans/2026-09-22-starsea-verification.md)。不用 GameData 替代，不下载新源、不将整库或图像打进发布包或公开下载。

由主发布任务串行执行：

1. 将上述已校验文件复制至独立持久目录，例如 `/EVEMTK/deploy/shared/starsea-catalog/218811-c47d33925de2d61c/echoes.db`；确认该目录不在公开 static/media/alias 下。使用既有 `evem-deploy` 与 `nginx` 组，新增目录/文件只需 deploy 写、nginx 读；不更改既有账户、sudoers 或父目录权限。上传到临时文件并在校验摘要后同目录原子改名，保持快照不可变。
2. 保留 `.env` 原 `STARSEA_SHIP_DB` 的存在状态和值，只新增/替换这一行：`STARSEA_SHIP_DB=/EVEMTK/deploy/shared/starsea-catalog/218811-c47d33925de2d61c/echoes.db`。不要输出或复制其他凭据。本次代码将该配置接入标准 settings，未配置仍安全 503。
3. 在候选 backend 使用已验证的运行环境、实际 settings，并以 `nginx` 服务身份执行 `python manage.py starsea_catalog_check`。它只读固定来源，不查询应用数据库、不写源；应输出 `status=ok`、418 条、18 舰种和上述版本/摘要。deploy 用户可读不代表服务用户可读；若现有执行通道无法以服务身份检查，向主任务报告具体权限需求，不能改用 root 推定成功。
4. 经精确提交完整 CI 和独立审查后按现有发布流程切换，再验收 `ships/` 为 200/count=418、`q=乌鸦`、英文别名 `q=Raven`、`ship_class=战列舰`、分页和真实型号选择。页面保留历史源说明；故障显示未知/自填降级提示与重试，失败后没有上一查询的旧候选。

没有应用数据库迁移。发布失败按原流程恢复旧代码，同时恢复 `.env` 该行原状态并重启服务；检查前后端 SHA 和 API 状态。旧代码会恢复原安全 503/未知自填行为。保留快照供复核，不删除其他任务文件，也不在回滚中修改用户战报。已保存的 canonical 舰船快照不受源回滚影响。
