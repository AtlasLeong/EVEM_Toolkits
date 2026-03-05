import { useMutation } from '@tanstack/react-query';
import { signupCheck } from "../../services/apiAuthentication";

function useSignUpCheck({ setError }) {
  return useMutation({
    mutationFn: ({ userName = null, email = null }) =>
      signupCheck({ userName, email }),

    onSuccess: (data) => {
      // 处理成功返回的数据，例如显示错误信息
      if (data.duplicate === "userName") {
        setError("userName", { message: data.message });
        // 显示错误信息
      } else if (data.duplicate === "email") {
        setError("email", { message: data.message });
      } else if (data.duplicate === "userNameFalse") {
        setError("userName", { message: null });
      } else if (data.duplicate === "emailFalse") {
        setError("email", { message: null });
      }
    },
    onError: (error) => {
      // 处理错误情况
    },
  });
}

export default useSignUpCheck;
