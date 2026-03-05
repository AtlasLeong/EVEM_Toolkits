import API_URL from "./backendSetting";

export async function getBoardSystems() {
  const res = await fetch(`${API_URL}/boardsystems`);
  if (!res.ok) throw Error("Failed getting Board systems");
  const data = await res.json();
  return data;
}

export async function getBoardStarGate() {
  const res = await fetch(`${API_URL}/boardstargate`);
  if (!res.ok) throw Error("Failed getting Board stargate");
  const data = await res.json();
  return data;
}

export async function getConstellations() {
  const res = await fetch(`${API_URL}/boardconstellations`);
  if (!res.ok) throw Error("Failed getting Constellations");
  const data = await res.json();
  return data;
}

export async function getRegions() {
  const res = await fetch(`${API_URL}/boardregions`);
  if (!res.ok) throw Error("Failed getting Regions");
  const data = await res.json();
  return data;
}

export async function postJumpInfo({
  start_system,
  end_system,
  max_distance,
  dict_road,
  inHighSecurity,
}) {
  const res = await fetch(`${API_URL}/jumppath`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      start_system,
      end_system,
      max_distance,
      dict_road,
      inHighSecurity,
    }),
  });

  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.error);
  }
  // 检查是否是 204 No Content 响应
  if (res.status === 204) {
    return {}; // 返回一个空对象或其他合适的值
  }
  const data = await res.json();

  return data;
}
