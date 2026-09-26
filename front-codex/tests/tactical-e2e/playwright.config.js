import { defineConfig } from "@playwright/test";
const port = Number(process.env.TACTICAL_TEST_PORT || 4193);
export default defineConfig({
  testDir: ".",
  outputDir: "../../test-results-tactical",
  testMatch: "**/*.spec.js",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI && !process.env.TACTICAL_TEST_PORT,
  },
});
