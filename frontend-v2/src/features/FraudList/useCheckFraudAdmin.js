import { useQuery } from '@tanstack/react-query';
import { checkFraudAdmin } from "../../services/apiFraudList";

export function useCheckFraudAdmin(isAuth) {
  const {
    isLoading,
    data: checkFraudLogin,
    error,
  } = useQuery({
    queryFn: () => checkFraudAdmin(),
    queryKey: ["checkadmin", isAuth],
    enabled: !!isAuth,
  });

  return { isLoading, checkFraudLogin, error };
}
