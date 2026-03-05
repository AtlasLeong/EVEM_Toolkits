import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateProgremma } from "../../services/apiPlanetaryResource";
import { message } from "antd";

function useUpdateProgramme() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: updateProgremma,
    onSuccess: () => {
      message.success("成功更新方案"); // 显示成功提示
      queryClient.invalidateQueries({ queryKey: ["progremmaList"] });
    },
    onError: () => {
      message.error("更新方案失败");
    },
  });
}

export default useUpdateProgramme;
