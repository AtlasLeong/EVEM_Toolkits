import { useQuery } from "react-query";
import { getBoardStarGate } from "../../services/apiTacticalBoard";

export function useGetBoardStarGate() {
  const {
    isLoading,
    data: boardStarGate,
    error,
  } = useQuery({
    queryFn: getBoardStarGate,
    queryKey: ["boardStarGate"],
  });

  return { isLoading, boardStarGate, error };
}
