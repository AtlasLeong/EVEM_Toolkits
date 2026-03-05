import { useMutation } from "react-query";
import { getBazaarChart } from "../../services/apiBazaar";

export function useBazaarChart() {
  const { mutate, data, isSuccess, isError, error, isLoading } =
    useMutation(getBazaarChart);

  return {
    mutate,
    data,
    isSuccess,
    isError,
    error,
    isLoading,
  };
}
