# 星海见闻：隔离本地试用

本目录只用于本地开发，不包含上线动作。请在 `codex/tactical-collaboration` 工作树运行，不要换成生产 settings，也不要把演示账号导入生产。

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
