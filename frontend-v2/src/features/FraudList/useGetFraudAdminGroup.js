import { useQuery } from '@tanstack/react-query';
import { getFraudAdminGroup } from "../../services/apiFraudList";

export function useGetFraudAdminGroup() {
  const {
    isLoading,
    data: adminGroup,
    error,
  } = useQuery({
    queryFn: () => getFraudAdminGroup(),
    queryKey: ["adminGroup"],
  });

  return { isLoading, adminGroup, error };
}
