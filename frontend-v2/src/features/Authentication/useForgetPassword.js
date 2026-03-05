import { useMutation } from '@tanstack/react-query';
import { forgetPassword } from "../../services/apiAuthentication";
import { message } from "antd";

function useForgetPassword({ setError, setIsForgetPassword, resetLogin }) {
  return useMutation({
    mutationFn: ({
      forgetEmail = null,
      forgetEmailVerification = null,
      forgetNewPassword = null,
      forgetConfirmPassword = null,
    }) =>
      forgetPassword({
        forgetEmail,
        forgetEmailVerification,
        forgetNewPassword,
        forgetConfirmPassword,
      }),

    onSuccess: (data) => {
      // 处理成功返回的数据，例如显示错误信息
      message.success("成功修改密码");
      setIsForgetPassword(false);
      resetLogin();
    },

    onError: (error) => {
      // 处理错误情况
      const errorMessage = error.message;
      switch (errorMessage) {
        case "All fields must be filled and not empty.":
          setError("forgetConfirmPassword", { message: "有选项未填写" });
          break;
        case "Enter a valid email.":
          setError("forgetEmail", { message: "邮箱格式错误" });
          break;
        case "Enter a valid password.":
          setError("forgetNewPassword", { message: "密码格式错误" });
          break;
        case "Wrong Email verification code.":
          setError("forgetEmailVerification", { message: "邮箱验证码错误" });
          break;

        case "Email has not been signup.":
          setError("forgetEmail", { message: "邮箱未被注册" });
          break;
        case "confirm Password failed.":
          setError("forgetConfirmPassword", { message: "两次密码输入不一致" });
          break;

        default:
          message.error("修改密码失败");
      }
    },
  });
}

export default useForgetPassword;
