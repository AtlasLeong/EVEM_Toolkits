// 引入 React 的 createContext, useState, useEffect 方法
import { createContext, useState, useEffect } from "react";
// 引入 jwt-decode 库用于解码 JWT 令牌
import { jwtDecode } from "jwt-decode";
// 引入用于刷新访问令牌的服务函数
import { refreshAccessToken } from "../services/fetchWithAuth";

// 创建一个 React 上下文
const AuthContext = createContext();

// 创建 AuthProvider 组件，该组件用于包裹应用的根组件，提供认证相关的状态和操作
const AuthProvider = ({ children }) => {
  // 使用 useState 钩子来维护 isAuthenticated 状态，初始值为 false
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // 使用 useEffect 钩子来处理组件加载时的认证状态检查
  useEffect(() => {
    // 从本地存储中获取 access_token 和 refresh_token
    const access_token = localStorage.getItem("access_token");
    const refresh_token = localStorage.getItem("refresh_token");

    // 定义检查认证状态的异步函数
    const checkAuth = async () => {
      // 如果没有 refresh_token 或 access_token，设置 isAuthenticated 为 false
      if (!refresh_token || !access_token) {
        setIsAuthenticated(false);
        return;
      }

      try {
        // 使用 jwtDecode 解码 access_token
        const decodedToken = jwtDecode(access_token);
        // 获取当前时间（单位为秒）
        const currentTime = Date.now() / 1000;

        // 检查 access_token 是否过期
        if (decodedToken.exp < currentTime) {
          // 如果有 refresh_token，尝试刷新令牌
          try {
            // 调用 refreshAccessToken 函数刷新令牌
            const newTokens = await refreshAccessToken(refresh_token);
            localStorage.setItem("access_token", newTokens);
            setIsAuthenticated(true);
          } catch (error) {
            // 刷新令牌失败，输出错误信息并设置 isAuthenticated 为 false
            console.error("Error refreshing tokens:", error);
            setIsAuthenticated(false);
            localStorage.removeItem("access_token");
            localStorage.removeItem("refresh_token");
          }
        } else {
          // 如果 access_token 未过期，设置 isAuthenticated 为 true
          setIsAuthenticated(true);
        }
      } catch (error) {
        // 解码令牌失败，输出错误信息并设置 isAuthenticated 为 false
        console.error("Error decoding access token:", error);
        setIsAuthenticated(false);
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
      }
    };

    // 执行 checkAuth 函数
    checkAuth();
  }, []);

  // 定义 login 函数，用于设置 isAuthenticated 为 true
  const login = () => {
    setIsAuthenticated(true);
  };

  // 定义 logout 函数，用于登出操作，清除本地存储的令牌并设置 isAuthenticated 为 false
  const logout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  };

  // 返回 AuthContext.Provider 组件，传递 isAuthenticated, login, logout 状态和方法给子组件
  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// 导出 AuthContext 和 AuthProvider，以便在其他组件中使用
export { AuthContext, AuthProvider };
