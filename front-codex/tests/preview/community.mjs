// Local visual fixtures, never imported by the application or deployed as data.
const content = {
  tagline: "一起出发，把远方变成主场。",
  introduction:
    "我们是一群热爱新伊甸的飞行员。这里有探索未知的好奇，也有并肩作战的默契。\n从第一次出站，到下一次远征，我们相信每一位成员都能找到自己的航向。",
  alliance: "远航联盟",
  base_region: "德里克",
  activities: ["pvp", "industry", "training"],
  corp_types: ["sovereignty"],
  region_tags: ["highsec", "nullsec"],
  benefit_keys: ["ship_reimbursement", "fleet_training", "industry_support"],
  benefits_note: "新人有导师带队，定期发放舰队补给。",
  poster_background: "sovereignty-border",
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
    },
  },
];
let draft = {
  ...first.revision,
  id: 11,
  corporation_id: 1,
  corporation: { id: 1, name: first.name, short_name: "VOY" },
  status: "draft",
  version: 1,
  review_reason: "",
};
const application = {
  id: 54,
  corporation: { id: 4, name: "新星军团", short_name: "NOVA" },
  applicant_name: "演示飞行员",
  statement: "本地演示：我是军团管理者，可以通过游戏内联系验证。",
  contact: "游戏内联系：演示飞行员",
  status: "pending",
  review_reason: "",
};
export function resolveCommunityPreview(url, method, body) {
  const p = url.pathname.replace("/api/community/", "");
  let data;
  if (p === "corporations/") {
    const results = demoCorps.filter(
      (c) =>
        (!url.searchParams.get("q") ||
          c.name.includes(url.searchParams.get("q"))) &&
        (!url.searchParams.get("activity") ||
          c.revision.activities.includes(url.searchParams.get("activity"))),
    );
    data = { count: results.length, results };
  } else if (/^corporations\/[123]\/$/.test(p))
    data = demoCorps.find((c) => c.id === Number(p.split("/")[1]));
  else if (p === "capabilities/") data = { can_review: true };
  else if (p === "mine/")
    data = {
      claims: [],
      claims_count: 0,
      corporations: [{ ...first, is_listed: true }],
      corporations_count: 1,
    };
  else if (p === "corporations/1/manage/")
    data = {
      ...first,
      is_listed: true,
      published_revision: first.revision,
      working_revision: draft,
      can_edit: true,
      can_review: true,
    };
  else if (p === "revisions/11/" && method === "PATCH") {
    draft = { ...draft, ...body, version: draft.version + 1 };
    data = draft;
  } else if (p === "reviews/") data = { count: 1, results: [application] };
  else if (p === "reviews/claims/54/") data = application;
  else
    return {
      status: 404,
      data: { detail: "本地界面演示未配置此操作，没有连接生产服务器。" },
    };
  return { status: 200, data };
}
