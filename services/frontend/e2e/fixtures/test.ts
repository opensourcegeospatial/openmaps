import { test as base, expect, type Page } from '@playwright/test';
import { setupMocks, type MockOptions } from './mocks';

/**
 * Shared test fixtures for the OpenMaps e2e suite.
 *
 * Every test automatically gets a page with all network mocks installed
 * (see ./mocks.ts), plus a `consoleErrors` array capturing uncaught console
 * errors and page errors so specs can assert a clean boot.
 *
 * Use `installMocks` to (re)install mocks with non-default options (e.g.
 * forcing multi-route responses) BEFORE navigating.
 */
interface Fixtures {
  consoleErrors: string[];
  installMocks: (options?: MockOptions) => Promise<void>;
  gotoApp: (hash?: string) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });
    await use(errors);
  },

  installMocks: async ({ page }, use) => {
    let installed = false;
    const fn = async (options?: MockOptions) => {
      await setupMocks(page, options);
      installed = true;
    };
    // Install default mocks eagerly so a test that just calls gotoApp() works.
    await fn();
    await use(async (options?: MockOptions) => {
      // Allow re-installing with options; Playwright stacks routes, and the
      // later /route handler takes precedence over the default one.
      await fn(options);
    });
    void installed;
  },

  gotoApp: async ({ page, installMocks }, use) => {
    // Ensure default mocks are present (installMocks fixture ran already).
    void installMocks;
    await use(async (hash = '') => {
      await page.goto(`/${hash}`);
    });
  }
});

export { expect, type Page };
