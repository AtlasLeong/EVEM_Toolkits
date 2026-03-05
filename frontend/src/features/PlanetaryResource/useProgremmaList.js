import { useQuery } from "react-query";
import { getUserProgremmaList } from "../../services/apiPlanetaryResource";

export function useProgremmaList(isAuth) {
  const {
    isLoading,
    data: progremmaList,
    error,
  } = useQuery({
    queryFn: getUserProgremmaList,
    queryKey: ["progremmaList"],
    enabled: isAuth,
  });

  return { isLoading, progremmaList, error };
}
