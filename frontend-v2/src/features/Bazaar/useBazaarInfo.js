import { useQuery } from '@tanstack/react-query';
import { getBazaarInfo } from "../../services/apiBazaar";

export function useBazaarInfo({ bazaarName, server, selectDate }) {
  const {
    isLoading,
    data: bazaarInfo,
    error,
  } = useQuery({
    queryFn: () => getBazaarInfo(bazaarName, server, selectDate),
    queryKey: [selectDate, "bazaarInfo", bazaarName, server],
  });

  return { isLoading, bazaarInfo, error };
}
