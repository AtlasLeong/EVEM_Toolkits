import { useMutation } from '@tanstack/react-query';
import { changePassword } from "../../services/apiAuthentication";
import { message } from "antd";

function useChangePassword({ setError, reset }) {
  return useMutation({
    mutationFn: ({ oldPassword, newPassword, confirmPassword }) =>
      changePassword({ oldPassword, newPassword, confirmPassword }),

    onSuccess: () => {
      message.success("修改密码成功");
      reset();
    },
    onError: (error) => {
      message.error("修改密码失败");
      const errorMessage = error.message; // 获取错误信息
      switch (errorMessage) {
        case "Incorrect old password.":
          setError("oldPassword", { message: "旧密码错误" });
          break;
        case "New password and confirm password do not match.":
          setError("confirmPassword", { message: "新密码与确认密码不一致" });
          break;

        case "Enter a valid password.":
          setError("newPassword", {
            message: "只能包含字母、数字、特殊字符“@”、“.”、“-”和“_”",
          });
          break;
        default:
          setError("newpassword", { message: errorMessage });
          break;
      }
    },
  });
}

export default useChangePassword;
