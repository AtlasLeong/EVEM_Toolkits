import { useMutation } from "react-query";
import { getBazaarDate } from "../../services/apiBazaar";

function useBazaarDate() {
  const mutation = useMutation(getBazaarDate, {
    onSuccess: () => {
      // 处理成功的情况，比如更新UI或状态
      console.log("Date fetched successfully");
    },
    onError: () => {
      // 处理错误的情况
      console.error("Error fetching date");
    },
  });

  return mutation;
}

export default useBazaarDate;
