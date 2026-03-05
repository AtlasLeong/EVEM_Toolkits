import { message } from "antd";
import { searchFraud } from "../../services/apiFraudList";
import { useMutation } from "react-query";

function useFraudSearch(setFraudList) {
  const mutation = useMutation(searchFraud, {
    onSuccess: (data) => {
      // 处理成功的情况，比如更新UI或状态
      if (data.length === 0) message.warning("无该账号信息");
      setFraudList(data);
    },
    onError: () => {
      // 处理错误的情况
      message.error("查询出错，请联系管理员");
    },
  });

  return mutation;
}

export default useFraudSearch;
