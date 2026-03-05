import { useQuery } from "react-query";
import { getFraudListReportFlowByUserId } from "../../services/apiFraudList";

export function useGetFraudReportListByUserID() {
  const {
    isLoading,
    data: fraudReportList,
    error,
  } = useQuery({
    queryFn: () => getFraudListReportFlowByUserId(),
    queryKey: ["fraudReportList"],
  });

  return { isLoading, fraudReportList, error };
}
