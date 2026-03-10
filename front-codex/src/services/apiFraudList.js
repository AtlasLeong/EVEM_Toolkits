import API_URL from "./backendSetting";
import fetchWithAuth from "./fetchWithAuth";

export async function searchFraud(FraudNumber) {
  const res = await fetch(`${API_URL}/fraudsearch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(FraudNumber),
  });
  if (!res.ok) {
    throw new Error("Error to search Fraud list");
  }
  const data = await res.json();
  return data;
}

export async function checkFraudAdmin() {
  const res = await fetchWithAuth(`${API_URL}/fraudlogin`);
  if (!res.ok) throw Error("Failed check fraud admin login");
  const data = await res.json();
  return data;
}

export async function fraudAdminLogin({ adminEmail, adminPassword }) {
  const res = await fetchWithAuth(`${API_URL}/fraudlogin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ adminEmail, adminPassword }),
  });
  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.error);
  }
  const data = await res.json();
  return data;
}

export async function getAdminFraudByAuth() {
  const res = await fetchWithAuth(`${API_URL}/fraudadminlist`);
  if (!res.ok) throw Error("Failed check fraud admin login");
  const data = await res.json();
  return data;
}

export async function deleteFraudByID(fraudID) {
  const res = await fetchWithAuth(`${API_URL}/fraudadminlist`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fraudID),
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
export async function addFraudRecord(record) {
  const res = await fetchWithAuth(`${API_URL}/fraudadminlist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(record),
  });

  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.message);
  }
  const data = await res.json();

  return data;
}

export async function editFraudRecord(record) {
  const res = await fetchWithAuth(`${API_URL}/fraudadminlist`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(record),
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

export async function getFraudAdminGroup() {
  const res = await fetchWithAuth(`${API_URL}/fraudadmingroup`);
  if (!res.ok) throw Error("Failed get fraud admin group");
  const data = await res.json();
  return data;
}

export async function getFraudBehaviorFlow() {
  const res = await fetchWithAuth(`${API_URL}/fraudbehaviorflow`);
  if (!res.ok) throw Error("Failed get fraud behavior flow");
  const data = await res.json();
  return data;
}

export async function getFraudListReportFlowByUserId() {
  const res = await fetchWithAuth(`${API_URL}/fraudlistreport`);
  if (!res.ok) throw Error("Failed get fraud list report");
  const data = await res.json();
  return data;
}

export async function submitFraudReport(report) {
  const res = await fetchWithAuth(`${API_URL}/fraudlistreport`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(report),
  });

  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.error);
  }
  const data = await res.json();

  return data;
}

export async function uploadFraudEvidence(file) {
  const formData = new FormData();
  formData.append("image", file);

  const res = await fetchWithAuth(`${API_URL}/uploadimage/`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errorMessage = await res.json().catch(() => ({}));
    throw new Error(errorMessage.error || errorMessage.message || "Failed to upload image");
  }

  const data = await res.json();
  return data;
}

export async function getFraudReportListAdmin() {
  const res = await fetchWithAuth(`${API_URL}/fraudadminlistreport`);
  if (!res.ok) throw Error("Failed get admin fraud list report");
  const data = await res.json();
  return data;
}

export async function submitReportApprove(report) {
  const res = await fetchWithAuth(`${API_URL}/fraudadminlistreport`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(report),
  });

  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.error);
  }
  const data = await res.json();

  return data;
}
