import { useQuery } from "react-query";
import { getBazaarBox } from "../../services/apiBazaar";

export function useBazaarBox(bazaarName) {
  const {
    isLoading,
    data: bazaarBox,
    error,
  } = useQuery({
    queryFn: () => getBazaarBox(bazaarName),
    queryKey: ["bazaarBox", bazaarName],
  });

  return { isLoading, bazaarBox, error };
}
