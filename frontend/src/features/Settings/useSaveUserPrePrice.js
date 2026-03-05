import { useMutation } from "react-query";
import { saveUserPrePrice } from "../../services/apiPlanetaryResource";
import { message } from "antd";

function useSaveUserPrePrice() {
  return useMutation({
    mutationFn: saveUserPrePrice,

    onSuccess: () => {
      message.success("保存预设价格成功");
    },
    onError: (error) => {
      message.error("保存预设价格失败");
    },
  });
}

export default useSaveUserPrePrice;
