import { useMutation, useQueryClient } from "react-query";
import { deleteFraudByID } from "../../services/apiFraudList";
import { message } from "antd";

export function useDeleteFraudRecord() {
  const queryClient = useQueryClient(); // 用于之后的缓存更新
  return useMutation({
    mutationFn: deleteFraudByID,
    onSuccess: () => {
      queryClient.invalidateQueries([
        "adminFraudList",
        "adminFraudBehaviorFlow",
      ]);
      message.success("成功删除记录");
    },
    onError: () => {
      // 处理错误情况
      message.error("删除记录失败");
    },
  });
}

export default useDeleteFraudRecord;
