import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitFraudReport } from "../../services/apiFraudList";
import { message } from "antd";

export function useSubmitFraudReport({ setShowReportPage }) {
  const queryClient = useQueryClient(); // 用于之后的缓存更新
  return useMutation({
    mutationFn: submitFraudReport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fraudReportList"] });
      message.success("成功提交举报");
      setShowReportPage(false);
    },
    onError: (error) => {
      // 处理错误情况
      message.error(error.message);
    },
  });
}

export default useSubmitFraudReport;
