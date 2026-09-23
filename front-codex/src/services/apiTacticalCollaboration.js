import API_URL from "./backendSetting";
import fetchWithAuth from "./fetchWithAuth";
import { openTacticalSocket } from "../utils/tacticalSocket";

const base = `${API_URL}/tactical/`;
// Called only after an authenticated HTTP admission refreshed the access token.
export const openTacticalStream = (options) => openTacticalSocket({
  ...options, apiUrl: API_URL, token: window.localStorage.getItem('access_token'),
});
export class TacticalError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
async function request(path, options = {}) {
  const response = await fetchWithAuth(`${base}${path}`, options);
  const data = await response.json().catch(failure => {
    if (options.signal?.aborted) throw failure;
    return {};
  });
  if (!response.ok)
    throw new TacticalError(
      data.detail || `请求未完成（${response.status}），请稍后重试。`,
      response.status,
      data.code,
    );
  return data;
}
const post = (path, body, method = "POST", options = {}) =>
  request(path, { ...options, method, body: JSON.stringify(body) });
export const newRequestId = () => crypto.randomUUID();
export const listTacticalOrganizations = () => request("organizations/");
export const createTacticalOrganization = (name, requestId = newRequestId()) =>
  post("organizations/", { name, request_id: requestId });
export const joinTacticalOrganization = (
  inviteCode,
  requestId = newRequestId(),
) => post("join/", { invite_code: inviteCode, request_id: requestId });
export const getTacticalMembers = (id, options = {}) =>
  request(`organizations/${id}/members/`, options);
export const sendTacticalCommand = (id, payload, options = {}) =>
  request(`organizations/${id}/commands/`, {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
export const enterTacticalBoard = (id, connectionId, options = {}) =>
  post(`organizations/${id}/presence/`, { connection_id: connectionId }, "POST", options);
export const leaveTacticalBoard = (id, connectionId, options = {}) =>
  post(
    `organizations/${id}/presence/`,
    { connection_id: connectionId },
    "DELETE",
    options,
  );
export const getTacticalSnapshot = (id, connectionId, options = {}) =>
  request(
    `organizations/${id}/snapshot/?${new URLSearchParams({ connection_id: connectionId })}`,
    options,
  );
export const getTacticalMap = (id) => request(`organizations/${id}/map/`);
export const getTacticalCatalog = (id, kind, query = "") =>
  request(
    `organizations/${id}/catalog/?${new URLSearchParams({ kind, q: query })}`,
  );
