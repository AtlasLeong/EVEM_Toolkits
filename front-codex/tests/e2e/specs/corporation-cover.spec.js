import { test, expect } from "@playwright/test";
import { communityFixture, corporation } from "../helpers/community";
import { json, TINY_ICON } from "../helpers/api";

const uploadUrl = "/api/community/corporations/1/media/7/";
const corporationListRequest = url => url.pathname === "/api/community/corporations/";

async function withCover(page, coverUrl) {
  await communityFixture(page);
  const content = { ...corporation, cover_url: coverUrl };
  await page.route("**/api/community/corporations/1/", route => route.fulfill(json(content)));
  await page.route(corporationListRequest, route => route.fulfill(json({ count: 1, results: [content] })));
}

async function expectDecoded(image) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
}

test("未上传封面的军团卡片与详情采用相同且稳定的专用默认封面", async ({ page }) => {
  await communityFixture(page);
  await page.goto("/corporations");
  const card = page.locator(".corp-card-cover .corp-cover-surface");
  await expect(card).toHaveAttribute("data-cover-kind", "default");
  await expectDecoded(card.locator(".corp-cover-default"));
  const key = await card.getAttribute("data-cover-key");
  expect(["fleet", "planet", "shipyard", "nebula"]).toContain(key);
  await expect(card.locator("img")).toHaveAttribute("src", new RegExp(`/covers/${key}-thumb\\.webp$`));
  await page.getByRole("link", { name: /远航者军团/ }).click();
  const detail = page.locator(".corp-profile-cover .corp-cover-surface");
  await expect(detail).toHaveAttribute("data-cover-key", key);
  await expectDecoded(detail.locator(".corp-cover-default"));
  await expect(detail.locator("img")).toHaveAttribute("src", new RegExp(`/covers/${key}\\.webp$`));
  await page.reload();
  await expect(detail).toHaveAttribute("data-cover-key", key);
  await expect(page.locator(".corp-profile-orbit")).toHaveCount(0);
  await expect(page.locator(".corp-profile-logo")).toHaveText("VO");
});

test("连续军团分配四款不同封面且全部能够真实加载", async ({ page }) => {
  await communityFixture(page);
  await page.route(corporationListRequest, route => route.fulfill(json({
    count: 4,
    results: [1, 2, 3, 4].map(id => ({ ...corporation, id, name: `星海军团 ${id}` })),
  })));
  await page.goto("/corporations");
  const covers = page.locator(".corp-card-cover .corp-cover-surface");
  await expect(covers).toHaveCount(4);
  const keys = [];
  for (let index = 0; index < 4; index++) {
    const cover = covers.nth(index);
    await cover.scrollIntoViewIfNeeded();
    await expectDecoded(cover.locator(".corp-cover-default"));
    keys.push(await cover.getAttribute("data-cover-key"));
  }
  expect(keys.sort()).toEqual(["fleet", "nebula", "planet", "shipyard"]);
});

test("上传封面加载完成后优先显示，默认封面不覆盖真实图片", async ({ page }) => {
  await withCover(page, uploadUrl);
  await page.route(`**${uploadUrl}`, route => route.fulfill({
    status: 200, contentType: "image/png", body: Buffer.from(TINY_ICON.split(",")[1], "base64"),
  }));
  for (const path of ["/corporations", "/corporations/1"]) {
    await page.goto(path);
    const cover = page.locator(".corp-cover-surface");
    await expect(cover).toHaveAttribute("data-cover-kind", "custom");
    await expectDecoded(cover.locator(".corp-cover-upload"));
    await expect(cover.locator(".corp-cover-upload")).toHaveAttribute("src", /^blob:/);
    await expect(cover.locator(".corp-cover-default")).not.toBeVisible();
  }
});

for (const failure of ["server-error", "invalid-image"]) {
  test(`上传封面 ${failure} 时回退默认图片，不显示破图`, async ({ page }) => {
    await withCover(page, uploadUrl);
    let fetched = false;
    await page.route(`**${uploadUrl}`, route => {
      fetched = true;
      return route.fulfill(failure === "server-error"
        ? json({ detail: "图片暂时不可用" }, 503)
        : { status: 200, contentType: "image/png", body: "not an image" });
    });
    await page.goto("/corporations/1");
    await expect.poll(() => fetched).toBe(true);
    const cover = page.locator(".corp-cover-surface");
    await expect(cover).toHaveAttribute("data-cover-upload-state", "failed");
    await expect(cover).toHaveAttribute("data-cover-kind", "default");
    await expectDecoded(cover.locator(".corp-cover-default"));
    await expect(cover.locator(".corp-cover-upload")).toHaveCount(0);
  });
}

test("默认封面不放宽外部图片地址限制", async ({ page }) => {
  const requests = [];
  await withCover(page, "https://untrusted.example/cover.jpg");
  await page.route("https://untrusted.example/**", route => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/corporations/1");
  const cover = page.locator(".corp-cover-surface");
  await expectDecoded(cover.locator(".corp-cover-default"));
  await expect(cover).toHaveAttribute("data-cover-upload-state", "failed");
  await expect(cover).toHaveAttribute("data-cover-kind", "default");
  expect(requests).toEqual([]);
});

test("默认图片请求失败时保留深色底，不显示损坏图片标记", async ({ page }) => {
  await communityFixture(page);
  await page.route("**/covers/*.webp", route => route.abort());
  await page.goto("/corporations/1");
  const cover = page.locator(".corp-cover-surface");
  await expect(cover).toBeVisible();
  await expect(cover.locator(".corp-cover-default")).not.toBeVisible();
  expect(await cover.evaluate(el => getComputedStyle(el).backgroundImage)).toContain("linear-gradient");
});

test("专用默认封面不增加详情高度，桌面与手机没有横向溢出", async ({ page }) => {
  await communityFixture(page);
  for (const [width, height, coverHeight] of [[1440, 900, 160], [390, 844, 128]]) {
    await page.setViewportSize({ width, height });
    for (const path of ["/corporations", "/corporations/1"]) {
      await page.goto(path);
      await expectDecoded(page.locator(".corp-cover-default").first());
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (path.endsWith("/1")) {
        const box = await page.locator(".corp-profile-cover").boundingBox();
        expect(box.height).toBe(coverHeight);
      }
    }
  }
});
