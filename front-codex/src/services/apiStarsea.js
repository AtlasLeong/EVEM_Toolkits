import API_URL from "./backendSetting";
import fetchWithAuth from "./fetchWithAuth";
import { safeMediaUrl } from "../utils/starsea";

const base = `${API_URL}/starsea/`;
async function checked(response) {
  if (response.ok) return response;
  const value = await response.json().catch(() => ({}));
  const error = new Error(
    typeof value.detail === "string"
      ? value.detail
      : Object.entries(value)
          .map(
            ([key, v]) =>
              `${key}：${typeof v === "string" ? v : JSON.stringify(v)}`,
          )
          .join("；") || `请求失败（${response.status}）`,
  );
  error.status = response.status;
  throw error;
}
const query = (params) =>
  new URLSearchParams(
    Object.entries(params || {}).filter(
      ([, value]) => value !== "" && value != null,
    ),
  ).toString();
const request = async (path, options = {}, isPrivate = true) =>
  (
    await checked(
      await (isPrivate ? fetchWithAuth : fetch)(`${base}${path}`, {
        cache: "no-store",
        credentials: "omit",
        ...options,
      }),
    )
  ).json();
const send = (path, body, method = "POST") =>
  request(path, { method, body: JSON.stringify(body) });
export const listPosts = (params) =>
  request(`posts/?${query(params)}`, {}, false);
export const getPost = (id) => request(`posts/${id}/`, {}, false);
export const getMine = (page) => request(`mine/?page=${page}`);
export const getManagement = (id) => request(`posts/${id}/manage/`);
export const getCapabilities = () => request("capabilities/");
export const createPost = (content, requestId) =>
  send("posts/", { content, request_id: requestId });
export const versionOf = (entry) => ({
  expected_revision_id: entry.revision.id,
  expected_version: entry.revision.version,
});
export const saveDraft = (entry, content) =>
  send(`posts/${entry.id}/draft/`, { ...versionOf(entry), content }, "PATCH");
export const cloneDraft = (entry) =>
  send(`posts/${entry.id}/draft/`, versionOf(entry));
export const submitPost = (entry) =>
  send(`posts/${entry.id}/submit/`, versionOf(entry));
export const withdrawPost = (entry) =>
  send(`posts/${entry.id}/withdraw/`, versionOf(entry));
export const listReviews = (page) => request(`reviews/?page=${page}`);
export const getReview = (id) => request(`reviews/${id}/`);
export const decideReview = (entry, decision, reason) =>
  send(`reviews/${entry.revision.id}/decision/`, {
    decision,
    reason,
    expected_version: entry.revision.version,
  });
export const setVisibility = (id, isListed, reason) =>
  send(`posts/${id}/visibility/`, { is_listed: isListed, reason });
export const searchShips = (params, signal) =>
  request(`ships/?${query(params)}`, { signal }, false);
export const getLocations = (kind, parentId, signal) =>
  request(
    `locations/?${query({ kind, parent_id: parentId })}`,
    { signal },
    false,
  );
export const searchCorporations = (q, signal) =>
  request(`corporations/?${query({ q })}`, { signal }, false);
export function uploadMedia(id, file, requestId) {
  const body = new FormData();
  body.append("file", file);
  body.append("request_id", requestId);
  return request(`posts/${id}/media/`, { method: "POST", body });
}
export async function fetchImage(id, isPrivate, signal) {
  const url = safeMediaUrl(`${base}media/${id}/`, API_URL);
  const response = await checked(
    await (isPrivate ? fetchWithAuth : fetch)(url, {
      signal,
      cache: "no-store",
      credentials: "omit",
    }),
  );
  if (
    !/^image\/(png|jpeg|webp)(?:;|$)/i.test(
      response.headers.get("content-type") || "",
    )
  )
    throw new Error("图片格式无效");
  const blob = await response.blob();
  if (blob.size > 8 * 1024 * 1024) throw new Error("图片过大");
  return URL.createObjectURL(blob);
}
