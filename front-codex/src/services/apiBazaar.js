import API_URL from "./backendSetting";

export async function getBazaarNameList() {
  const res = await fetch(`${API_URL}/bazaarnamelist`);
  if (!res.ok) {
    throw new Error("Error to fetch bazaar name list");
  }
  const data = await res.json();
  return data;
}

export async function getBazaarDate(bazaarName, server) {
  const res = await fetch(`${API_URL}/bazaardate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bazaarName, server),
  });
  if (!res.ok) {
    throw new Error("Error to fetch Bazaar date");
  }
  const data = await res.json();
  return data;
}

export async function getBazaarInfo(bazaarName, server, selectDate) {
  const res = await fetch(
    `${API_URL}/bazaarinfo?bazaarName=${bazaarName}&server=${server}&selectDate=${selectDate}`
  );
  if (!res.ok) {
    throw new Error("Error to fetch bazaar info");
  }
  const data = await res.json();
  return data;
}

export async function getBazaarChart(bazaarList) {
  const res = await fetch(`${API_URL}/bazaarchart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bazaarList),
  });
  if (!res.ok) {
    throw new Error("Error to fetch Bazaar chart info");
  }
  const data = await res.json();
  return data;
}

export async function getBazaarBox(bazaarName) {
  const res = await fetch(`${API_URL}/bazaarbox?bazaarName=${bazaarName}`);
  if (!res.ok) {
    throw new Error("Error to fetch bazaar box");
  }
  const data = await res.json();
  return data;
}
