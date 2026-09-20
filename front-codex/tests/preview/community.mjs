// Local visual fixtures, never imported by the application or deployed as data.
export const communityLocationCatalog = {
  regions: [
    { r_id: "derelik", r_title: "德里克", r_safetylvl: 0.5 },
    { r_id: "volgo", r_title: "伏尔戈", r_safetylvl: 0.59 },
    { r_id: "silent", r_title: "静寂谷", r_safetylvl: -0.29 },
  ],
  constellations: [
    {
      region_id: "derelik",
      co_id: "12",
      co_title: "玛莫纳",
      co_safetylvl: 0.16,
    },
    { region_id: "volgo", co_id: "11", co_title: "米沃拉", co_safetylvl: 0.2 },
    {
      region_id: "silent",
      co_id: "13",
      co_title: "F-V9QW",
      co_safetylvl: -0.77,
    },
  ],
  systems: [
    {
      constellation_id: "12",
      ss_id: "22",
      ss_title: "库哈拉赫",
      ss_safetylvl: 0.18,
    },
    {
      constellation_id: "11",
      ss_id: "21",
      ss_title: "夫斯库仑",
      ss_safetylvl: 0.22,
    },
    {
      constellation_id: "13",
      ss_id: "23",
      ss_title: "Y-ZXIO",
      ss_safetylvl: -1.1,
    },
  ],
};
export const demoLocation = (ids) => {
  if (!ids) return null;
  const region = communityLocationCatalog.regions.find(
    (item) => item.r_id === ids.region_id,
  );
  const constellation = communityLocationCatalog.constellations.find(
    (item) =>
      item.co_id === ids.constellation_id && item.region_id === ids.region_id,
  );
  const system = communityLocationCatalog.systems.find(
    (item) =>
      item.ss_id === ids.solarsystem_id &&
      item.constellation_id === constellation?.co_id,
  );
  return region
    ? {
        region_id: region.r_id,
        constellation_id: constellation?.co_id ?? null,
        solarsystem_id: system?.ss_id ?? null,
        region_name: region.r_title,
        constellation_name: constellation?.co_title || "",
        solarsystem_name: system?.ss_title || "",
        security:
          system?.ss_safetylvl ??
          constellation?.co_safetylvl ??
          region.r_safetylvl,
      }
    : null;
};
const content = {
  tagline: "一起出发，把远方变成主场。",
  introduction:
    "我们是一群热爱新伊甸的飞行员。这里有探索未知的好奇，也有并肩作战的默契。\n从第一次出站，到下一次远征，我们相信每一位成员都能找到自己的航向。",
  alliance: "远航联盟",
  base_region: "德里克",
  base_location: demoLocation({
    region_id: "derelik",
    constellation_id: "12",
    solarsystem_id: "22",
  }),
  activities: ["pvp", "industry", "training"],
  corp_types: ["sovereignty"],
  region_tags: ["highsec", "nullsec"],
  benefit_keys: ["ship_reimbursement", "fleet_training", "industry_support"],
  benefits_note: "新人有导师带队，定期发放舰队补给。",
  poster_background: "expedition-fleet",
  active_time: "每晚 20:00–23:00",
  recruitment_status: "open",
  requirements:
    "友善交流，愿意参与团队活动。无论你是新飞行员，还是经验丰富的老舰长，都欢迎加入。",
  benefits: "新人指导 · 舰船补损\n共享工业设施 · 定期舰队活动",
  public_contact: "游戏内联系：远航招募官",
  logo_asset_id: null,
  cover_asset_id: null,
  logo_url: null,
  cover_url: null,
  event_title: "周末星海远征",
  event_time: "周六 20:00",
  event_location: "军团集结点",
  event_description:
    "一起探索未知星域。欢迎新老飞行员参加，提前联系指挥确认舰队配置。",
};
const first = {
  id: 1,
  name: "远航者军团",
  short_name: "VOY",
  published_at: "2026-09-20T12:00:00",
  logo_url: null,
  cover_url: null,
  revision: { id: 10, ...content },
};
const demoCorps = [
  first,
  {
    ...first,
    id: 2,
    name: "曙光工业联合体",
    short_name: "DAWN",
    revision: {
      ...first.revision,
      tagline: "让每一份资源，成为下一次远航的底气。",
      activities: ["industry", "mining"],
      base_region: "伏尔戈",
      base_location: demoLocation({
        region_id: "volgo",
        constellation_id: "11",
        solarsystem_id: "21",
      }),
    },
  },
  {
    ...first,
    id: 3,
    name: "边境探索者",
    short_name: "FRONTIER",
    revision: {
      ...first.revision,
      tagline: "航线之外，还有无限可能。",
      activities: ["exploration", "pve"],
      base_region: "静寂谷",
      base_location: demoLocation({
        region_id: "silent",
        constellation_id: "13",
        solarsystem_id: "23",
      }),
    },
  },
];
const copy = (value) => structuredClone(value);
const now = () => new Date().toISOString();
const fail = (status, detail) => {
  throw Object.assign(new Error(detail), { status });
};
const identity = ({ id, name, short_name }) => ({ id, name, short_name });
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const mediaUrl = (corp, id, publicView = false) =>
  id
    ? publicView
      ? `/api/community/corporations/${corp}/media/${id}/`
      : `/api/community/media/${id}/private/`
    : null;
const textLimits = {
  tagline: 80,
  introduction: 5000,
  alliance: 80,
  base_region: 80,
  active_time: 120,
  requirements: 1500,
  benefits: 1500,
  benefits_note: 500,
  public_contact: 200,
  event_title: 80,
  event_time: 120,
  event_location: 120,
  event_description: 800,
};
const lists = {
  activities: ["pvp", "pve", "industry", "exploration", "mining", "training"],
  corp_types: ["pirate", "sovereignty"],
  region_tags: ["highsec", "lowsec", "nullsec"],
  benefit_keys: [
    "ship_reimbursement",
    "fleet_training",
    "industry_support",
    "logistics_support",
    "newbro_mentoring",
    "skill_sharing",
    "pve_fleet",
    "pvp_fleet",
  ],
};
const backgrounds = [
  "expedition-fleet",
  "ringed-planet",
  "spiral-galaxy",
  "orbital-shipyard",
  "black-hole",
  "stellar-nursery",
  "frozen-frontier",
  "wreckfield",
];
const emptyContent = () => ({
  ...Object.fromEntries(Object.keys(textLimits).map((k) => [k, ""])),
  ...Object.fromEntries(Object.keys(lists).map((k) => [k, []])),
  poster_background: "expedition-fleet",
  recruitment_status: "open",
  base_location: null,
  logo_asset_id: null,
  cover_asset_id: null,
});
const contentKeys = Object.keys(emptyContent());

// An isolated, process-local model. The HTTP preview and contract tests use this
// exact handler; no request is ever proxied to a production server.
export function createCommunitySandbox() {
  const corporations = new Map();
  const revisions = new Map();
  const claims = new Map();
  const assets = new Map();
  const requests = new Map();
  let nextCorp = 4,
    nextClaim = 54,
    nextRevision = 40,
    nextAsset = 1;
  for (const demo of demoCorps) {
    const revisionId = demo.id * 10;
    revisions.set(revisionId, {
      id: revisionId,
      corporation_id: demo.id,
      content: copy(
        Object.fromEntries(
          contentKeys.map((k) => [k, demo.revision[k] ?? emptyContent()[k]]),
        ),
      ),
      status: "approved",
      version: 1,
      created_at: now(),
      updated_at: now(),
      submitted_at: now(),
      reviewed_at: demo.published_at,
      review_reason: "",
    });
    corporations.set(demo.id, {
      ...identity(demo),
      owner: demo.id === 1 ? "owner" : `fixture-${demo.id}`,
      is_listed: true,
      published: revisionId,
      working: null,
    });
  }
  revisions.set(11, {
    ...copy(revisions.get(10)),
    id: 11,
    status: "draft",
    submitted_at: null,
    reviewed_at: null,
  });
  corporations.get(1).working = 11;
  const required = (condition, status = 400, message = "请求内容无效。") => {
    if (!condition) fail(status, message);
  };
  const getCorp = (id) => {
    const c = corporations.get(Number(id));
    required(c, 404, "军团不存在或尚未公开。");
    return c;
  };
  const owns = (corp, role, staffRead = false) =>
    required(
      corp.owner === role || (staffRead && role === "reviewer"),
      404,
      "军团不存在或没有管理权限。",
    );
  const revData = (rev, publicView = false) => {
    if (!rev) return null;
    const result = { id: rev.id, ...copy(rev.content) };
    if (!publicView)
      Object.assign(result, {
        corporation_id: rev.corporation_id,
        corporation: identity(getCorp(rev.corporation_id)),
        ...Object.fromEntries(
          [
            "status",
            "version",
            "created_at",
            "updated_at",
            "submitted_at",
            "reviewed_at",
            "review_reason",
          ].map((k) => [k, rev[k]]),
        ),
        logo_url: mediaUrl(rev.corporation_id, rev.content.logo_asset_id),
        cover_url: mediaUrl(rev.corporation_id, rev.content.cover_asset_id),
      });
    return result;
  };
  const claimData = (claim) => ({
    ...Object.fromEntries(
      [
        "id",
        "statement",
        "contact",
        "status",
        "created_at",
        "reviewed_at",
        "review_reason",
      ].map((k) => [k, claim[k]]),
    ),
    corporation: identity(getCorp(claim.corporation_id)),
  });
  const manageData = (corp, role) => ({
    ...identity(corp),
    is_listed: corp.is_listed,
    published_revision: revData(revisions.get(corp.published)),
    working_revision: revData(revisions.get(corp.working)),
    can_edit: corp.owner === role,
    can_review: role === "reviewer",
  });
  const publicData = (corp) => ({
    ...identity(corp),
    published_at: revisions.get(corp.published).reviewed_at,
    revision: revData(revisions.get(corp.published), true),
    logo_url: mediaUrl(
      corp.id,
      revisions.get(corp.published).content.logo_asset_id,
      true,
    ),
    cover_url: mediaUrl(
      corp.id,
      revisions.get(corp.published).content.cover_asset_id,
      true,
    ),
  });
  const page = (items, url) => {
    const number = Number(url.searchParams.get("page") || 1);
    required(Number.isInteger(number) && number > 0);
    return items.slice((number - 1) * 20, number * 20);
  };
  const checkKeys = (data, allowed, requiredKeys = []) =>
    required(
      data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        Object.keys(data).every((k) => allowed.includes(k)) &&
        requiredKeys.every((k) => k in data),
    );
  const text = (value, limit, blank = true) => {
    required(
      typeof value === "string" &&
        value.trim().length <= limit &&
        (blank || value.trim()),
    );
    return value.trim();
  };
  const once = (kind, role, requestId, fingerprint, execute) => {
    required(uuid(requestId), 400, "提交标识无效。");
    const key = `${kind}:${role}:${requestId}`;
    const previous = requests.get(key);
    if (previous) {
      required(
        previous.fingerprint === fingerprint,
        409,
        "同一提交标识不能用于不同内容。",
      );
      return { status: 200, data: previous.read() };
    }
    const value = execute();
    requests.set(key, { fingerprint, read: value.read });
    return { status: value.status || 201, data: value.read() };
  };
  return function resolve(
    url,
    method = "GET",
    body = {},
    { role = "guest" } = {},
  ) {
    try {
      const p = url.pathname.replace("/api/community/", "");
      const match = (regex) => p.match(regex);
      let m;
      if (method === "GET" && p === "corporations/") {
        const found = [...corporations.values()]
          .filter((c) => c.is_listed && c.published)
          .filter((c) => {
            const r = revisions.get(c.published).content;
            return (
              (!url.searchParams.get("q") ||
                `${c.name} ${c.short_name}`
                  .toLowerCase()
                  .includes(url.searchParams.get("q").toLowerCase())) &&
              (!url.searchParams.get("activity") ||
                r.activities.includes(url.searchParams.get("activity"))) &&
              (!url.searchParams.get("region") ||
                r.base_region.includes(url.searchParams.get("region")))
            );
          });
        return {
          status: 200,
          data: {
            count: found.length,
            results: page(found, url).map(publicData),
          },
        };
      }
      if (method === "GET" && (m = match(/^corporations\/(\d+)\/$/))) {
        const c = getCorp(m[1]);
        required(c.is_listed && c.published, 404, "军团不存在或尚未公开。");
        return { status: 200, data: publicData(c) };
      }
      if (
        method === "GET" &&
        (m = match(/^corporations\/(\d+)\/media\/(\d+)\/$/))
      ) {
        const c = getCorp(m[1]);
        const asset = assets.get(Number(m[2]));
        required(
          c.is_listed &&
            c.published &&
            asset?.corporation_id === c.id &&
            [
              revisions.get(c.published).content.logo_asset_id,
              revisions.get(c.published).content.cover_asset_id,
            ].includes(asset.id),
          404,
          "图片尚未公开。",
        );
        return {
          status: 200,
          bytes: asset.bytes,
          contentType: asset.content_type,
        };
      }
      required(
        ["owner", "reviewer"].includes(role),
        401,
        "请使用本地沙盒身份入口，无需真实密码。",
      );
      if (method === "GET" && p === "capabilities/")
        return { status: 200, data: { can_review: role === "reviewer" } };
      if (method === "GET" && p === "mine/") {
        const owned = [...corporations.values()].filter(
          (c) => c.owner === role,
        );
        const ownClaims = [...claims.values()].filter(
          (c) => c.applicant === role,
        );
        return {
          status: 200,
          data: {
            corporations: page(owned, url).map((c) => manageData(c, role)),
            corporations_count: owned.length,
            claims: page(ownClaims, url).map(claimData),
            claims_count: ownClaims.length,
          },
        };
      }
      if (method === "POST" && p === "claims/") {
        const existing = "corporation_id" in body;
        checkKeys(
          body,
          existing
            ? ["request_id", "corporation_id", "statement", "contact"]
            : ["request_id", "name", "short_name", "statement", "contact"],
          existing
            ? ["request_id", "corporation_id", "statement", "contact"]
            : ["request_id", "name", "short_name", "statement", "contact"],
        );
        const statement = text(body.statement, 1000, false),
          contact = text(body.contact, 200, false);
        const name = existing
            ? null
            : text(body.name.normalize("NFKC"), 80, false),
          shortName = existing ? null : text(body.short_name, 20);
        return once(
          "claim",
          role,
          body.request_id,
          JSON.stringify([
            body.corporation_id,
            name?.toLowerCase(),
            shortName,
            statement,
            contact,
          ]),
          () => {
            let c = existing
              ? getCorp(body.corporation_id)
              : [...corporations.values()].find(
                  (c) =>
                    c.name.normalize("NFKC").toLowerCase() ===
                    name.toLowerCase(),
                );
            if (!c) {
              c = {
                id: nextCorp++,
                name,
                short_name: shortName,
                owner: null,
                is_listed: true,
                working: null,
                published: null,
              };
              corporations.set(c.id, c);
            }
            required(
              !c.owner &&
                ![...claims.values()].some(
                  (claim) =>
                    claim.corporation_id === c.id &&
                    claim.applicant === role &&
                    claim.status === "pending",
                ),
              409,
              "军团已被认领或申请正在审核。",
            );
            const claim = {
              id: nextClaim++,
              corporation_id: c.id,
              applicant: role,
              statement,
              contact,
              status: "pending",
              created_at: now(),
              reviewed_at: null,
              review_reason: "",
            };
            claims.set(claim.id, claim);
            return { read: () => claimData(claim) };
          },
        );
      }
      if (method === "GET" && (m = match(/^claims\/(\d+)\/$/))) {
        const claim = claims.get(Number(m[1]));
        required(
          claim && (claim.applicant === role || role === "reviewer"),
          404,
        );
        return { status: 200, data: claimData(claim) };
      }
      if (method === "GET" && (m = match(/^corporations\/(\d+)\/manage\/$/))) {
        const c = getCorp(m[1]);
        owns(c, role, true);
        return { status: 200, data: manageData(c, role) };
      }
      if (method === "POST" && (m = match(/^corporations\/(\d+)\/draft\/$/))) {
        checkKeys(body, ["request_id"], ["request_id"]);
        const c = getCorp(m[1]);
        owns(c, role);
        return once("draft", role, body.request_id, String(c.id), () => {
          let r = revisions.get(c.working);
          required(r?.status !== "pending", 409, "请先撤回正在审核的版本。");
          const created = !r || r.status !== "draft";
          if (created) {
            const source = r || revisions.get(c.published);
            r = {
              id: nextRevision++,
              corporation_id: c.id,
              content: source ? copy(source.content) : emptyContent(),
              status: "draft",
              version: 1,
              created_at: now(),
              updated_at: now(),
              submitted_at: null,
              reviewed_at: null,
              review_reason: "",
            };
            revisions.set(r.id, r);
            c.working = r.id;
          }
          return { status: created ? 201 : 200, read: () => revData(r) };
        });
      }
      if (
        (method === "PATCH" && (m = match(/^revisions\/(\d+)\/$/))) ||
        (method === "POST" &&
          (m = match(/^revisions\/(\d+)\/(submit|withdraw)\/$/)))
      ) {
        const r = revisions.get(Number(m[1]));
        required(r, 404);
        const c = getCorp(r.corporation_id);
        owns(c, role);
        checkKeys(
          body,
          method === "PATCH"
            ? ["expected_version", ...contentKeys]
            : ["expected_version"],
          ["expected_version"],
        );
        required(
          Number.isInteger(body.expected_version) && body.expected_version > 0,
        );
        required(
          c.working === r.id &&
            r.version === body.expected_version &&
            r.status === (m[2] === "withdraw" ? "pending" : "draft"),
          409,
          "版本已变化，请刷新后重试。",
        );
        if (method === "PATCH") {
          const next = copy(r.content);
          for (const [k, limit] of Object.entries(textLimits))
            if (k in body) next[k] = text(body[k], limit);
          for (const [k, allowed] of Object.entries(lists))
            if (k in body) {
              required(
                Array.isArray(body[k]) &&
                  body[k].length <= allowed.length &&
                  new Set(body[k]).size === body[k].length &&
                  body[k].every((v) => allowed.includes(v)),
              );
              next[k] = [...body[k]];
            }
          for (const k of ["logo_asset_id", "cover_asset_id"])
            if (k in body) {
              required(
                body[k] === null ||
                  (Number.isInteger(body[k]) &&
                    assets.get(body[k])?.corporation_id === c.id),
                400,
                "图片不属于本军团。",
              );
              next[k] = body[k];
            }
          if ("poster_background" in body) {
            required(backgrounds.includes(body.poster_background));
            next.poster_background = body.poster_background;
          }
          if ("recruitment_status" in body) {
            required(["open", "closed"].includes(body.recruitment_status));
            next.recruitment_status = body.recruitment_status;
          }
          if ("base_location" in body) {
            if (body.base_location === null) {
              next.base_location = null;
              if (r.content.base_location) next.base_region = "";
            } else {
              const ids = body.base_location;
              checkKeys(
                ids,
                ["region_id", "constellation_id", "solarsystem_id"],
                ["region_id"],
              );
              const linked = demoLocation(ids);
              required(
                linked &&
                  (!ids.constellation_id ||
                    linked.constellation_id === ids.constellation_id) &&
                  (!ids.solarsystem_id ||
                    linked.solarsystem_id === ids.solarsystem_id),
                400,
                "驻地层级关系无效。",
              );
              next.base_location = linked;
              next.base_region = linked.region_name;
            }
          } else if (next.base_location)
            next.base_region = next.base_location.region_name;
          r.content = next;
        } else if (m[2] === "submit") {
          text(r.content.introduction, textLimits.introduction, false);
          text(r.content.public_contact, textLimits.public_contact, false);
          r.status = "pending";
          r.submitted_at = now();
        } else r.status = "withdrawn";
        r.version++;
        r.updated_at = now();
        return { status: 200, data: revData(r) };
      }
      if (method === "GET" && (m = match(/^media\/(\d+)\/private\/$/))) {
        const asset = assets.get(Number(m[1]));
        required(asset, 404);
        owns(getCorp(asset.corporation_id), role, true);
        return {
          status: 200,
          bytes: asset.bytes,
          contentType: asset.content_type,
        };
      }
      if (method === "POST" && (m = match(/^corporations\/(\d+)\/media\/$/))) {
        const c = getCorp(m[1]);
        owns(c, role);
        checkKeys(body, ["file", "request_id"], ["file", "request_id"]);
        const file = body.file;
        required(
          file &&
            Buffer.isBuffer(file.bytes) &&
            file.bytes.length > 0 &&
            file.bytes.length <= 5 * 1024 * 1024,
          400,
          "每张图片需在 5 MiB 以内。",
        );
        required(
          file.validated === true &&
            ["image/png", "image/jpeg", "image/webp"].includes(file.type),
          400,
          "图片签名或格式无效。",
        );
        return once(
          "media",
          role,
          body.request_id,
          `${c.id}:${file.hash}`,
          () => {
            const asset = {
              id: nextAsset++,
              corporation_id: c.id,
              bytes: Buffer.from(file.bytes),
              content_type: file.type,
              size: file.bytes.length,
              width: file.width,
              height: file.height,
            };
            assets.set(asset.id, asset);
            return {
              read: () => ({
                id: asset.id,
                width: asset.width,
                height: asset.height,
                size: asset.size,
                content_type: asset.content_type,
                private_url: mediaUrl(c.id, asset.id),
              }),
            };
          },
        );
      }
      if (p.startsWith("reviews/") || p.endsWith("/visibility/"))
        required(role === "reviewer", 403, "此操作仅供演示审核员使用。");
      if (method === "GET" && p === "reviews/") {
        const kind = url.searchParams.get("kind") || "claims";
        required(["claims", "revisions"].includes(kind));
        const found = [
          ...(kind === "claims" ? claims : revisions).values(),
        ].filter((i) => i.status === "pending");
        return {
          status: 200,
          data: {
            count: found.length,
            results: page(found, url).map(
              kind === "claims" ? claimData : (r) => revData(r),
            ),
          },
        };
      }
      if ((m = match(/^reviews\/(claims|revisions)\/(\d+)\/(decision\/)?$/))) {
        const item = (m[1] === "claims" ? claims : revisions).get(Number(m[2]));
        required(
          item && !(m[1] === "revisions" && item.status === "draft"),
          404,
        );
        if (method === "POST" && m[3]) {
          checkKeys(body, ["decision", "reason"], ["decision", "reason"]);
          required(["approve", "reject"].includes(body.decision));
          const reason = text(body.reason, 1000, body.decision === "approve");
          required(item.status === "pending", 409, "此申请已处理。");
          const c = getCorp(item.corporation_id);
          if (m[1] === "claims" && body.decision === "approve") {
            required(!c.owner, 409);
            c.owner = item.applicant;
          }
          if (m[1] === "revisions") {
            required(c.working === item.id, 409);
            if (body.decision === "approve") c.published = item.id;
            item.version++;
            item.updated_at = now();
          }
          item.status = body.decision === "approve" ? "approved" : "rejected";
          item.reviewed_at = now();
          item.review_reason = reason;
        } else required(method === "GET" && !m[3], 405);
        return {
          status: 200,
          data: m[1] === "claims" ? claimData(item) : revData(item),
        };
      }
      if (
        method === "POST" &&
        (m = match(/^corporations\/(\d+)\/visibility\/$/))
      ) {
        checkKeys(body, ["is_listed", "reason"], ["is_listed", "reason"]);
        required(typeof body.is_listed === "boolean");
        text(body.reason, 1000, false);
        const c = getCorp(m[1]);
        c.is_listed = body.is_listed;
        return { status: 200, data: manageData(c, role) };
      }
      return {
        status: 404,
        data: { detail: "本地沙盒未配置此操作，没有连接生产服务器。" },
      };
    } catch (error) {
      return {
        status: error.status || 400,
        data: { detail: error.status ? error.message : "请求内容无效。" },
      };
    }
  };
}
export const resolveCommunityPreview = createCommunitySandbox();
