import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the OpenMaps frontend e2e suite.
 *
 * The suite is hermetic: all network is mocked via page.route (see
 * e2e/fixtures/mocks.ts), so it runs without the Docker stack and without
 * internet. The only process we start is the Vite dev server.
 */
const PORT = 5180;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Mocked tiles render instantly, but Leaflet still animates; a fixed
    // viewport keeps container-relative click maths stable across machines.
    viewport: { width: 1280, height: 800 }
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  webServer: {
    // Start the Vite dev server on a fixed port. `--strictPort` makes Vite fail
    // fast rather than silently picking another port.
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
