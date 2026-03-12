import API_URL from "./backendSetting";
import fetchWithAuth from "./fetchWithAuth";

async function parseError(response, fallback) {
  const errorData = await response.json().catch(() => ({}));
  throw new Error(errorData.error || errorData.message || errorData.detail || fallback);
}

export async function searchFraud(fraudNumber) {
  const res = await fetch(`${API_URL}/fraudsearch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fraudNumber),
  });

  if (!res.ok) {
    throw new Error("诈骗名单查询失败");
  }

  return res.json();
}

export async function checkFraudAdmin() {
  const res = await fetchWithAuth(`${API_URL}/fraudadmincheck`);
  if (!res.ok) {
    throw new Error("管理员权限校验失败");
  }
  return res.json();
}

export async function fraudAdminLogin({ adminEmail, adminPassword }) {
  const loginRes = await fetch(`${API_URL}/user/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ login_email: adminEmail, login_password: adminPassword }),
  });

  if (!loginRes.ok) {
    await parseError(loginRes, "管理员登录失败");
  }

  const tokens = await loginRes.json();
  const adminCheckRes = await fetch(`${API_URL}/fraudadmincheck`, {
    headers: {
      Authorization: `Bearer ${tokens.access}`,
    },
  });

  if (!adminCheckRes.ok) {
    await parseError(adminCheckRes, "管理员权限校验失败");
  }

  const adminCheckData = await adminCheckRes.json();
  if (adminCheckData?.message !== "Authorized Users") {
    throw new Error(adminCheckData?.message || "管理员权限校验失败");
  }

  return tokens;
}

export async function getAdminFraudByAuth() {
  const res = await fetchWithAuth(`${API_URL}/fraudadminlist`);
  if (!res.ok) {
    throw new Error("获取管理员名单失败");
  }
  return res.json();
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
    throw new Error(errorMessage.message || "删除诈骗记录失败");
  }

  if (res.status === 204) {
    return {};
  }

  return res.json();
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
    throw new Error(errorMessage.message || "新增诈骗记录失败");
  }

  return res.json();
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
    throw new Error(errorMessage.message || "编辑诈骗记录失败");
  }

  if (res.status === 204) {
    return {};
  }

  return res.json();
}

export async function getFraudAdminGroup() {
  const res = await fetchWithAuth(`${API_URL}/fraudadmingroup`);
  if (!res.ok) {
    throw new Error("获取管理员群组失败");
  }
  return res.json();
}

export async function getFraudBehaviorFlow() {
  const res = await fetchWithAuth(`${API_URL}/fraudbehaviorflow`);
  if (!res.ok) {
    throw new Error("获取操作流水失败");
  }
  return res.json();
}

export async function getFraudListReportFlowByUserId() {
  const res = await fetchWithAuth(`${API_URL}/fraudlistreport`);
  if (!res.ok) {
    throw new Error("获取举报记录失败");
  }
  return res.json();
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
    throw new Error(errorMessage.error || "提交举报失败");
  }

  return res.json();
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
    throw new Error(errorMessage.error || errorMessage.message || "上传证据图片失败");
  }

  return res.json();
}

export async function getFraudReportListAdmin() {
  const res = await fetchWithAuth(`${API_URL}/fraudadminlistreport`);
  if (!res.ok) {
    throw new Error("获取举报审核列表失败");
  }
  return res.json();
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
    throw new Error(errorMessage.error || "提交审核失败");
  }

  return res.json();
}
