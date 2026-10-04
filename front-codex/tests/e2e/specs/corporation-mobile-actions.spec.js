import { expect, test } from "@playwright/test";
import { communityFixture, corporation } from "../helpers/community";
import { json } from "../helpers/api";

const widths = [320, 390, 768, 1440];

async function openDetail(page, width) {
  await page.setViewportSize({ width, height: 960 });
  await communityFixture(page);
  await page.goto("/corporations/1");
  await expect(page.getByRole("heading", { name: corporation.name, exact: true })).toBeVisible();
}

async function assertActionTargets(page) {
  const controls = page.locator(".corp-profile-actions > a, .corp-profile-actions > button, .corp-profile-actions .corp-share > button");
  await expect(controls).toHaveCount(3);
  const metrics = await controls.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textRects = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      textRects.push(...[...range.getClientRects()].map((rect) => rect.toJSON()));
    }
    return {
      name: element.textContent.trim(),
      box: box.toJSON(),
      textRects,
      hit: [[.5, .5], [.1, .5], [.9, .5]].every(([x, y]) =>
        element.contains(document.elementFromPoint(box.left + box.width * x, box.top + box.height * y))),
    };
  }));
  for (const { name, box, textRects, hit } of metrics) {
    expect(box.height, `${name} touch height`).toBeGreaterThanOrEqual(44);
    expect(box.width, `${name} touch width`).toBeGreaterThanOrEqual(44);
    expect(hit, `${name} owns its click area`).toBeTruthy();
    for (const rect of textRects) {
      expect(rect.left, `${name} label left`).toBeGreaterThanOrEqual(box.left - 1);
      expect(rect.right, `${name} label right`).toBeLessThanOrEqual(box.right + 1);
      expect(rect.top, `${name} label top`).toBeGreaterThanOrEqual(box.top - 1);
      expect(rect.bottom, `${name} label bottom`).toBeLessThanOrEqual(box.bottom + 1);
    }
  }
  for (let first = 0; first < metrics.length; first++) {
    for (let second = first + 1; second < metrics.length; second++) {
      const a = metrics[first].box;
      const b = metrics[second].box;
      expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBeTruthy();
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
}

for (const width of widths) {
  test(`军团详情操作按钮在 ${width}px 保持文字、点击区域和触控尺寸`, async ({ page }) => {
    await openDetail(page, width);
    await page.screenshot({ path: `output/playwright/corporation-actions-${process.env.CORP_ACTION_AUDIT || "after"}-${width}.png`, fullPage: true });
    await assertActionTargets(page);
  });
}

for (const width of [320, 390, 768, 1440]) {
  test(`军团详情在 ${width}px 双倍文字与长军团名下保留完整操作`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await communityFixture(page);
    const name = "远航者与新伊甸探索协作联合军团";
    await page.route("**/api/community/corporations/1/", (route) => route.fulfill(json({ ...corporation, name })));
    await page.goto("/corporations/1");
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.locator(".corp-profile-summary").evaluate((summary) => {
      const sizes = [...summary.querySelectorAll("*")].map((element) => [element, parseFloat(getComputedStyle(element).fontSize)]);
      for (const [element, size] of sizes) element.style.setProperty("font-size", `${size * 2}px`, "important");
    });
    await page.screenshot({ path: `output/playwright/corporation-actions-double-text-${width}.png`, fullPage: true });
    await assertActionTargets(page);
  });
}

for (const width of [320, 390]) {
  for (const copySucceeds of [true, false]) {
    test(`军团 ${width}px 分享${copySucceeds ? "成功提示" : "手动复制"}不遮挡海报和资料`, async ({ page }, testInfo) => {
      await page.addInitScript((succeeds) => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async (value) => {
            if (!succeeds) throw new Error("denied");
            window.copiedCorporationUrl = value;
          } },
        });
      }, copySucceeds);
      await openDetail(page, width);
      const share = page.getByRole("button", { name: "分享军团", exact: true });
      const poster = page.getByRole("button", { name: "制作海报", exact: true });
      const related = page.getByRole("link", { name: "查看关联见闻", exact: true });
      await related.focus();
      await page.keyboard.press("Tab");
      await expect(share).toBeFocused();
      await page.keyboard.press("Enter");
      const feedback = page.locator(copySucceeds ? ".corp-share-status" : ".corp-share-fallback");
      await expect(feedback).toBeVisible();
      const feedbackBox = await feedback.boundingBox();
      expect(feedbackBox.x).toBeGreaterThanOrEqual(0);
      expect(feedbackBox.x + feedbackBox.width).toBeLessThanOrEqual(width);
      if (copySucceeds) {
        expect(await page.evaluate(() => window.copiedCorporationUrl)).toBe(new URL("/corporations/1", testInfo.project.use.baseURL).href);
      } else {
        const input = page.getByLabel("军团分享链接", { exact: true });
        await expect(input).toHaveValue(new URL("/corporations/1", testInfo.project.use.baseURL).href);
        await page.keyboard.press("Tab");
        await expect(input).toBeFocused();
        expect(await input.evaluate((element) => element.selectionEnd - element.selectionStart)).toBe((await input.inputValue()).length);
      }
      await page.keyboard.press("Tab");
      await expect(poster).toBeFocused();
      await assertActionTargets(page);
      const mainBox = await page.locator(".corp-detail-main").boundingBox();
      expect(feedbackBox.y + feedbackBox.height).toBeLessThanOrEqual(mainBox.y);
      await page.screenshot({ path: `output/playwright/corporation-share-${copySucceeds ? "copied" : "manual"}-${width}.png`, fullPage: true });
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "制作军团海报" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "制作军团海报" })).not.toBeVisible();
      await expect(poster).toBeFocused();
    });
  }
}
