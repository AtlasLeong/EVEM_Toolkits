# 生产部署说明

本文档按当前仓库结构编写，目标机器为已安装 `nginx` 的 Linux 服务器，项目目录假设为：

```text
/EVEMTK/EVEM_Toolkits
```

当前建议的生产结构：

- 前端：`front-codex`
- 后端：`backend`
- 反向代理：`nginx`
- 后端进程：`gunicorn + systemd`

不建议继续保留“`nginx:8000 -> uwsgi_pass 127.0.0.1:5000`”这层中转。现在仓库里没有 `uwsgi` 配置文件，也没有 `uwsgi` 依赖，直接用 `gunicorn` 更稳。

## 1. 目录约定

```text
/EVEMTK/EVEM_Toolkits/
├─ backend/
├─ front-codex/
├─ README.md
├─ LOCAL_DEV.md
└─ DEPLOY_PRODUCTION.md
```

前端最终构建目录：

```text
/EVEMTK/EVEM_Toolkits/front-codex/dist
```

后端静态目录：

```text
/EVEMTK/EVEM_Toolkits/backend/static
```

## 2. 首次部署前准备

### 2.1 系统依赖

CentOS / Rocky / AlmaLinux 常见依赖：

```bash
sudo yum install -y python3 python3-pip python3-devel gcc gcc-c++ make nginx git
sudo yum install -y mysql-devel
```

如果你的机器已经能跑当前 Django 项目，这一步通常已经完成。

### 2.2 Node.js

前端 `front-codex` 建议使用 Node.js 20+。

检查版本：

```bash
node -v
npm -v
```

### 2.3 Python 虚拟环境

建议后端单独使用虚拟环境：

```bash
cd /EVEMTK/EVEM_Toolkits/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install gunicorn
```

## 3. 后端环境变量

后端读取：

```text
/EVEMTK/EVEM_Toolkits/backend/.env
```

生产环境建议内容：

```env
SECRET_KEY=改成你自己的生产密钥
DEBUG=False

DB_NAME=eve_echoes_v2
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_HOST=8.134.144.49
DB_PORT=3306

EMAIL_HOST_USER=EVEMTK@163.com
EMAIL_HOST_PASSWORD=你的163邮箱SMTP授权码
```

注意：

- `DEBUG=False`
- `EMAIL_HOST_PASSWORD` 应该是 SMTP 授权码，不是邮箱网页登录密码
- 当前后端已经修过 `.env` BOM 读取问题，但仍然建议用纯 UTF-8 保存

## 4. 前端环境变量

前端构建时读取：

```text
/EVEMTK/EVEM_Toolkits/front-codex/.env.production.local
```

建议内容：

```env
VITE_API_URL=https://evemtk.com/api
```

如果你的域名不是 `evemtk.com`，改成对应域名即可。

## 5. 首次部署步骤

### 5.1 拉取代码

```bash
cd /EVEMTK/EVEM_Toolkits
git pull origin master
```

### 5.2 部署后端

```bash
cd /EVEMTK/EVEM_Toolkits/backend
source .venv/bin/activate
pip install -r requirements.txt
pip install gunicorn
python manage.py migrate
python manage.py test FraudList.tests
```

说明：

- 当前项目没有配置 `STATIC_ROOT`，所以不要直接跑 `collectstatic`
- `/static/` 直接由仓库内 `backend/static` 提供

### 5.3 部署前端

```bash
cd /EVEMTK/EVEM_Toolkits/front-codex
npm ci
npm run build
```

构建完成后，前端静态文件就在：

```text
/EVEMTK/EVEM_Toolkits/front-codex/dist
```

## 6. systemd 配置后端

创建服务文件：

```bash
sudo vi /etc/systemd/system/evem-backend.service
```

内容：

```ini
[Unit]
Description=EVEM Toolkits Django Backend
After=network.target

[Service]
User=nginx
Group=nginx
WorkingDirectory=/EVEMTK/EVEM_Toolkits/backend
Environment="PATH=/EVEMTK/EVEM_Toolkits/backend/.venv/bin"
ExecStart=/EVEMTK/EVEM_Toolkits/backend/.venv/bin/gunicorn \
  --workers 3 \
  --bind 127.0.0.1:8000 \
  EVE_MDjango.wsgi:application
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable evem-backend
sudo systemctl restart evem-backend
sudo systemctl status evem-backend
```

## 7. Nginx 配置

不建议继续把 Django 先挂到 `nginx:8000 -> uwsgi_pass 127.0.0.1:5000`。

建议改成：

- `gunicorn` 直接监听 `127.0.0.1:8000`
- 443 站点直接代理 `/api/` 和 `/admin/`
- 前端静态站点直接指向 `front-codex/dist`

### 7.1 推荐拆成独立站点配置

创建：

```bash
sudo vi /etc/nginx/conf.d/evemtk.conf
```

内容：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name evemtk.com www.evemtk.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name evemtk.com www.evemtk.com;

    ssl_certificate     /EVEMTK/ssl/evemtk.com.pem;
    ssl_certificate_key /EVEMTK/ssl/evemtk.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    root /EVEMTK/EVEM_Toolkits/front-codex/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /static/ {
        alias /EVEMTK/EVEM_Toolkits/backend/static/;
        try_files $uri $uri/ =404;
    }
}
```

### 7.2 检查并重载

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 8. 你当前旧 Nginx 配置应该怎么改

你现在旧配置里这两块已经过时：

1. 前端根目录还是旧的：

```nginx
root /EVEMTK/font-EVEMTK-dist;
```

现在应该改成：

```nginx
root /EVEMTK/EVEM_Toolkits/front-codex/dist;
```

2. 后端走的是 `uwsgi_pass 127.0.0.1:5000`

如果你按本文档切到 `gunicorn`，这整个 `listen 8000` 的 server 可以直接删除，不再需要中间那层 Nginx。

你最终只需要保留：

- `80 -> 443`
- `443` 主站

并让 `/api/` 与 `/admin/` 直接反代到：

```nginx
proxy_pass http://127.0.0.1:8000;
```

## 9. 以后每次 git pull 后如何更新

以后更新只按这个顺序执行：

### 9.1 拉代码

```bash
cd /EVEMTK/EVEM_Toolkits
git pull origin master
```

### 9.2 更新后端

```bash
cd /EVEMTK/EVEM_Toolkits/backend
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py test FraudList.tests
sudo systemctl restart evem-backend
```

### 9.3 更新前端

```bash
cd /EVEMTK/EVEM_Toolkits/front-codex
npm ci
npm run build
```

### 9.4 重载 Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 10. 发布后自检

### 10.1 后端服务

```bash
sudo systemctl status evem-backend
curl http://127.0.0.1:8000/api/boardregions
```

### 10.2 前端首页

浏览器访问：

```text
https://evemtk.com
```

### 10.3 API

浏览器或 curl 检查：

```bash
curl https://evemtk.com/api/boardregions
```

### 10.4 登录和管理员

重点手测：

- 普通登录
- 防诈名单查询
- 举报提交
- 行星资源查询与计算器
- 管理员登录
- 审核举报

## 11. 日志位置

### Django 日志

```text
/EVEMTK/EVEM_Toolkits/backend/logs/dev.log
```

### Gunicorn / systemd

```bash
sudo journalctl -u evem-backend -f
```

### Nginx

```text
/var/log/nginx/access.log
/var/log/nginx/error.log
```

如果你继续沿用自己 `nginx.conf` 里的自定义日志路径，也可以保持：

```text
/EVEMTK/EVEM_Toolkits_Back/access_nginx.log
/EVEMTK/EVEM_Toolkits_Back/error_nginx.log
```

但建议统一回标准位置，维护更简单。

## 12. 常见问题

### 12.1 前端页面更新了，但线上还是旧页面

通常是这几个原因：

- 没有重新执行 `npm run build`
- Nginx `root` 还指向旧目录
- 浏览器缓存没清

### 12.2 后端启动失败

先看：

```bash
sudo journalctl -u evem-backend -n 200 --no-pager
```

再看：

```text
/EVEMTK/EVEM_Toolkits/backend/logs/dev.log
```

### 12.3 邮件发不出去

检查 `.env`：

- `EMAIL_HOST_USER`
- `EMAIL_HOST_PASSWORD`

163 邮箱这里必须用 SMTP 授权码。

### 12.4 数据库连接失败

检查 `.env`：

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

## 13. 推荐的最终线上结构

```text
nginx(443)
  ├─ /           -> /EVEMTK/EVEM_Toolkits/front-codex/dist
  ├─ /api/       -> 127.0.0.1:8000
  ├─ /admin/     -> 127.0.0.1:8000
  └─ /static/    -> /EVEMTK/EVEM_Toolkits/backend/static/

gunicorn
  └─ Django backend (127.0.0.1:8000)
```

这是当前项目最直接、最少层级、最容易维护的部署方式。
