# EVEM Toolkits Frontend

EVE Echoes Mobile 工具集前端 - 基于 React + Vite 的现代化单页应用。

## 技术栈

- **React 18.2** - UI 框架
- **Vite 5.2** - 构建工具
- **React Router 6** - 路由管理
- **React Query 3** - 服务端状态管理
- **Styled Components** - CSS-in-JS
- **Ant Design** - 桌面端 UI 组件库
- **Ant Design Mobile** - 移动端 UI 组件库
- **Axios** - HTTP 客户端
- **React Hook Form** - 表单处理
- **Three.js / PixiJS / deck.gl** - 3D 可视化

## 快速开始

### 安装依赖
```bash
npm install
```

### 开发模式
```bash
npm run dev
```
访问 http://localhost:5173

### 生产构建
```bash
npm run build
npm run preview
```

### 代码检查
```bash
npm run lint
```

## 项目结构

```
frontend/
├── src/
│   ├── pages/              # 页面组件
│   │   ├── Planetary.jsx   # 行星资源
│   │   ├── FraudList.jsx   # 诈骗名单
│   │   ├── Bazaar.jsx      # 泛星集市
│   │   ├── TacticalBoard.jsx  # 战术地图
│   │   ├── Setting.jsx     # 用户设置
│   │   └── Login.jsx       # 登录页
│   ├── features/           # 功能模块
│   │   ├── Authentication/ # 认证相关
│   │   ├── PlanetaryResource/  # 行星资源
│   │   ├── FraudList/      # 诈骗名单
│   │   ├── Bazaar/         # 集市
│   │   ├── TacticalBoard/  # 战术地图
│   │   └── Settings/       # 设置
│   ├── services/           # API 服务
│   │   ├── apiAuthentication.js
│   │   ├── apiPlanetaryResource.js
│   │   ├── apiFraudList.js
│   │   ├── apiBazaar.js
│   │   ├── apiTacticalBoard.js
│   │   ├── backendSetting.js  # API 配置
│   │   └── fetchWithAuth.js   # 认证请求封装
│   ├── context/            # React Context
│   │   ├── AuthContext.jsx     # 认证状态
│   │   ├── IsMobileContext.jsx # 移动端检测
│   │   └── SearchContext.jsx   # 搜索状态
│   ├── hooks/              # 自定义 Hooks
│   ├── ui/                 # 通用 UI 组件
│   └── styles/             # 全局样式
├── public/                 # 静态资源
├── vite.config.js          # Vite 配置
└── package.json
```

## 功能模块

### 1. 用户认证 (Authentication)
- 用户注册/登录
- JWT Token 管理
- 邮箱验证码
- 密码修改/找回
- 自动 Token 刷新

### 2. 行星资源 (PlanetaryResource)
- 多维度资源搜索（星域/星座/星系）
- 资源产量排名
- 方案保存与管理（最多10个）
- 自定义价格设置
- 收益计算器

### 3. 诈骗名单 (FraudList)
- 诈骗账号搜索
- 用户举报功能
- 证据上传（图片）
- 管理员审核系统
- 举报历史查询

### 4. 战术地图 (TacticalBoard)
- 3D 星系地图可视化
- A* 路径规划
- 诱导跳跃计算
- 安全/不安全路径
- 植入体经验计算器

### 5. 泛星集市 (Bazaar)
- 幸运箱数据展示
- 期望值计算
- 历史数据图表
- 排名查询

### 6. 用户设置 (Settings)
- 密码修改
- 自定义资源价格
- 个人信息管理

## API 配置

编辑 `src/services/backendSetting.js`:
```javascript
const API_URL = "http://your-backend-url:8000/api";
export default API_URL;
```

**建议**: 使用环境变量管理 API 地址（见优化建议）。

## 响应式设计

项目支持桌面端和移动端：
- 使用 `IsMobileContext` 检测设备类型
- 移动端使用 Ant Design Mobile 组件
- 独立的移动端页面和组件

## 状态管理

### React Query
用于服务端状态管理，配置了 180 秒缓存时间：
```javascript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 180 * 1000,
    },
  },
});
```

### Context API
- **AuthContext**: 管理用户认证状态和 JWT Token
- **IsMobileContext**: 检测移动端/桌面端
- **SearchContext**: 共享搜索状态

## 路由配置

主要路由：
- `/` - 重定向到诈骗名单
- `/planetary` - 行星资源
- `/fraudlist` - 诈骗名单
- `/bazaar` - 泛星集市
- `/starmap` - 战术地图
- `/usersetting` - 用户设置
- `/login` - 登录页

## 开发指南

### 添加新功能

1. 在 `src/features/` 创建功能目录
2. 创建自定义 Hook 处理 API 调用
3. 创建组件文件
4. 在 `src/services/` 添加 API 函数
5. 在 `src/pages/` 创建页面
6. 在 `App.jsx` 添加路由

### API 调用模式

使用自定义 Hook + React Query：
```javascript
// src/features/Example/useExample.js
import { useQuery } from 'react-query';
import { getExample } from '../../services/apiExample';

export function useExample() {
  return useQuery(['example'], getExample);
}

// 组件中使用
const { data, isLoading, error } = useExample();
```

### 认证请求

使用 `fetchWithAuth` 自动添加 JWT Token：
```javascript
import fetchWithAuth from './fetchWithAuth';

export async function getProtectedData() {
  const response = await fetchWithAuth(`${API_URL}/protected`);
  return response.data;
}
```

## 构建部署

### 生产构建
```bash
npm run build
```
构建产物在 `dist/` 目录。

### Nginx 配置示例
```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://backend:8000;
    }
}
```

## 常见问题

### Q1: API 请求失败
检查 `src/services/backendSetting.js` 中的 API_URL 是否正确。

### Q2: Token 过期
AuthContext 会自动刷新 Token，如果刷新失败会跳转到登录页。

### Q3: 移动端样式问题
确保使用 `IsMobileContext` 判断设备类型，移动端使用 Ant Design Mobile 组件。

## 浏览器支持

- Chrome (推荐)
- Firefox
- Safari
- Edge

需要支持 ES6+ 和 WebGL（战术地图功能）。

## 许可证

本项目仅供学习交流使用。
