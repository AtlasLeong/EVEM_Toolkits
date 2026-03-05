# EVEM Toolkits

EVE Echoes Mobile (EVEM) 工具集 - 为 EVE Echoes 游戏玩家提供各类实用工具的全栈应用。

## 项目结构

```
EVEM_Toolkits/
├── backend/          # Django REST Framework 后端
├── frontend/         # Vue 3 前端
└── README.md         # 本文件
```

## 快速开始

### 后端启动

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env      # 配置环境变量
python manage.py migrate
python manage.py runserver
```

后端运行在 http://127.0.0.1:8000

### 前端启动

```bash
cd frontend
npm install
npm run dev
```

前端运行在 http://localhost:5173

## 功能模块

- 🔐 用户认证与授权
- 🌍 星域/星系/星座搜索
- 🪐 行星资源查询与方案管理
- 🗺️ 战术地图与 A* 路径规划
- 🛡️ 诈骗名单管理与举报
- 🎰 泛星集市数据分析
- 🔑 软件激活码管理

## 技术栈

**后端**: Django 4.2.5 + Django REST Framework + MySQL 8.0+ + JWT

**前端**: Vue 3 + Vite + Element Plus + Pinia

## 详细文档

- [后端文档](./backend/README.md)
- [前端文档](./frontend/README.md)

## 环境要求

- Python 3.10+
- Node.js 16+
- MySQL 8.0+

## 许可证

本项目仅供学习交流使用。

---

**注意**: 本项目为 EVE Echoes 游戏工具，与 CCP Games 无关。
