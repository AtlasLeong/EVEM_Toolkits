import API_URL from "./backendSetting";

const fetchWithAuth = async (url, options = {}) => {
  const accessToken = localStorage.getItem("access_token");

  let defaultHeaders = {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };

  // 只有在没有设置 Content-Type 且不是 FormData 的情况下,才设置默认的 Content-Type
  if (
    !options.headers?.["Content-Type"] &&
    !(options.body instanceof FormData)
  ) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  if (response.status === 401) {
    // 处理令牌过期的情况
    const refreshToken = localStorage.getItem("refresh_token");
    if (refreshToken) {
      const newAccessToken = await refreshAccessToken(refreshToken);
      if (newAccessToken) {
        localStorage.setItem("access_token", newAccessToken);

        // 重新发送原始请求
        const retryResponse = await fetch(url, {
          ...options,
          headers: {
            ...defaultHeaders,
            Authorization: `Bearer ${newAccessToken}`,
          },
        });

        if (!retryResponse.ok) {
          throw new Error("Network response was not ok");
        }

        return retryResponse;
      }
    } else {
      throw new Error("Token expired and no refresh token available");
    }
  } else if (!response.ok) {
    return response;
  }

  return response;
};

export const refreshAccessToken = async (refreshToken) => {
  const response = await fetch(`${API_URL}/user/token/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh: refreshToken }),
  });

  if (response.ok) {
    const data = await response.json();

    return data.access; // 假设响应中包含新的 access token
  }

  return null;
};

export default fetchWithAuth;
