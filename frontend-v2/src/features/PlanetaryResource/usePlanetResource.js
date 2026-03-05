import { useQuery } from '@tanstack/react-query';
import { getPlanetResources } from "../../services/apiPlanetaryResource";

export function usePlanetResource() {
  const {
    isLoading,
    data: planetResourceList,
    error,
  } = useQuery({
    queryFn: getPlanetResources,
    queryKey: ["planet_resource"],
  });

  return { isLoading, planetResourceList, error };
}
