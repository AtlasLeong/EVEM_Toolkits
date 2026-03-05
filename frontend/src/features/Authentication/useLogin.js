import { useMutation } from "react-query";
import { login } from "../../services/apiAuthentication";
import { useNavigate } from "react-router-dom";
import { useContext } from "react";
import { AuthContext } from "../../context/AuthContext";
import { message } from "antd";

function useLogin({ setError }) {
  const navigate = useNavigate();
  const { login: loginAction } = useContext(AuthContext);

  return useMutation(login, {
    onSuccess: (data) => {
      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);
      message.success("登录成功");
      loginAction();
      navigate("/");
    },
    onError: (error) => {
      const errorMessage = error.message; // 获取错误信息

      switch (errorMessage) {
        case "All fields must be filled and not empty.":
          setError("login_password", { message: "请填上所有必填信息" });
          break;

        case "Invalid email or password.":
          setError("login_email", { message: "邮箱或密码错误！" });
          break;

        default:
          setError("login_password", { message: errorMessage });
          break;
      }
    },
  });
}

export default useLogin;
