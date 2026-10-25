import { test, expect } from './fixtures/test';
import { waitForMapReady } from './helpers/map';

/**
 * A basemap whose tiles never arrive would leave a blank canvas with no
 * message — the one failure the app never named. It must say what happened
 * and where the way out is (the basemap select sits beside the message).
 */
test.describe('basemap failures', () => {
  test('a basemap whose tiles never arrive says so, and names the next step', async ({
    page,
    gotoApp
  }) => {
    // Registered after the shared mocks, so this handler takes the tiles.
    await page.route(/\.png(\?.*)?$/i, (route) =>
      route.fulfill({ status: 502, contentType: 'text/plain', body: '' })
    );
    await gotoApp();

    const notice = page.getByText('er ikke tilgjengelig her');
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText('Velg et annet bakgrunnskart');
    // The style it names is the one that failed.
    await expect(notice).toContainText('Lokale kartfliser');
  });

  test('a basemap that draws says nothing', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.waitForTimeout(1500);
    await expect(page.getByText('er ikke tilgjengelig her')).toHaveCount(0);
  });
});
