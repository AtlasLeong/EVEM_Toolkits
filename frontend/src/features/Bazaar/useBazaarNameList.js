import { useQuery } from "react-query";
import { getBazaarNameList } from "../../services/apiBazaar";

export function useBazaarNameList() {
  const {
    isLoading,
    data: bazaarNameList,
    error,
  } = useQuery({ queryFn: getBazaarNameList, queryKey: ["bazaarNameList"] });

  return { isLoading, bazaarNameList, error };
}
