import { useQuery } from '@tanstack/react-query';
import { getRegions } from "../../services/apiTacticalBoard";

export function useGetBoardRegions() {
  const {
    isLoading,
    data: boardRegions,
    error,
  } = useQuery({
    queryFn: getRegions,
    queryKey: ["boardRegions"],
  });

  return { isLoading, boardRegions, error };
}
