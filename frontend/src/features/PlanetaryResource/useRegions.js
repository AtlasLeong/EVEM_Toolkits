import { useQuery } from "react-query";
import { getRegionList } from "../../services/apiStarField";

export function useRegions() {
  const {
    isLoading,
    data: regions,
    error,
  } = useQuery({
    queryFn: getRegionList,
    queryKey: ["regions"],
  });

  return { isLoading, regions, error };
}
