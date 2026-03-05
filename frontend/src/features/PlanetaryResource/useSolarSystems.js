import { useQuery } from '@tanstack/react-query';
import { getSolarSystems } from "../../services/apiStarField";
import { solarsystemListTrans } from "./regionListTrans";
export const useSolarSystems = (constellationId) => {
  const { data, isLoading, isError, error } = useQuery(
    ["solarSystems", constellationId],
    () => getSolarSystems(constellationId).then((d) => solarsystemListTrans(d)),
    {
      enabled: !!constellationId,
    }
  );
  return { solarSystems: data, isLoading, isError, error };
};
