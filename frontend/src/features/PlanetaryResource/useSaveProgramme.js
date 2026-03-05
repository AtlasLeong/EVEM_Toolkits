import { useMutation, useQueryClient } from "react-query";
import { savePlanetaryProgramme } from "../../services/apiPlanetaryResource";
import { message } from "antd";

function useSaveProgramme({ onCloseModal, handleSetProgremma }) {
  const queryClient = useQueryClient();
  return useMutation(savePlanetaryProgramme, {
    onSuccess: (data) => {
      message.success("成功保存方案"); // 显示成功提示
      onCloseModal();
      queryClient.invalidateQueries("progremmaList");
      handleSetProgremma(data.programme_id);
    },
    onError: (error) => {
      const errorMessage = error.message;
      message.error(errorMessage);
    },
  });
}

export default useSaveProgramme;
