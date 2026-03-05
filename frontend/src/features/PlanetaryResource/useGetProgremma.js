import { useQuery } from "react-query";
import { getUserProgremmaByID } from "../../services/apiPlanetaryResource";

export function useGetProgremma({
  startSelect,
  setStartSelect,
  selectedProgrammeId,
  setCalculatorData,
  setCurrentProgremma,
}) {
  console.log(selectedProgrammeId);
  const {
    isLoading,
    data: programme,
    error,
  } = useQuery({
    queryFn: () => getUserProgremmaByID(selectedProgrammeId),
    queryKey: ["planetary_programme"],
    enabled: startSelect,
    onSuccess: (data) => {
      setCalculatorData(data[0].programme_element);
      setCurrentProgremma(data[0].programme_name);
      setStartSelect(false);
    },
    staleTime: 0, // 数据立即过时
    cacheTime: 0, // 不缓存数据
  });

  return { isLoading, programme, error };
}
