import API_URL from "./backendSetting";
import fetchWithAuth from "./fetchWithAuth";

export async function getPlanetResources() {
  const res = await fetch(`${API_URL}/planetresources`);
  if (!res.ok) {
    throw new Error("Error to fetch Planet Resource");
  }
  const data = await res.json();
  return data;
}

export async function searchPlanetResources(searchForm) {
  const res = await fetch(`${API_URL}/searchplanetresource`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(searchForm),
  });
  if (!res.ok) {
    throw new Error("Error to fetch Planet Resource");
  }
  const data = await res.json();
  return data;
}

export async function getDefaultResourcePriceSetting(resetPrice) {
  const res = await fetchWithAuth(
    `${API_URL}/planetresourceprice?resetPrice=${resetPrice}`
  );
  if (!res.ok) {
    throw new Error("Error to fetch default Resource Price");
  }
  const data = await res.json();
  return data;
}

export async function saveUserPrePrice({ prePriceElement }) {
  const res = await fetchWithAuth(`${API_URL}/planetresourceprice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(prePriceElement),
  });

  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.message);
  }
  const data = await res.json();

  return data;
}

export async function savePlanetaryProgramme({ calculatorData }) {
  const res = await fetchWithAuth(`${API_URL}/programme`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(calculatorData),
  });

  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.message);
  }
  const data = await res.json();

  return data;
}

export async function getUserProgremmaList() {
  const res = await fetchWithAuth(`${API_URL}/programme`);
  if (!res.ok) {
    throw new Error("Error to fetch programme");
  }
  const data = await res.json();
  return data;
}

export async function getUserProgremmaByID(programme_id) {
  const res = await fetchWithAuth(
    `${API_URL}/programme?programme_id=${programme_id}`
  );
  if (!res.ok) {
    throw new Error(`Error to fetch programme by id: ${programme_id}`);
  }
  const data = await res.json();
  return data;
}

export async function deleteProgremmaByID(programme_id) {
  const res = await fetchWithAuth(`${API_URL}/programme`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(programme_id),
  });

  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.message);
  }
  // 检查是否是 204 No Content 响应
  if (res.status === 204) {
    return {}; // 返回一个空对象或其他合适的值
  }
  const data = await res.json();

  return data;
}

export async function updateProgremma({ programme_id, element }) {
  const res = await fetchWithAuth(`${API_URL}/programme`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ programme_id, element }),
  });

  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.message);
  }
  // 检查是否是 204 No Content 响应
  if (res.status === 204) {
    return {}; // 返回一个空对象或其他合适的值
  }
  const data = await res.json();

  return data;
}
