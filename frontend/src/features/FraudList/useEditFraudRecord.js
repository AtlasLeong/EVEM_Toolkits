import { useMutation, useQueryClient } from "react-query";
import { editFraudRecord } from "../../services/apiFraudList";
import { message } from "antd";

export function useEditFraudRecord() {
  const queryClient = useQueryClient(); // 用于之后的缓存更新
  return useMutation({
    mutationFn: editFraudRecord,
    onSuccess: () => {
      queryClient.invalidateQueries([
        "adminFraudList",
        "adminFraudBehaviorFlow",
      ]);
      message.success("成功保存记录");
    },
    onError: () => {
      // 处理错误情况
      message.error("保存记录失败");
    },
  });
}

export default useEditFraudRecord;
