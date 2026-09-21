import { defineConfig } from "vitest/config";

// UI tests drive the real interface in headless Chromium against a mock of the Rust commands (see scripts/ui).
// Run them with `npm run test:ui`. They are kept out of `npm test`, which stays fast and needs no browser.
export default defineConfig({
  test: {
    include: ["tests/ui/**/*.e2e.ts"],
    globalSetup: ["tests/ui/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false, // the mock backend listens on a fixed port
    pool: "forks",
  },
});
