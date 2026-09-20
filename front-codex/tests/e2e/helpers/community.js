import { installApiMock, json } from "./api";
import { seedAuthenticatedSession } from "./auth";

export const corpContent = {
  tagline: "一起出发，把远方变成主场。",
  introduction: "我们是一群热爱新伊甸的飞行员。\n欢迎一起探索、协作与成长。",
  alliance: "远航联盟",
  base_region: "德里克",
  activities: ["pvp", "industry", "training"],
  corp_types: ["pirate"],
  region_tags: ["lowsec", "nullsec"],
  benefit_keys: ["ship_reimbursement", "fleet_training"],
  benefits_note: "新人有导师带队，定期发放舰队补给。",
  poster_background: "deep-space",
  active_time: "每晚 20:00–23:00",
  recruitment_status: "open",
  requirements: "友善交流，愿意参与团队活动。",
  benefits: "新人指导 · 舰船补损 · 共享工业设施",
  public_contact: "游戏内联系：远航招募官",
  logo_asset_id: null,
  cover_asset_id: null,
  event_title: "周末星海远征",
  event_time: "周六 20:00",
  event_location: "军团集结点",
  event_description: "一起探索未知星域。欢迎新老飞行员参加。",
};
export const corporation = {
  id: 1,
  name: "远航者军团",
  short_name: "VOY",
  published_at: "2026-09-20T12:00:00",
  logo_url: null,
  cover_url: null,
  revision: { id: 10, status: "approved", version: 1, ...corpContent },
};

export async function communityFixture(
  page,
  {
    auth = false,
    staff = false,
    empty = false,
    fails = false,
    pending = false,
  } = {},
) {
  if (auth)
    await seedAuthenticatedSession(page, {
      user_id: 23,
      userName: "corp_owner",
    });
  let revision = {
    id: 11,
    corporation_id: 1,
    corporation: { id: 1, name: corporation.name, short_name: "VOY" },
    status: pending ? "pending" : "draft",
    version: 1,
    ...corpContent,
    review_reason: "",
    logo_url: null,
    cover_url: null,
  };
  let claims = [];
  let decisions = [];
  const posts = [];
  await installApiMock(page, async ({ url, method, body }) => {
    const p = url.pathname.replace("/api/community/", "");
    if (!url.pathname.startsWith("/api/community/")) return json([]);
    if (p === "corporations/" && method === "GET")
      return fails
        ? json({ detail: "军团数据暂时不可用" }, 503)
        : json({ count: empty ? 0 : 1, results: empty ? [] : [corporation] });
    if (p === "corporations/1/" && method === "GET") return json(corporation);
    if (p === "capabilities/") return json({ can_review: staff });
    if (p === "mine/")
      return json({
        claims,
        claims_count: claims.length,
        corporations_count: 1,
        corporations: [
          { id: 1, name: corporation.name, short_name: "VOY", is_listed: true },
        ],
      });
    if (p === "claims/" && method === "POST") {
      posts.push({ path: p, body });
      const claim = {
        id: 2,
        corporation: { id: 2, name: body.name, short_name: body.short_name },
        status: "pending",
        ...body,
      };
      claims = [claim];
      return json(claim, 201);
    }
    if (p === "corporations/1/manage/")
      return json({
        id: 1,
        name: corporation.name,
        short_name: "VOY",
        is_listed: true,
        published_revision: corporation.revision,
        working_revision: revision,
        can_edit: true,
        can_review: staff,
      });
    if (p === "corporations/1/draft/") {
      revision = {
        ...revision,
        status: "draft",
        version: revision.version + 1,
      };
      return json(revision, 201);
    }
    if (p === "revisions/11/" && method === "PATCH") {
      posts.push({ path: p, body });
      revision = { ...revision, ...body, version: revision.version + 1 };
      return json(revision);
    }
    if (p === "revisions/11/submit/" || p === "revisions/11/withdraw/") {
      posts.push({ path: p, body });
      revision = {
        ...revision,
        status: p.includes("submit") ? "pending" : "withdrawn",
        version: revision.version + 1,
      };
      return json(revision);
    }
    if (p === "reviews/")
      return json({
        count: decisions.length ? 0 : 1,
        results: decisions.length
          ? []
          : [
              {
                id: 54,
                corporation: { id: 2, name: "新星军团", short_name: "NOVA" },
                applicant_name: "new_pilot",
                statement: "我是军团管理者，可以游戏内验证。",
                contact: "游戏内联系 new_pilot",
                status: "pending",
              },
            ],
      });
    if (p === "reviews/claims/54/")
      return json({
        id: 54,
        corporation: { id: 2, name: "新星军团", short_name: "NOVA" },
        applicant_name: "new_pilot",
        statement: "我是军团管理者，可以游戏内验证。",
        contact: "游戏内联系 new_pilot",
        status: "pending",
      });
    if (p === "reviews/claims/54/decision/") {
      decisions.push(body);
      return json({
        id: 54,
        status: body.decision === "approve" ? "approved" : "rejected",
      });
    }
    return json({ detail: `Unhandled community fixture: ${method} ${p}` }, 404);
  });
  return { posts, decisions };
}
