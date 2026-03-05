import { useMutation } from '@tanstack/react-query';
import { emailVerification } from "../../services/apiAuthentication";

export function useEmailVerification({ setError }) {
  return useMutation({
    mutationFn: ({ email = null }) => emailVerification({ email: email }),
    onSuccess: (data) => {
      // 处理成功返回的数据，例如显示错误信息
      if (data.error) {
        setError("email", { message: "请输入正确的邮箱" });
        // 显示错误信息
      }
    },
    onError: (error) => {
      // 处理错误情况
    },
  });
}

export default useEmailVerification;
