# EVEM Toolkits

- 本地开发与联调说明：[LOCAL_DEV.md](./LOCAL_DEV.md)
- 生产部署说明：[DEPLOY_PRODUCTION.md](./DEPLOY_PRODUCTION.md)
- 自动化测试说明：[front-codex/AUTOMATION_TESTS.md](./front-codex/AUTOMATION_TESTS.md)
- 手动测试清单：[front-codex/TEST_CHECKLIST.md](./front-codex/TEST_CHECKLIST.md)
- 测试覆盖对照表：[front-codex/TEST_CHECKLIST_MATRIX.md](./front-codex/TEST_CHECKLIST_MATRIX.md)

EVEM Toolkits 是一套面向 EVE Echoes 玩家和群组管理者的全栈工具集合，覆盖诈骗名单、行星资源、星系导航、集市分析和激活码等功能。

## 项目结构

```text
EVEM_Toolkits/
├─ backend/         Django REST Framework 后端
├─ frontend/        旧版前端
├─ front-codex/     当前重构后的前端
├─ LOCAL_DEV.md     本地开发说明
└─ README.md        项目说明
```

## 快速开始

### 后端启动

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

后端默认运行在 `http://127.0.0.1:8000`。

### 当前前端启动

```bash
cd front-codex
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`。

## 主要功能

- 用户认证、注册、找回密码
- 防诈名单查询、举报、管理员审核
- 行星资源查询、预设价格、计算器与方案管理
- 星系导航、星图交互与路径规划
- 集市分析与价格数据展示
- 激活码相关功能

## 技术栈

**后端**：Django 4.2 + Django REST Framework + MySQL + JWT  
**前端**：React + Vite + TanStack Query + Playwright

## 文档

- [后端说明](./backend/README.md)
- [旧版前端说明](./frontend/README.md)
- [重构前端自动化说明](./front-codex/AUTOMATION_TESTS.md)

## 环境要求

- Python 3.11+
- Node.js 20+
- MySQL 8.0+

## 说明

本项目仅用于学习、联调和工具开发。

---

本项目为 EVE Echoes 游戏工具，与 CCP Games 无官方关联。
