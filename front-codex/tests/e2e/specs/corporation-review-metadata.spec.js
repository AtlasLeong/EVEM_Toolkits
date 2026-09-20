import { test, expect } from "@playwright/test";
import { communityFixture } from "../helpers/community";
import { json } from "../helpers/api";

const reviewRevision = {
  id: 91,
  corporation_id: 1,
  corporation: { id: 1, name: "远航者军团", short_name: "VOY" },
  status: "pending",
  version: 3,
  tagline: "一起出发，把远方变成主场。",
  introduction: "我们是一群热爱新伊甸的飞行员。",
  alliance: "远航联盟",
  base_region: "德里克",
  base_location: {
    region_id: "derelik",
    constellation_id: "12",
    solarsystem_id: "22",
    region_name: "德里克",
    constellation_name: "玛莫纳",
    solarsystem_name: "库哈拉赫",
    security: 0.18,
  },
  activities: ["pvp"],
  activity_description: "主权战与反收割，每周组织小队游猎。",
  custom_activity_tags: ["反收割", "小队游猎"],
  activity_content_kind: "overview",
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
  benefits_note: "每周有导师答疑，重大行动提供后勤补给。",
  benefits: "舰船补损 · 舰队培训",
  poster_background: "pirate-tide",
  active_time: "每晚 20:00–23:00",
  recruitment_status: "open",
  requirements: "友善交流，愿意参与团队活动。",
  public_contact: "游戏内联系：远航招募官",
  event_title: "周末星海远征",
  event_time: "周六 20:00",
  event_location: "军团集结点",
  event_description: "一起探索未知星域。",
  logo_url: null,
  cover_url: null,
};

test("审核详情在画布外展示完整军团元数据", async ({ page }) => {
  await communityFixture(page, { auth: true, staff: true });
  await page.route("**/api/community/reviews/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.endsWith("/reviews/") &&
      url.searchParams.get("kind") === "revisions"
    ) {
      return route.fulfill(
        json({
          count: 1,
          results: [
            {
              id: reviewRevision.id,
              corporation: reviewRevision.corporation,
              author_name: "corp_owner",
              status: "pending",
            },
          ],
        }),
      );
    }
    if (url.pathname.endsWith(`/reviews/revisions/${reviewRevision.id}/`)) {
      return route.fulfill(json(reviewRevision));
    }
    return route.fallback();
  });

  await page.goto("/corporations/review");
  await page.getByRole("button", { name: "资料审核", exact: true }).click();
  await page.getByRole("button", { name: /远航者军团/ }).click();

  const detail = page.locator(".corp-review-detail");
  await expect(detail.getByText("军团类型", { exact: true })).toBeVisible();
  await expect(detail.getByText("海盗", { exact: true })).toBeVisible();
  await expect(detail.getByText("主权", { exact: true })).toBeVisible();
  await expect(detail.getByText("区域标签", { exact: true })).toBeVisible();
  for (const label of ["高安", "低安", "00 地区"]) {
    await expect(detail.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(detail.getByText("福利列表", { exact: true })).toBeVisible();
  for (const label of [
    "舰船补损",
    "舰队培训",
    "工业/生产支持",
    "物流支持",
    "新人导师",
    "技能/知识分享",
    "PVE 舰队",
    "PVP 舰队",
  ]) {
    await expect(detail.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(detail.getByText("福利补充", { exact: true })).toBeVisible();
  await expect(
    detail.getByText("每周有导师答疑，重大行动提供后勤补给。", {
      exact: true,
    }),
  ).toBeVisible();
  const fields = detail.locator(".corp-review-fields");
  await expect(fields).toBeVisible();
  await expect(fields.getByText("海报背景", { exact: true })).toBeVisible();
  await expect(fields.getByText("战舰残骸", { exact: true })).toBeVisible();
  await expect(fields).toContainText("德里克 / 玛莫纳 / 库哈拉赫");
  await expect(fields).toContainText("主权战与反收割，每周组织小队游猎。");
  await expect(fields).toContainText("自定义活动标签");
  await expect(fields).toContainText("反收割 / 小队游猎");
  await expect(fields).toContainText("舰队作战（旧标签）");
  await expect(fields).toContainText("旧版活动标题");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "预览海报", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /海报/ })).toBeVisible();
});
