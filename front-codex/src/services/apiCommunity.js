import API_URL from "./backendSetting";
import fetchWithAuth from "./fetchWithAuth";

export const ACTIVITIES = {
  pvp: "舰队作战",
  pve: "异常与任务",
  industry: "工业制造",
  exploration: "星海探索",
  mining: "采矿生产",
  training: "新人培养",
};
export const CORPORATION_TYPES = {
  pirate: "海盗",
  sovereignty: "主权",
};
export const REGION_TAGS = {
  highsec: "高安",
  lowsec: "低安",
  nullsec: "00 地区",
};
export const BENEFITS = {
  ship_reimbursement: "舰船补损",
  fleet_training: "舰队培训",
  industry_support: "工业/生产支持",
  logistics_support: "物流支持",
  newbro_mentoring: "新人导师",
  skill_sharing: "技能/知识分享",
  pve_fleet: "PVE 舰队",
  pvp_fleet: "PVP 舰队",
};
export const REVISION_STATES = {
  draft: "草稿",
  pending: "审核中",
  approved: "已通过",
  rejected: "未通过",
  withdrawn: "已撤回",
};
const base = `${API_URL}/community/`;

async function checked(response) {
  if (response.ok) return response;
  const data = await response.json().catch(() => ({}));
  const message =
    data.detail ||
    Object.entries(data)
      .map(([k, v]) => `${k}：${Array.isArray(v) ? v.join("；") : v}`)
      .join("；");
  throw new Error(
    typeof message === "string" && message
      ? message
      : `请求失败（${response.status}），请稍后重试`,
  );
}
const request = async (path, options = {}, privateRequest = true) =>
  (
    await checked(
      await (privateRequest ? fetchWithAuth : fetch)(`${base}${path}`, options),
    )
  ).json();
const send = (path, body, method = "POST") =>
  request(path, { method, body: JSON.stringify(body) });
export const listCorporations = (params) =>
  request(`corporations/?${new URLSearchParams(params)}`, {}, false);
export const getCommunityRegions = async () => {
  const response = await fetch(`${API_URL}/regions`);
  if (!response.ok) throw new Error("星域目录暂时不可用");
  return response.json();
};
export const getCommunityConstellations = async (regionID) => {
  const response = await fetch(
    `${API_URL}/constellations?${new URLSearchParams({ regionID })}`,
  );
  if (!response.ok) throw new Error("星座目录暂时不可用");
  return response.json();
};
export const getCommunitySolarSystems = async (constellationID) => {
  const response = await fetch(
    `${API_URL}/solarsystem?${new URLSearchParams({ constellationID })}`,
  );
  if (!response.ok) throw new Error("星系目录暂时不可用");
  return response.json();
};
export const getCorporation = (id) => request(`corporations/${id}/`, {}, false);
export const getCommunityCapabilities = () => request("capabilities/");
export const getMyCorporations = (page = 1) => request(`mine/?page=${page}`);
export const createCorporationClaim = (payload) => send("claims/", payload);
export const getCorporationManagement = (id) =>
  request(`corporations/${id}/manage/`);
export const createCorporationDraft = (id, requestId) =>
  send(`corporations/${id}/draft/`, { request_id: requestId });
export const saveCorporationDraft = (id, payload) =>
  send(`revisions/${id}/`, payload, "PATCH");
export const submitCorporationDraft = (id, version) =>
  send(`revisions/${id}/submit/`, { expected_version: version });
export const withdrawCorporationDraft = (id, version) =>
  send(`revisions/${id}/withdraw/`, { expected_version: version });
export const listCorporationReviews = (kind, page = 1) =>
  request(`reviews/?${new URLSearchParams({ kind, page })}`);
export const getCorporationReview = (kind, id) =>
  request(`reviews/${kind}/${id}/`);
export const decideCorporationReview = (kind, id, decision, reason) =>
  send(`reviews/${kind}/${id}/decision/`, { decision, reason });
export const setCorporationVisibility = (id, isListed, reason) =>
  send(`corporations/${id}/visibility/`, { is_listed: isListed, reason });
export function uploadCorporationMedia(id, file, requestId) {
  const body = new FormData();
  body.append("file", file);
  body.append("request_id", requestId);
  return request(`corporations/${id}/media/`, { method: "POST", body });
}

// Never send an Authorization header or draw arbitrary client-supplied remote images.
export function communityMediaUrl(value) {
  if (!value) return null;
  const origin = new URL(base, window.location.origin);
  const url = new URL(value, origin);
  if (
    url.origin !== origin.origin ||
    url.search ||
    url.hash ||
    !/^\/api\/community\/(?:media\/\d+\/private\/|corporations\/\d+\/media\/\d+\/)$/.test(
      url.pathname,
    )
  )
    throw new Error("图片地址不属于军团图片服务");
  return url.href;
}
export async function fetchCommunityImage(value, isPrivate = false) {
  const url = communityMediaUrl(value);
  if (!url) return null;
  const response = await checked(
    await (isPrivate ? fetchWithAuth : fetch)(url),
  );
  if (
    !/^image\/(png|jpeg|webp)(?:;|$)/i.test(
      response.headers.get("content-type") || "",
    )
  )
    throw new Error("图片响应格式无效");
  const blob = await response.blob();
  if (blob.size > 8 * 1024 * 1024) throw new Error("图片过大，无法预览");
  return URL.createObjectURL(blob);
}
