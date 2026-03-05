import { useMutation, useQueryClient } from "react-query";
import { addFraudRecord } from "../../services/apiFraudList";
import { message } from "antd";

export function useAddFraudRecord() {
  const queryClient = useQueryClient(); // 用于之后的缓存更新
  return useMutation({
    mutationFn: addFraudRecord,
    onSuccess: () => {
      queryClient.invalidateQueries([
        "adminFraudList",
        "adminFraudBehaviorFlow",
      ]);
      message.success("成功添加记录");
    },
    onError: () => {
      // 处理错误情况
      message.error("添加记录失败");
    },
  });
}

export default useAddFraudRecord;
