import { useQuery } from '@tanstack/react-query';
import { getFraudBehaviorFlow } from "../../services/apiFraudList";

export function useGetFraudBehaviorFlow() {
  const {
    isLoading,
    data: fraudBehaviorFlow,
    error,
  } = useQuery({
    queryFn: () => getFraudBehaviorFlow(),
    queryKey: ["adminFraudBehaviorFlow"],
  });

  return { isLoading, fraudBehaviorFlow, error };
}
