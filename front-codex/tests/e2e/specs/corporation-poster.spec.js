import { test, expect } from "@playwright/test";
import { communityFixture } from "../helpers/community";

const backgrounds = [
  "远征舰队",
  "星环巨行星",
  "旋臂星河",
  "轨道船坞",
  "黑洞视界",
  "创生星云",
  "冰封边境",
  "战舰残骸",
];

test("海报在独立弹窗打开，页面宽度不变且关闭后恢复焦点", async ({ page }) => {
  await communityFixture(page);
  await page.goto("/corporations/1");
  const trigger = page.getByRole("button", { name: "制作海报", exact: true });
  const content = page.locator(".corp-detail-main");
  const before = await content.boundingBox();
  await page.screenshot({ path: "output/corp-redesign-detail-desktop.png" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "制作军团海报" });
  await expect(dialog).toBeVisible();
  expect((await content.boundingBox()).width).toBeCloseTo(before.width, 0);
  await expect(
    dialog.getByRole("button", { name: "导出 PNG", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "远征舰队", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "导出 PNG", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "output/corp-redesign-poster-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("八款背景及三种模板均可导出有效且不同的PNG", async ({ page }) => {
  test.setTimeout(90000);
  await communityFixture(page);
  await page.goto("/corporations/1");
  await page.getByRole("button", { name: "制作海报", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "制作军团海报" });
  const exports = new Set();
  for (const label of backgrounds) {
    await dialog.getByRole("button", { name: label, exact: true }).click();
    for (const template of ["招募海报", "军团介绍", "主要活动"]) {
      await dialog.getByRole("button", { name: template, exact: true }).click();
      const button = dialog.getByRole("button", {
        name: "导出 PNG",
        exact: true,
      });
      await expect(button).toBeEnabled();
      const event = page.waitForEvent("download");
      await button.click();
      const download = await event;
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(bytes.readUInt32BE(16)).toBe(1080);
      expect(bytes.readUInt32BE(20)).toBe(1440);
      exports.add(bytes.toString("base64"));
    }
  }
  expect(exports.size).toBe(24);
});

test("背景加载失败时禁止导出，重试后恢复", async ({ page }) => {
  await communityFixture(page);
  let fail = true;
  await page.route("**/posters/*", (route) =>
    fail && !route.request().url().includes("-thumb")
      ? route.abort()
      : route.continue(),
  );
  await page.goto("/corporations/1");
  await page.getByRole("button", { name: "制作海报", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "制作军团海报" });
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "导出 PNG", exact: true }),
  ).toBeDisabled();
  fail = false;
  await dialog.getByRole("button", { name: "重新加载" }).click();
  await expect(
    dialog.getByRole("button", { name: "导出 PNG", exact: true }),
  ).toBeEnabled();
});

test("手机海报全屏且没有水平溢出，关闭后可继续浏览", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await communityFixture(page);
  await page.goto("/corporations/1");
  await page.getByRole("button", { name: "制作海报", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "制作军团海报" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box.width).toBe(390);
  expect(box.height).toBe(844);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await expect(
    dialog.getByRole("button", { name: "导出 PNG", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "output/corp-redesign-poster-mobile.png" });
  await dialog.getByRole("button", { name: "关闭海报制作" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "关于军团", exact: true }),
  ).toBeVisible();
});

test("重复点击当前背景或模板后仍可导出", async ({ page }) => {
  await communityFixture(page);
  await page.goto("/corporations/1");
  await page.getByRole("button", { name: "制作海报", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "制作军团海报" });
  const button = dialog.getByRole("button", { name: "导出 PNG", exact: true });
  await expect(button).toBeEnabled();
  await dialog.getByRole("button", { name: "招募海报", exact: true }).click();
  await dialog.locator(".corp-background-option.active").click();
  const download = page.waitForEvent("download", { timeout: 4000 });
  await button.click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});

test("快速切换背景不会导出旧画面，焦点始终留在弹窗内", async ({ page }) => {
  await communityFixture(page);
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/posters/black-hole.webp", async (route) => {
    await delayed;
    await route.continue();
  });
  await page.goto("/corporations/1");
  await page.getByRole("button", { name: "制作海报", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "制作军团海报" });
  const button = dialog.getByRole("button", { name: "导出 PNG", exact: true });
  await expect(button).toBeEnabled();
  await dialog.getByRole("button", { name: "黑洞视界", exact: true }).click();
  await expect(button).toBeDisabled();
  await dialog.getByRole("button", { name: "战舰残骸", exact: true }).click();
  await expect(button).toBeEnabled();
  release();
  await expect(dialog.locator("canvas")).toHaveAttribute(
    "data-background",
    "wreckfield",
  );
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
});
