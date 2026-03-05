import { useQuery } from '@tanstack/react-query';
import { getBoardSystems } from "../../services/apiTacticalBoard";

export function useGetBoardSystems() {
  const {
    isLoading,
    data: boardSystems,
    error,
  } = useQuery({
    queryFn: getBoardSystems,
    queryKey: ["boardSystems"],
  });

  return { isLoading, boardSystems, error };
}
