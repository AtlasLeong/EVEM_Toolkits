import { useMutation } from '@tanstack/react-query';
import { fraudAdminLogin } from "../../services/apiFraudList";
import { message } from "antd";
import { useContext } from "react";
import { AuthContext } from "../../context/AuthContext";

function useFraudAdminLogin({ setError }) {
  const { login: loginAction } = useContext(AuthContext);

  return useMutation({
    mutationFn: fraudAdminLogin,
    onSuccess: (data) => {
      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);
      loginAction();
      message.success("登录成功");
    },
    onError: (error) => {
      const errorMessage = error.message; // 获取错误信息
      switch (errorMessage) {
        case "Invalid email or password.":
          setError("adminPassword", { message: "密码错误" });
          break;
        default:
          setError("adminPassword", { message: errorMessage });
          break;
      }
    },
  });
}

export default useFraudAdminLogin;
