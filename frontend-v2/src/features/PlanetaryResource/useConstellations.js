import { useQuery } from '@tanstack/react-query';
import { getConstellations } from "../../services/apiStarField";
import { constellationListTrans } from "./regionListTrans";
export function useConstellations(id) {
  const {
    isLoading,
    data: constellations,
    error,
  } = useQuery({
    queryFn: () =>
      getConstellations(id).then((data) => constellationListTrans(data)),
    queryKey: ["constellations", id],
    enabled: !!id,
  });

  return { isLoading, constellations, error };
}
