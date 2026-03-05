import { useQuery } from '@tanstack/react-query';
import { getBazaarDefaultChart } from "../../services/apiBazaar";

export function useDefaultBazaarChart() {
  const {
    isLoading,
    data: bazaarDefaultChart,
    error,
  } = useQuery({
    queryFn: getBazaarDefaultChart,
    queryKey: ["bazaarChart"],
  });

  return { isLoading, bazaarDefaultChart, error };
}
