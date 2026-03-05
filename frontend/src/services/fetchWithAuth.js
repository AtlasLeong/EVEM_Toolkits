import API_URL from "./backendSetting";

const fetchWithAuth = async (url, options = {}) => {
  const accessToken = localStorage.getItem("access_token");

  const defaultHeaders = {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };

  if (
    !options.headers?.["Content-Type"] &&
    !(options.body instanceof FormData)
  ) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers: { ...defaultHeaders, ...options.headers },
  });

  if (response.status === 401) {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) {
      localStorage.removeItem("access_token");
      throw new Error("Token expired and no refresh token available");
    }

    const newAccessToken = await refreshAccessToken(refreshToken);
    if (!newAccessToken) {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      throw new Error("Failed to refresh token, please login again");
    }

    localStorage.setItem("access_token", newAccessToken);

    const retryResponse = await fetch(url, {
      ...options,
      headers: {
        ...defaultHeaders,
        Authorization: `Bearer ${newAccessToken}`,
        ...options.headers,
      },
    });

    if (!retryResponse.ok) {
      const errorData = await retryResponse.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || "Request failed");
    }

    return retryResponse;
  }

  return response;
};

export const refreshAccessToken = async (refreshToken) => {
  const response = await fetch(`${API_URL}/user/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: refreshToken }),
  });

  if (response.ok) {
    const data = await response.json();
    return data.access;
  }

  return null;
};

export default fetchWithAuth;

