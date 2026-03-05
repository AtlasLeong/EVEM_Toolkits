import { useMutation } from "react-query";
import { forgetEmaillCheck } from "../../services/apiAuthentication";

export function useForgetPasswordCheck({ setError }) {
  return useMutation({
    mutationFn: ({ email = null }) => forgetEmaillCheck({ email: email }),
    onSuccess: (data) => {
      // 处理成功返回的数据，例如显示错误信息

      if (data?.duplicate === "error") {
        setError("forgetEmail", { message: data.message });
        // 显示错误信息
      } else {
        setError("forgetEmail", null);
      }
    },
    onError: (error) => {
      // 处理错误情况
      const errorMessage = error.message;
      setError("forgetEmail", { message: errorMessage });
    },
  });
}

export default useForgetPasswordCheck;
