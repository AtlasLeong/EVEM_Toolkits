import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "sandbox.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 10000 },
  reporter: [["list"]],
  outputDir: "../../output/preview-sandbox-tests",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4191",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tests/preview/server.mjs",
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { PREVIEW_PORT: "4191" },
    url: "http://127.0.0.1:4191",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
