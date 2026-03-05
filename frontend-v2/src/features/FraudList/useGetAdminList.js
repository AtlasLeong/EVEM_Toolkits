import { useQuery } from '@tanstack/react-query';
import { getAdminFraudByAuth } from "../../services/apiFraudList";

export function useGetAadminList() {
  const {
    isLoading,
    data: adminFraudList,
    error,
  } = useQuery({
    queryFn: () => getAdminFraudByAuth(),
    queryKey: ["adminFraudList"],
  });

  return { isLoading, adminFraudList, error };
}
