import { useMutation } from "react-query";
import { register } from "../../services/apiAuthentication";
import { useNavigate } from "react-router-dom";
import { message } from "antd";
import { useContext } from "react";
import { AuthContext } from "../../context/AuthContext";

function useRegister({ setError }) {
  const navigate = useNavigate();
  const { login: loginAction } = useContext(AuthContext);

  return useMutation(register, {
    onSuccess: (data) => {
      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);
      message.success("注册成功");
      loginAction(true);
      navigate(-1);
    },
    onError: (error) => {
      const errorMessage = error.message; // 获取错误信息
      switch (errorMessage) {
        case "All fields must be filled and not empty.":
          setError("password", { message: "请填上所有必填信息" });
          break;

        case "Enter a valid email.":
          setError("email", { message: "邮箱格式错误" });
          break;

        case "Wrong Email verification code.":
          setError("emailVerification", { message: "邮箱验证码错误" });
          break;

        case "Username is already taken.":
          setError("userName", { message: "该用户名已被使用" });
          break;

        case "Email is already in use.":
          setError("email", { message: "该邮箱已被使用" });
          break;

        case "Enter a valid password.":
          setError("password", { message: "密码格式错误" });
          break;

        case "eve_id must be a numeric value with a maximum length of 15.":
          setError("eve_id", { message: "游戏ID格式错误" });
          break;

        default:
          setError("password", { message: errorMessage });
          break;
      }
    },
  });
}

export default useRegister;
