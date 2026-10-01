import API_URL from "./backendSetting";
import fetchWithAuth from "./fetchWithAuth";

export async function getRegionList() {
  const res = await fetchWithAuth(`${API_URL}/regions`);
  if (!res.ok) throw Error("Failed getting regions");
  const data = await res.json();
  return data;
}

export async function getConstellations(regionID) {
  const res = await fetchWithAuth(`${API_URL}/constellations?regionID=${regionID}`);
  if (!res.ok) throw Error("Failed getting constellations");
  const data = await res.json();
  return data;
}

export async function getSolarSystems(constellationID) {
  const res = await fetchWithAuth(
    `${API_URL}/solarsystem?constellationID=${constellationID}`
  );
  if (!res.ok) throw Error("Failed getting Solar System");
  const data = await res.json();
  return data;
}
