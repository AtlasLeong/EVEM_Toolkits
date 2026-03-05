import { useMutation } from '@tanstack/react-query';
import { postJumpInfo } from "../../services/apiTacticalBoard";
import { message } from "antd";

function usePostJumpInfo() {
  return useMutation({ mutationFn: postJumpInfo,
    onSuccess: (data) => {
      message.success("获取诱导方案成功"); // 显示成功提示
    },
    onError: (error) => {
      const errorMessage = error.message;
      message.error(errorMessage);
    },
  });
}

export default usePostJumpInfo;
