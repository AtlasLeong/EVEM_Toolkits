import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  outputDir: "../../test-results-tactical",
  testMatch: "**/*.spec.js",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4193",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4193",
    url: "http://127.0.0.1:4193",
    reuseExistingServer: !process.env.CI,
  },
});
