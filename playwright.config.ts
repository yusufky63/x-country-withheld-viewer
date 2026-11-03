import { defineConfig } from "@playwright/test";

// The extension fixture owns the browser, so runs stay serial with one browser.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [["list"]],
});
