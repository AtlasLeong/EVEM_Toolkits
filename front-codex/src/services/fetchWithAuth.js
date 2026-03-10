import API_URL from "./backendSetting";

const EXPIRY_SKEW_SECONDS = 30;
let refreshPromise = null;

function safeStorageGet(key) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

function decodeJwtPayload(token) {
  if (!token) return null;

  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function isTokenExpired(token, skewSeconds = EXPIRY_SKEW_SECONDS) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
}

export function notifyAuthChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("auth:changed"));
}

export function clearStoredAuth() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("access_token");
  window.localStorage.removeItem("refresh_token");
  notifyAuthChanged();
}

export function hasActiveSession() {
  const accessToken = safeStorageGet("access_token");
  if (accessToken && !isTokenExpired(accessToken)) return true;

  const refreshToken = safeStorageGet("refresh_token");
  return Boolean(refreshToken && !isTokenExpired(refreshToken));
}

export const refreshAccessToken = async (refreshToken) => {
  const response = await fetch(`${API_URL}/user/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: refreshToken }),
  });

  if (!response.ok) return null;

  const data = await response.json().catch(() => ({}));
  return data.access || null;
};

async function ensureFreshAccessToken(forceRefresh = false) {
  const accessToken = safeStorageGet("access_token");
  if (!forceRefresh && accessToken && !isTokenExpired(accessToken)) {
    return accessToken;
  }

  const refreshToken = safeStorageGet("refresh_token");
  if (!refreshToken || isTokenExpired(refreshToken)) {
    clearStoredAuth();
    return null;
  }

  if (!refreshPromise) {
    refreshPromise = refreshAccessToken(refreshToken).finally(() => {
      refreshPromise = null;
    });
  }

  const nextAccessToken = await refreshPromise;
  if (!nextAccessToken) {
    clearStoredAuth();
    return null;
  }

  window.localStorage.setItem("access_token", nextAccessToken);
  notifyAuthChanged();
  return nextAccessToken;
}

function buildHeaders(options, accessToken) {
  const defaultHeaders = {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };

  if (!options.headers?.["Content-Type"] && !(options.body instanceof FormData)) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  return { ...defaultHeaders, ...options.headers };
}

const fetchWithAuth = async (url, options = {}) => {
  let accessToken = await ensureFreshAccessToken(false);
  const hadAuthHeader = Boolean(accessToken);

  let response = await fetch(url, {
    ...options,
    headers: buildHeaders(options, accessToken),
  });

  if (response.status !== 401 || !hadAuthHeader) {
    return response;
  }

  accessToken = await ensureFreshAccessToken(true);
  if (!accessToken) {
    return response;
  }

  response = await fetch(url, {
    ...options,
    headers: buildHeaders(options, accessToken),
  });

  if (response.status === 401) {
    clearStoredAuth();
  }

  return response;
};

export default fetchWithAuth;
