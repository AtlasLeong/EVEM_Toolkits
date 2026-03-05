import { useQuery } from '@tanstack/react-query';
import { getFraudReportListAdmin } from "../../services/apiFraudList";

export function useGetFraudReportListAdmin() {
  const {
    isLoading,
    data: adminFraudReportList,
    error,
  } = useQuery({
    queryFn: () => getFraudReportListAdmin(),
    queryKey: ["adminFraudReportList"],
  });

  return { isLoading, adminFraudReportList, error };
}
