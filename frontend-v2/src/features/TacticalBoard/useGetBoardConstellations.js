import { useQuery } from '@tanstack/react-query';
import { getConstellations } from "../../services/apiTacticalBoard";

export function useGetBoardConstellations() {
  const {
    isLoading,
    data: boardConstellations,
    error,
  } = useQuery({
    queryFn: getConstellations,
    queryKey: ["boardConstellations"],
  });

  return { isLoading, boardConstellations, error };
}
