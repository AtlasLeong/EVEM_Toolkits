import API_URL from "./backendSetting";

const EXPIRY_SKEW_SECONDS = 30;
let refreshFlight = null;
let sessionMarker;
let sessionGeneration = 0;

function safeStorageGet(key) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

// Access tokens rotate within a session; the refresh token identifies its owner.
// The fallback preserves access-only callers without treating all of them as guests.
function captureSession() {
  const refresh = safeStorageGet("refresh_token");
  const access = refresh ? null : safeStorageGet("access_token");
  const marker = refresh ? `refresh:${refresh}` : access ? `access:${access}` : null;
  if (marker !== sessionMarker) {
    sessionMarker = marker;
    sessionGeneration++;
    refreshFlight = null;
  }
  return { marker, generation: sessionGeneration };
}

export class AuthSessionChangedError extends Error {
  constructor() {
    super("登录状态已变化，请在当前账号下重新操作。");
    this.name = "AuthSessionChangedError";
  }
}

function assertSession(session) {
  const current = captureSession();
  if (current.marker !== session.marker || current.generation !== session.generation) {
    throw new AuthSessionChangedError();
  }
}

// Cross-tab logout/login must invalidate even a refresh that is already pending.
if (typeof window !== "undefined") {
  window.addEventListener("storage", () => captureSession());
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
  captureSession();
  window.dispatchEvent(new Event("auth:changed"));
}

export function clearStoredAuth() {
  if (typeof window === "undefined") return;
  sessionGeneration++;
  refreshFlight = null;
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

export const refreshAccessToken = async (refreshToken, signal) => {
  const response = await fetch(`${API_URL}/user/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: refreshToken }),
    signal,
  });

  if (!response.ok) return null;

  const data = await response.json().catch(() => ({}));
  return data.access || null;
};

function expireSession(session) {
  assertSession(session);
  clearStoredAuth();
  // This request may continue anonymously after its own expiry handling. Other
  // requests from the expired session are still fenced out by their old snapshot.
  Object.assign(session, captureSession());
}

async function ensureFreshAccessToken(session, forceRefresh = false, signal) {
  assertSession(session);
  const accessToken = safeStorageGet("access_token");
  if (!forceRefresh && accessToken && !isTokenExpired(accessToken)) {
    return accessToken;
  }

  const refreshToken = safeStorageGet("refresh_token");
  if (!refreshToken || isTokenExpired(refreshToken)) {
    if (session.marker !== null) expireSession(session);
    return null;
  }

  if (!refreshFlight || refreshFlight.generation !== session.generation) {
    const flight = { generation: session.generation, promise: null };
    flight.promise = refreshAccessToken(refreshToken, signal).finally(() => {
      // An old completion must not release a newer account's single-flight lock.
      if (refreshFlight === flight) refreshFlight = null;
    });
    refreshFlight = flight;
  }

  let nextAccessToken;
  try {
    nextAccessToken = await refreshFlight.promise;
  } catch (error) {
    assertSession(session);
    throw error;
  }
  assertSession(session);
  if (!nextAccessToken) {
    expireSession(session);
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
  const session = captureSession();
  let accessToken = await ensureFreshAccessToken(session, false, options.signal);
  assertSession(session);
  const hadAuthHeader = Boolean(accessToken);

  let response = await fetch(url, {
    ...options,
    headers: buildHeaders(options, accessToken),
    signal: options.signal,
  });
  assertSession(session);

  if (response.status !== 401 || !hadAuthHeader) {
    return response;
  }

  accessToken = await ensureFreshAccessToken(session, true, options.signal);
  assertSession(session);
  if (!accessToken) {
    return response;
  }

  response = await fetch(url, {
    ...options,
    headers: buildHeaders(options, accessToken),
    signal: options.signal,
  });
  assertSession(session);

  if (response.status === 401) {
    expireSession(session);
  }

  return response;
};

export default fetchWithAuth;
