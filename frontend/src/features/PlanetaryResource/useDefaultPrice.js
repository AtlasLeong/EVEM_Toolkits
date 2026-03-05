import { useQuery } from "react-query";
import { getDefaultResourcePriceSetting } from "../../services/apiPlanetaryResource";

export function useDefaultPrice(reset) {
  const {
    isLoading,
    data: defaultPrice,
    error,
    refetch,
  } = useQuery({
    queryFn: () => getDefaultResourcePriceSetting(reset),
    queryKey: ["resourcePrice", reset],
  });

  return { isLoading, defaultPrice, error, refetch };
}
