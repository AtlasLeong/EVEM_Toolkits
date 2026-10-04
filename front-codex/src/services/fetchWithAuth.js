import API_URL from "./backendSetting";
import { isTokenExpired, readValidatedSession, tokenUserId } from "./validatedSession";

const REFRESH_TIMEOUT_MS = 20000;
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
  const { refreshToken: refresh, accessToken: access, mismatchedPair, identity } = readValidatedSession();
  // A mixed pair is anonymous, but has its own lifetime so an already pending
  // authenticated response or refresh cannot cross into this guest state.
  const marker = mismatchedPair ? `mixed:${refresh}:${access}`
    : refresh ? `refresh:${refresh}|identity:${identity}` : access ? `access:${access}` : null;
  if (marker !== sessionMarker) {
    refreshFlight?.controller.abort();
    sessionMarker = marker;
    sessionGeneration++;
    refreshFlight = null;
  }
  return { marker, generation: sessionGeneration, mismatchedPair };
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

export function notifyAuthChanged() {
  if (typeof window === "undefined") return;
  captureSession();
  window.dispatchEvent(new Event("auth:changed"));
}

export function clearStoredAuth() {
  if (typeof window === "undefined") return;
  refreshFlight?.controller.abort();
  sessionGeneration++;
  refreshFlight = null;
  window.localStorage.removeItem("access_token");
  window.localStorage.removeItem("refresh_token");
  notifyAuthChanged();
}

export function hasActiveSession() {
  return readValidatedSession().isAuthenticated;
}

export class AuthRefreshError extends Error {
  constructor(status, message, retryable = status === 429 || status >= 500) {
    super(message || (status === 429
      ? "登录续期请求过于频繁，请稍后重试。"
      : `登录续期失败（${status}），请稍后重试。`));
    this.name = "AuthRefreshError";
    this.status = status;
    this.retryable = retryable;
  }
}

export const refreshAccessToken = async (refreshToken, signal) => {
  const response = await fetch(`${API_URL}/user/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: refreshToken }),
    signal,
  });

  // Only an authentication rejection proves that this session has expired.
  // Service outages and rate limits must not erase otherwise valid credentials
  // or allow the pending authenticated request to continue anonymously.
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new AuthRefreshError(response.status);

  const data = await response.json().catch(() => ({}));
  if (typeof data?.access !== "string" || !data.access) {
    throw new AuthRefreshError(response.status, "登录续期响应异常，请稍后重试。", true);
  }
  return data.access;
};

function waitForRefresh(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException('请求已取消', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException('请求已取消', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

function expireSession(session) {
  assertSession(session);
  clearStoredAuth();
  // This request may continue anonymously after its own expiry handling. Other
  // requests from the expired session are still fenced out by their old snapshot.
  Object.assign(session, captureSession());
}

async function ensureFreshAccessToken(session, forceRefresh = false, signal) {
  assertSession(session);
  // Preserve the pair until a cross-tab replacement converges. Public callers
  // continue anonymously; neither token may authenticate or refresh this state.
  if (session.mismatchedPair) return null;
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
    const flight = { generation: session.generation, promise: null, controller: new AbortController() };
    const timeout = window.setTimeout(() => flight.controller.abort(), REFRESH_TIMEOUT_MS);
    flight.promise = refreshAccessToken(refreshToken, flight.controller.signal).finally(() => {
      window.clearTimeout(timeout);
      // An old completion must not release a newer account's single-flight lock.
      if (refreshFlight === flight) refreshFlight = null;
    });
    refreshFlight = flight;
  }

  let nextAccessToken;
  try {
    nextAccessToken = await waitForRefresh(refreshFlight.promise, signal);
  } catch (error) {
    assertSession(session);
    throw error;
  }
  assertSession(session);
  if (!nextAccessToken) {
    expireSession(session);
    return null;
  }

  const refreshUserId = tokenUserId(refreshToken);
  const nextAccessUserId = tokenUserId(nextAccessToken);
  if (refreshUserId != null && nextAccessUserId != null && refreshUserId !== nextAccessUserId) {
    throw new AuthSessionChangedError();
  }

  window.localStorage.setItem("access_token", nextAccessToken);
  notifyAuthChanged();
  return nextAccessToken;
}

function buildHeaders(options, accessToken, suppressAuthentication = false) {
  const defaultHeaders = {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };

  if (!options.headers?.["Content-Type"] && !(options.body instanceof FormData)) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  const headers = { ...defaultHeaders, ...options.headers };
  if (suppressAuthentication) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "authorization") delete headers[key];
    }
  }
  return headers;
}

const fetchWithAuth = async (url, options = {}) => {
  const session = captureSession();
  let accessToken = await ensureFreshAccessToken(session, false, options.signal);
  assertSession(session);
  const hadAuthHeader = Boolean(accessToken);

  let response = await fetch(url, {
    ...options,
    headers: buildHeaders(options, accessToken, session.mismatchedPair),
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
    headers: buildHeaders(options, accessToken, session.mismatchedPair),
    signal: options.signal,
  });
  assertSession(session);

  if (response.status === 401) {
    expireSession(session);
  }

  return response;
};

export default fetchWithAuth;
