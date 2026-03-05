import { useMutation, useQueryClient } from "react-query";
import { deleteProgremmaByID } from "../../services/apiPlanetaryResource";
import { message } from "antd";

export function useDeleteProgramme() {
  const queryClient = useQueryClient(); // 用于之后的缓存更新
  return useMutation({
    mutationFn: (programme_id) => deleteProgremmaByID({ programme_id }),
    onSuccess: () => {
      queryClient.invalidateQueries("progremmaList");
      message.success("成功删除方案");
    },
    onError: () => {
      // 处理错误情况
      message.error("删除方案失败");
    },
  });
}

export default useDeleteProgramme;
