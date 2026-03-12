# 本地开发与联调说明

本文档记录当前 `backend` 与 `front-codex` 的本地联调方式。

## 目录结构

- `backend/`: Django REST Framework 后端
- `front-codex/`: 当前使用中的新前端

## 1. 后端本地配置

后端环境变量文件：
- [`backend/.env`](d:/Code/EVEM_Toolkits/backend/.env)

建议至少包含：

```env
SECRET_KEY=your-local-secret
DEBUG=True
DB_NAME=eve_echoes_v2
DB_USER=root
DB_PASSWORD=your-db-password
DB_HOST=8.134.144.49
DB_PORT=3306
EMAIL_HOST_USER=your-email@example.com
EMAIL_HOST_PASSWORD=your-email-password
```

说明：
- 当前这套联调是“本地 Django + 数据库”模式。
- 如果数据库仍然使用远端，就保留远端 `DB_HOST`。
- 如果要切到本机 MySQL，就把 `DB_HOST / DB_USER / DB_PASSWORD` 改成本机值。

## 2. 前端本地配置

前端本地 API 覆盖文件：
- [`front-codex/.env.local`](d:/Code/EVEM_Toolkits/front-codex/.env.local)

当前本地联调配置：

```env
VITE_API_URL=http://127.0.0.1:8000/api
```

含义：
- 前端开发时优先请求本机 Django
- 不再走 `https://evemtk.com/api`

## 3. 启动顺序

### 3.1 启动后端

```powershell
cd d:\Code\EVEM_Toolkits\backend
python manage.py runserver 127.0.0.1:8000
```

启动成功后，可以用这个地址探活：

```text
http://127.0.0.1:8000/api/boardregions
```

如果返回 `200`，说明后端已经正常监听。

### 3.2 启动前端

```powershell
cd d:\Code\EVEM_Toolkits\front-codex
npm run dev
```

说明：
- `Vite` 只会在启动时读取 `.env.local`
- 如果你修改了 `VITE_API_URL`，必须重启前端 dev server

## 4. 如何验证前端已经接到本地后端

前提：
- 后端已经监听 `127.0.0.1:8000`
- 前端已经重启并读取 `front-codex/.env.local`

打开浏览器开发者工具，在 `Network` 面板里查看请求目标，应为：

```text
http://127.0.0.1:8000/api/...
```

而不是：

```text
https://evemtk.com/api/...
```

## 5. 本地日志怎么看

验证码发送失败、SMTP 登录失败等后端异常，不会显示在浏览器页面里，只会出现在后端日志里。

你现在应该看这两个地方：

### 5.1 后端运行终端

如果你是这样启动的：

```powershell
cd d:\Code\EVEM_Toolkits\backend
python manage.py runserver 127.0.0.1:8000
```

那么异常栈会直接打印在这个终端窗口里。

### 5.2 日志文件

后端现在会把日志同时写入：
- [`backend/logs/dev.log`](d:/Code/EVEM_Toolkits/backend/logs/dev.log)

例如验证码发送失败时，你会看到类似：
- `Failed to open SMTP connection ...`
- `Failed to send verification code email to ...`

## 6. 已处理的本地开发坑

### 6.1 `SECRET_KEY not found`

根因：
- `.env` 如果带 UTF-8 BOM，`python-decouple` 可能把第一行键名读坏
- 表现通常就是只有 `SECRET_KEY` 读取失败

当前处理：
- [`backend/EVE_MDjango/settings.py`](d:/Code/EVEM_Toolkits/backend/EVE_MDjango/settings.py) 先用 `utf-8-sig` 预读 `.env`
- 即使 `.env` 带 BOM，也会先把变量注入到 `os.environ`

### 6.2 `DEBUG=release` 导致启动失败

根因：
- 机器环境变量里残留了 `DEBUG=release`
- `decouple` 会优先读取环境变量，而不是 `.env`
- 默认 `cast=bool` 无法解析 `release`

当前处理：
- [`backend/EVE_MDjango/settings.py`](d:/Code/EVEM_Toolkits/backend/EVE_MDjango/settings.py) 改成了自定义 `parse_debug_flag`
- `release / production / prod` 会视为 `False`
- `debug / development / dev` 会视为 `True`

### 6.3 数据库认证失败

如果你看到：

```text
Access denied for user 'root' ...
```

说明：
- Django 已经走到数据库连接阶段
- 问题只剩数据库账号或密码不对

处理：
- 检查 [`backend/.env`](d:/Code/EVEM_Toolkits/backend/.env) 里的：
  - `DB_USER`
  - `DB_PASSWORD`
  - `DB_HOST`
  - `DB_PORT`

## 7. 建议的联调顺序

1. 先确认 `backend/.env`
2. 再启动 Django
3. 再启动 `front-codex`
4. 最后在浏览器 `Network` 中确认请求目标
5. 如果发邮件失败，去看后端终端或 [`backend/logs/dev.log`](d:/Code/EVEM_Toolkits/backend/logs/dev.log)
