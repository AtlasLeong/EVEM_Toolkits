import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getUserProgremmaByID } from "../../services/apiPlanetaryResource";

export function useGetProgremma({
  startSelect,
  setStartSelect,
  selectedProgrammeId,
  setCalculatorData,
  setCurrentProgremma,
}) {
  const {
    isLoading,
    data: programme,
    error,
  } = useQuery({
    queryFn: () => getUserProgremmaByID(selectedProgrammeId),
    queryKey: ["planetary_programme", selectedProgrammeId],
    enabled: startSelect,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (programme && startSelect) {
      setCalculatorData(programme[0].programme_element);
      setCurrentProgremma(programme[0].programme_name);
      setStartSelect(false);
    }
  }, [programme, startSelect, setCalculatorData, setCurrentProgremma, setStartSelect]);

  return { isLoading, programme, error };
}

