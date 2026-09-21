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
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new TacticalError(
      data.detail || `请求未完成（${response.status}），请稍后重试。`,
      response.status,
      data.code,
    );
  return data;
}
const post = (path, body, method = "POST") =>
  request(path, { method, body: JSON.stringify(body) });
export const newRequestId = () => crypto.randomUUID();
export const listTacticalOrganizations = () => request("organizations/");
export const createTacticalOrganization = (name, requestId = newRequestId()) =>
  post("organizations/", { name, request_id: requestId });
export const joinTacticalOrganization = (
  inviteCode,
  requestId = newRequestId(),
) => post("join/", { invite_code: inviteCode, request_id: requestId });
export const getTacticalMembers = (id) =>
  request(`organizations/${id}/members/`);
export const sendTacticalCommand = (id, payload) =>
  post(`organizations/${id}/commands/`, payload);
export const enterTacticalBoard = (id, connectionId) =>
  post(`organizations/${id}/presence/`, { connection_id: connectionId });
export const leaveTacticalBoard = (id, connectionId) =>
  post(
    `organizations/${id}/presence/`,
    { connection_id: connectionId },
    "DELETE",
  );
export const getTacticalSnapshot = (id, connectionId) =>
  request(
    `organizations/${id}/snapshot/?${new URLSearchParams({ connection_id: connectionId })}`,
  );
export const getTacticalMap = (id) => request(`organizations/${id}/map/`);
export const getTacticalCatalog = (id, kind, query = "") =>
  request(
    `organizations/${id}/catalog/?${new URLSearchParams({ kind, q: query })}`,
  );
