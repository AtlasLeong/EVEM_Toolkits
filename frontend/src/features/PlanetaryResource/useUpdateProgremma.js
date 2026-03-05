import { useMutation, useQueryClient } from "react-query";
import { updateProgremma } from "../../services/apiPlanetaryResource";
import { message } from "antd";

function useUpdateProgramme() {
  const queryClient = useQueryClient();
  return useMutation(updateProgremma, {
    onSuccess: () => {
      message.success("成功更新方案"); // 显示成功提示
      queryClient.invalidateQueries("progremmaList");
    },
    onError: () => {
      message.error("更新方案失败");
    },
  });
}

export default useUpdateProgramme;
