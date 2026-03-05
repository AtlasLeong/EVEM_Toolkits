import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitReportApprove } from "../../services/apiFraudList";
import { message } from "antd";

export function useSubmitReportApprove() {
  const queryClient = useQueryClient(); // 用于之后的缓存更新
  return useMutation({
    mutationFn: submitReportApprove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminFraudReportList"] });
      message.success("审核完成");
    },
    onError: (error) => {
      // 处理错误情况
      message.error(error.message);
    },
  });
}

export default useSubmitReportApprove;
