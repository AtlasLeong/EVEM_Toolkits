import { useNavigate } from "react-router-dom";
import LoginPage from "../features/Authentication/LoginPage";
import { AuthContext } from "../context/AuthContext";
import { useContext, useEffect } from "react";

function Login() {
  const { isAuthenticated: isLogin } = useContext(AuthContext);
  const navigate = useNavigate();

  // 使用 useEffect 钩子来处理重定向逻辑
  useEffect(() => {
    if (isLogin) {
      navigate("/");
    }
  }, [isLogin, navigate]); // 添加依赖项，确保只在 isLogin 或 navigate 变化时执行
  return (
    <>
      <LoginPage />
    </>
  );
}

export default Login;
