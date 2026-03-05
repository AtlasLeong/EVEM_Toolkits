# EVEM Toolkits Backend

EVE Echoes Mobile (EVEM) 工具集后端服务 - 为 EVE Echoes 游戏玩家提供各类实用工具的 RESTful API 服务。

## 📋 目录

- [项目简介](#项目简介)
- [技术栈](#技术栈)
- [功能模块](#功能模块)
- [快速开始](#快速开始)
- [环境配置](#环境配置)
- [数据库设置](#数据库设置)
- [API 文档](#api-文档)
- [开发指南](#开发指南)
- [部署说明](#部署说明)
- [常见问题](#常见问题)

## 项目简介

EVEM Toolkits Backend 是一个基于 Django REST Framework 的后端服务，为 EVE Echoes 游戏玩家提供：

- 🔐 用户认证与授权系统
- 🌍 星域/星系/星座搜索
- 🪐 行星资源查询与方案管理
- 🗺️ 战术地图与 A* 路径规划
- 🛡️ 诈骗名单管理与举报系统
- 🎰 泛星集市数据分析
- 🔑 软件激活码管理

## 技术栈

### 核心框架
- **Django 4.2.5** - Web 框架
- **Django REST Framework 3.15.1** - RESTful API
- **djangorestframework-simplejwt 5.3.1** - JWT 认证

### 数据库
- **MySQL 8.0+** - 主数据库
- **mysqlclient 2.2.0** - MySQL 驱动

### 其他依赖
- **django-cors-headers 4.3.1** - CORS 支持
- **python-decouple** - 环境变量管理
- **pandas, numpy** - 数据处理
- **requests** - HTTP 请求

## 功能模块

### 1. Authentication（用户认证）
**路由前缀**: `/api/user/`

- 用户注册/登录
- JWT Token 刷新
- 邮箱验证码
- 密码修改/找回
- 自定义用户模型（EVEMUser）

**特性**:
- 邮箱唯一性验证
- 验证码频率限制（1次/分钟，5次/天）
- 支持 EVE ID 绑定

### 2. ActivationCode（激活码管理）
**路由前缀**: `/api/activationcode/`

- 激活码生成（需管理员权限）
- 激活码验证
- PC 设备绑定

**特性**:
- UUID 生成唯一激活码
- 时间限制与设备绑定
- 防止重复激活

### 3. StarFieldSearch（星域搜索）
**路由前缀**: `/api/`

- 星域（Region）查询
- 星座（Constellation）查询
- 星系（Solar System）查询

**特性**:
- 中英文名称支持
- 安全等级过滤
- 关联查询优化

### 4. PlanetaryResource（行星资源）
**路由前缀**: `/api/`

- 行星资源搜索
- 资源产量排名
- 用户方案保存
- 自定义价格设置

**特性**:
- 30+ 种资源类型
- 多维度筛选（星域/星座/星系）
- 方案管理（最多10个）
- 价格计算

### 5. TacticalBoard（战术地图）
**路由前缀**: `/api/`

- 星系坐标数据
- 星门连接关系
- A* 路径规划

**特性**:
- 支持诱导跳跃计算
- 安全/不安全路径规划
- 新八星域跨越检测
- 移动类型识别（土路/安全诱导/不安全诱导）

### 6. FraudList（诈骗名单）
**路由前缀**: `/api/`

- 诈骗账号搜索
- 管理员审核系统
- 用户举报功能
- 证据上传（图片）

**特性**:
- 权限组管理
- 操作日志记录
- 文件去重（MD5）
- 每日上传限制（15张）

### 7. Bazaar（泛星集市）
**路由前缀**: `/api/`

- 幸运箱数据
- 排名查询
- 期望值计算

## 快速开始

### 前置要求

- Python 3.10+
- MySQL 8.0+
- pip

### 安装步骤

1. **克隆项目**
```bash
git clone <repository-url>
cd EVEM_Toolkits_Back
```

2. **创建虚拟环境**
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或
venv\Scripts\activate  # Windows
```

3. **安装依赖**
```bash
pip install -r requirements.txt
```

4. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，填入实际配置
```

5. **数据库迁移**
```bash
python manage.py migrate
```

6. **创建超级用户**
```bash
python manage.py createsuperuser
```

7. **启动开发服务器**
```bash
python manage.py runserver
```

访问 http://127.0.0.1:8000/admin/ 进入管理后台。

## 环境配置

### .env 文件配置

创建 `.env` 文件（参考 `.env.example`）：

```env
# Django Settings
SECRET_KEY=your-secret-key-here
DEBUG=True

# Database
DB_NAME=eve_echoes_v2
DB_USER=root
DB_PASSWORD=your-password
DB_HOST=localhost
DB_PORT=3306

# Email
EMAIL_HOST_USER=your-email@163.com
EMAIL_HOST_PASSWORD=your-email-password
```

### 配置说明

| 配置项 | 说明 | 示例 |
|--------|------|------|
| SECRET_KEY | Django 密钥 | 随机生成的长字符串 |
| DEBUG | 调试模式 | True/False |
| DB_NAME | 数据库名 | eve_echoes_v2 |
| DB_USER | 数据库用户 | root |
| DB_PASSWORD | 数据库密码 | - |
| DB_HOST | 数据库主机 | localhost 或 IP |
| DB_PORT | 数据库端口 | 3306 |
| EMAIL_HOST_USER | 邮箱账号 | xxx@163.com |
| EMAIL_HOST_PASSWORD | 邮箱授权码 | - |

## 数据库设置

### 数据库结构

项目使用混合管理模式：
- **Django 管理表**: `Authentication`, `ActivationCode`, `PlanetaryProgramme` 等
- **外部数据表**: `StarFieldSearch`, `TacticalBoard`, `Bazaar` 等（`managed=False`）

### 初始化数据库

```bash
# 创建数据库
mysql -u root -p -e "CREATE DATABASE eve_echoes_v2 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 执行迁移
python manage.py migrate

# 导入外部数据（如果有）
mysql -u root -p eve_echoes_v2 < data/initial_data.sql
```

### 数据库备份

```bash
# 备份
mysqldump -u root -p eve_echoes_v2 > backup_$(date +%Y%m%d).sql

# 恢复
mysql -u root -p eve_echoes_v2 < backup_20260305.sql
```

## API 文档

### 认证方式

所有需要认证的接口使用 JWT Bearer Token：

```http
Authorization: Bearer <access_token>
```

### 获取 Token

**POST** `/api/user/login`

```json
{
  "login_email": "user@example.com",
  "login_password": "password"
}
```

**响应**:
```json
{
  "message": "Login successful",
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

### 刷新 Token

**POST** `/api/user/token/refresh`

```json
{
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

### 主要接口列表

#### 用户认证
- `POST /api/user/register` - 用户注册
- `POST /api/user/login` - 用户登录
- `POST /api/user/emailcode` - 发送邮箱验证码
- `POST /api/user/signupcheck` - 检查用户名/邮箱是否可用
- `POST /api/user/changepwd` - 修改密码（需认证）
- `POST /api/user/forgetPassword` - 忘记密码

#### 行星资源
- `POST /api/planetary-resource` - 搜索行星资源
- `GET /api/planet-resource-list` - 获取资源列表
- `GET /api/planetary-programme` - 获取用户方案（需认证）
- `POST /api/planetary-programme` - 保存方案（需认证）
- `DELETE /api/planetary-programme` - 删除方案（需认证）

#### 战术地图
- `GET /api/board-systems` - 获取星系坐标
- `GET /api/board-stargates` - 获取星门数据
- `POST /api/astar-location` - A* 路径规划

#### 诈骗名单
- `POST /api/fraudsearch` - 搜索诈骗账号
- `GET /api/fraudadmincheck` - 检查管理员权限（需认证）
- `GET /api/fraudadminlist` - 获取管理的诈骗列表（需认证）
- `POST /api/fraudadminlist` - 添加诈骗记录（需认证）
- `POST /api/uploadimage/` - 上传证据图片（需认证）
- `POST /api/fraudlistreport` - 提交举报（需认证）

#### 激活码
- `POST /api/activationcode/generate-code/` - 生成激活码（需管理员）
- `POST /api/activationcode/validate-code/` - 验证激活码

## 开发指南

### 项目结构

```
EVEM_Toolkits_Back/
├── EVE_MDjango/          # 项目配置
│   ├── settings.py       # 设置（使用环境变量）
│   ├── urls.py           # 主路由
│   └── EmailBackend.py   # 自定义邮件后端
├── Authentication/       # 用户认证模块
│   ├── models.py         # EVEMUser 模型
│   ├── views.py          # 认证视图
│   ├── serializers.py    # 序列化器
│   ├── throttle.py       # 频率限制
│   └── urls.py           # 路由
├── ActivationCode/       # 激活码模块
├── StarFieldSearch/      # 星域搜索模块
├── PlanetaryResource/    # 行星资源模块
├── TacticalBoard/        # 战术地图模块
│   └── A_Star.py         # A* 算法实现
├── FraudList/            # 诈骗名单模块
│   ├── permissions.py    # 权限检查
│   └── migrations/       # 数据库迁移
├── Bazaar/               # 集市模块
├── static/               # 静态文件
├── manage.py             # Django 管理脚本
├── requirements.txt      # 依赖列表
├── .env                  # 环境变量（不提交）
├── .env.example          # 环境变量模板
├── CLAUDE.md             # Claude Code 指南
└── README.md             # 项目文档
```

### 代码规范

1. **模型定义**
   - 使用 `managed = False` 标记外部管理的表
   - 添加 `db_table` 明确指定表名
   - 使用中文注释说明字段用途

2. **视图编写**
   - 继承 `APIView` 或使用 `@api_view` 装饰器
   - 使用 `@staticmethod` 标记静态方法
   - 添加适当的权限类 `permission_classes`

3. **序列化器**
   - 继承 `serializers.ModelSerializer`
   - 明确指定 `fields` 或 `exclude`
   - 添加自定义验证方法

4. **权限控制**
   - 使用 `IsAuthenticated` 要求登录
   - 自定义权限类继承 `BasePermission`
   - 在视图中检查用户权限组

### 添加新功能

1. **创建新应用**
```bash
python manage.py startapp NewApp
```

2. **注册应用**
在 `settings.py` 的 `INSTALLED_APPS` 中添加：
```python
INSTALLED_APPS = [
    ...
    'NewApp',
]
```

3. **定义模型**
```python
# NewApp/models.py
from django.db import models

class NewModel(models.Model):
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'new_model'
```

4. **创建迁移**
```bash
python manage.py makemigrations NewApp
python manage.py migrate NewApp
```

5. **编写视图和序列化器**
```python
# NewApp/serializers.py
from rest_framework import serializers
from .models import NewModel

class NewModelSerializer(serializers.ModelSerializer):
    class Meta:
        model = NewModel
        fields = '__all__'

# NewApp/views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import NewModel
from .serializers import NewModelSerializer

class NewModelView(APIView):
    def get(self, request):
        items = NewModel.objects.all()
        serializer = NewModelSerializer(items, many=True)
        return Response(serializer.data)
```

6. **配置路由**
```python
# NewApp/urls.py
from django.urls import path
from .views import NewModelView

urlpatterns = [
    path('items/', NewModelView.as_view(), name='new_model_list'),
]

# EVE_MDjango/urls.py
urlpatterns = [
    ...
    path('api/', include('NewApp.urls')),
]
```

### 测试

```bash
# 运行所有测试
python manage.py test

# 运行特定应用测试
python manage.py test Authentication

# 运行特定测试类
python manage.py test Authentication.tests.RegisterViewTest
```

### 数据库迁移

```bash
# 查看迁移状态
python manage.py showmigrations

# 创建迁移
python manage.py makemigrations

# 应用迁移
python manage.py migrate

# 回滚迁移
python manage.py migrate AppName 0001_initial

# 查看迁移 SQL
python manage.py sqlmigrate AppName 0001
```


## 部署说明

### 生产环境部署

1. **服务器要求**
   - Ubuntu 20.04+ / CentOS 7+
   - Python 3.10+
   - MySQL 8.0+
   - Nginx (推荐)
   - 至少 2GB RAM

2. **安装系统依赖**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install python3-pip python3-venv mysql-server nginx

# CentOS/RHEL
sudo yum install python3 python3-pip mysql-server nginx
```

3. **配置 MySQL**
```bash
sudo mysql_secure_installation
mysql -u root -p

CREATE DATABASE eve_echoes_v2 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'evem_user'@'localhost' IDENTIFIED BY 'strong_password';
GRANT ALL PRIVILEGES ON eve_echoes_v2.* TO 'evem_user'@'localhost';
FLUSH PRIVILEGES;
```

4. **部署应用**
```bash
cd /var/www
git clone <repository-url> evem_backend
cd evem_backend

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
nano .env  # 编辑配置

# 收集静态文件
python manage.py collectstatic --noinput

# 数据库迁移
python manage.py migrate
```

5. **使用 Gunicorn**
```bash
pip install gunicorn

# 测试运行
gunicorn EVE_MDjango.wsgi:application --bind 0.0.0.0:8000

# 创建 systemd 服务
sudo nano /etc/systemd/system/evem.service
```

**evem.service 内容**:
```ini
[Unit]
Description=EVEM Toolkits Backend
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/evem_backend
Environment="PATH=/var/www/evem_backend/venv/bin"
ExecStart=/var/www/evem_backend/venv/bin/gunicorn \
          --workers 3 \
          --bind unix:/var/www/evem_backend/evem.sock \
          EVE_MDjango.wsgi:application

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl start evem
sudo systemctl enable evem
```

6. **配置 Nginx**
```bash
sudo nano /etc/nginx/sites-available/evem
```

**Nginx 配置**:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /static/ {
        alias /var/www/evem_backend/static/;
    }

    location / {
        proxy_pass http://unix:/var/www/evem_backend/evem.sock;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/evem /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

7. **配置 SSL (Let's Encrypt)**
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### Docker 部署

**Dockerfile**:
```dockerfile
FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    default-libmysqlclient-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "EVE_MDjango.wsgi:application"]
```

**docker-compose.yml**:
```yaml
version: '3.8'

services:
  db:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: eve_echoes_v2
      MYSQL_ROOT_PASSWORD: ${DB_PASSWORD}
    volumes:
      - mysql_data:/var/lib/mysql
    ports:
      - "3306:3306"

  web:
    build: .
    command: gunicorn EVE_MDjango.wsgi:application --bind 0.0.0.0:8000
    volumes:
      - .:/app
      - static_volume:/app/static
    ports:
      - "8000:8000"
    env_file:
      - .env
    depends_on:
      - db

  nginx:
    image: nginx:alpine
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - static_volume:/app/static
    ports:
      - "80:80"
    depends_on:
      - web

volumes:
  mysql_data:
  static_volume:
```

```bash
docker-compose up -d
```

## 常见问题

### Q1: 数据库连接失败

**错误**: `Access denied for user 'root'@'hostname'`

**解决**:
1. 检查 `.env` 文件中的数据库配置
2. 确认 MySQL 用户权限：
```sql
GRANT ALL PRIVILEGES ON eve_echoes_v2.* TO 'root'@'%' IDENTIFIED BY 'password';
FLUSH PRIVILEGES;
```
3. 检查防火墙是否开放 3306 端口

### Q2: 邮件发送失败

**错误**: `SMTPAuthenticationError`

**解决**:
1. 确认使用的是邮箱授权码，不是登录密码
2. 163 邮箱需要开启 SMTP 服务
3. 检查 `EMAIL_HOST_PASSWORD` 配置

### Q3: 静态文件 404

**错误**: 静态文件无法访问

**解决**:
```bash
python manage.py collectstatic
```
确保 Nginx 配置了正确的 static 路径。

### Q4: CORS 错误

**错误**: `Access-Control-Allow-Origin`

**解决**:
项目已配置 `CORS_ALLOW_ALL_ORIGINS = True`，如需限制：
```python
# settings.py
CORS_ALLOWED_ORIGINS = [
    "https://your-frontend.com",
]
```

### Q5: JWT Token 过期

**错误**: `Token is invalid or expired`

**解决**:
使用 refresh token 刷新：
```http
POST /api/user/token/refresh
{
  "refresh": "your_refresh_token"
}
```

### Q6: 迁移冲突

**错误**: `Conflicting migrations detected`

**解决**:
```bash
python manage.py makemigrations --merge
python manage.py migrate
```

### Q7: 文件上传失败

**错误**: 上传图片返回 500

**解决**:
1. 确保 `static/uploads/fraudlist_evidence/` 目录存在
2. 检查目录权限：
```bash
chmod 755 static/uploads/fraudlist_evidence/
```

### Q8: 性能问题

**症状**: 接口响应慢

**优化**:
1. 启用数据库查询缓存
2. 使用 Redis 缓存热点数据
3. 优化数据库索引
4. 增加 Gunicorn workers 数量

## 安全建议

1. **生产环境设置**
   - 设置 `DEBUG = False`
   - 使用强密码和随机 SECRET_KEY
   - 限制 `ALLOWED_HOSTS`

2. **数据库安全**
   - 不使用 root 用户
   - 定期备份数据库
   - 限制远程访问

3. **API 安全**
   - 启用 HTTPS
   - 配置合理的频率限制
   - 验证所有用户输入

4. **文件上传**
   - 限制文件类型和大小
   - 使用 MD5 去重
   - 定期清理过期文件

## 版本历史

### v2.0 (2026-03-05)
- ✅ 环境变量管理（移除硬编码密码）
- ✅ 文件上传 MD5 哈希优化
- ✅ 权限检查代码重构
- ✅ 修复邮箱验证码异常
- ✅ 修复权限漏洞
- ✅ 查询性能优化
- ✅ 删除调试代码

### v1.0
- 初始版本
- 基础功能实现

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

本项目仅供学习交流使用。

## 联系方式

- 项目地址: [GitHub Repository]
- 问题反馈: [Issues]

---

**注意**: 本项目为 EVE Echoes 游戏工具，与 CCP Games 无关。
