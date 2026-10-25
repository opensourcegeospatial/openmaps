import { test, expect, type Page } from './fixtures/test';
import { MOCK_ROUTE_DETAILED, MOCK_ROUTE_ROAD_ONLY } from './fixtures/mocks';
import { mapContainer, waitForMapReady } from './helpers/map';

/**
 * Route details (spec 2026-09-23): the panel shows only what GraphHopper
 * has, and each detail points at its stretches on the map.
 */

async function mockRoute(page: Page, body: unknown): Promise<void> {
  await page.route(/\/api\/route(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

/** Plan a route from the map menu, near the start of the mocked route (in view). */
async function planRoute(page: Page): Promise<void> {
  await mapContainer(page).click({ button: 'right', position: { x: 760, y: 360 } });
  await page.getByRole('menuitem', { name: 'Veibeskrivelse herfra' }).click();
  await mapContainer(page).click({ button: 'right', position: { x: 860, y: 320 } });
  await page.getByRole('menuitem', { name: 'Veibeskrivelse hit' }).click();
  await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 15_000 });
  // The mocked route starts a little west of the frame, so planning it fits
  // the map; let that animation land before anything is measured.
  await page.waitForTimeout(700);
}

test.describe('route details in the panel', () => {
  test('a route with everything shows the profile, the surface, the crossings and the fold', async ({
    page,
    installMocks,
    gotoApp
  }) => {
    void installMocks;
    await mockRoute(page, MOCK_ROUTE_DETAILED);
    await gotoApp();
    await waitForMapReady(page);
    await planRoute(page);

    await expect(page.getByRole('slider', { name: 'Høydeprofil' })).toBeVisible();
    await expect(page.getByText(/^Stigning 23 m · Fall 2 m$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Asfalt 80 %' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grus 20 %' })).toBeVisible();
    await expect(page.getByText('1 bru · ingen tunnel · ingen ferje')).toBeVisible();
    const more = page.getByRole('button', { name: 'Vis veitype og fartsgrenser' });
    await more.click();
    await expect(page.getByRole('button', { name: 'Sykkelvei 50 %' })).toBeVisible();
    await expect(page.getByRole('button', { name: '30 km/t 60 %' })).toBeVisible();
  });

  test("today's self-hosted data shows only the crossings and the fold", async ({ page, installMocks, gotoApp }) => {
    void installMocks;
    await mockRoute(page, MOCK_ROUTE_ROAD_ONLY);
    await gotoApp();
    await waitForMapReady(page);
    await planRoute(page);

    await expect(page.getByText('1 bru · ingen tunnel · ingen ferje')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Vis veitype og fartsgrenser' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Høydeprofil' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Underlag' })).toHaveCount(0);
  });

  test('a route without details shows no section at all', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await planRoute(page); // the stock mock route carries no details

    await expect(page.getByRole('slider', { name: 'Høydeprofil' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Vis veitype og fartsgrenser' })).toHaveCount(0);
    await expect(page.getByText(/ingen ferje/)).toHaveCount(0);
  });
});

test.describe('route details point at the map', () => {
  test.beforeEach(async ({ page, installMocks, gotoApp }) => {
    void installMocks;
    await mockRoute(page, MOCK_ROUTE_DETAILED);
    await gotoApp();
    await waitForMapReady(page);
    await planRoute(page);
  });

  const primaryRoute = (page: Page) => page.locator('.leaflet-overlay-pane path[stroke="#116e6b"]:not([stroke-dasharray])').first();

  test('the profile moves a dot along the route, and letting go removes it', async ({ page }) => {
    const slider = page.getByRole('slider', { name: 'Høydeprofil' });
    const dot = page.locator('path.route-highlight-point');
    await slider.focus();
    await expect(dot).toHaveCount(1);
    await expect(slider).toHaveAttribute('aria-valuetext', /^0 m, 20 moh\.$/);
    const start = (await dot.boundingBox())!;
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuetext', /^1,2 km, 41 moh\.$/);
    const end = (await dot.boundingBox())!;
    expect(end.x).toBeLessThan(start.x); // the mocked route runs west
    // R7: arrow keys on the profile also move the dot on the map. The route
    // runs west, so stepping back from the End position moves the dot east.
    // Each ArrowLeft is one step (length/100 ≈ 12 m); several presses cross a
    // rounding boundary so the readout is guaranteed to read differently, not
    // just coincidentally the same digits.
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowLeft');
    await expect(slider).not.toHaveAttribute('aria-valuetext', /^1,2 km, 41 moh\.$/);
    const afterLeft = (await dot.boundingBox())!;
    expect(afterLeft.x).toBeGreaterThan(end.x);
    await page.keyboard.press('Tab');
    await expect(dot).toHaveCount(0);
  });

  test('focusing a surface lights its stretches and dims the route; leaving puts it out', async ({ page }) => {
    await expect(primaryRoute(page)).toHaveAttribute('stroke-opacity', '0.9');
    const grus = page.getByRole('button', { name: 'Grus 20 %' });
    await grus.focus();
    await expect(page.locator('path.route-highlight-stretch')).toHaveCount(1);
    await expect(primaryRoute(page)).toHaveAttribute('stroke-opacity', '0.35');
    await grus.blur();
    await expect(page.locator('path.route-highlight-stretch')).toHaveCount(0);
    await expect(primaryRoute(page)).toHaveAttribute('stroke-opacity', '0.9');
  });

  test('a pressed surface stays lit until Escape, and the panel stays open', async ({ page }) => {
    const grus = page.getByRole('button', { name: 'Grus 20 %' });
    await grus.click();
    await expect(grus).toHaveAttribute('aria-pressed', 'true');
    await grus.blur();
    await expect(page.locator('path.route-highlight-stretch')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('path.route-highlight-stretch')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Veibeskrivelse' })).toBeVisible();
  });

  test('Escape clears a pinned surface but keeps the profile position', async ({ page }) => {
    const grus = page.getByRole('button', { name: 'Grus 20 %' });
    await grus.click();
    await expect(grus).toHaveAttribute('aria-pressed', 'true');
    const slider = page.getByRole('slider', { name: 'Høydeprofil' });
    await slider.focus();
    await page.keyboard.press('End');
    const dot = page.locator('path.route-highlight-point');
    await expect(dot).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('path.route-highlight-stretch')).toHaveCount(0);
    // The dot stays: Escape here clears only the pin, not the slider's position.
    await expect(dot).toHaveCount(1);
  });

  test('closing the route puts a pinned highlight out', async ({ page }) => {
    await page.getByRole('button', { name: 'Grus 20 %' }).click();
    await expect(page.locator('path.route-highlight-stretch')).toHaveCount(1);
    // Two close buttons can coexist in the DOM (the panel's own header, plus
    // the condensed sticky bar once the header scrolls away); either closes
    // the same route panel, so the first is enough (unrelated to this task).
    await page.getByRole('button', { name: 'Lukk veibeskrivelse' }).first().click();
    await expect(page.locator('path.route-highlight-stretch')).toHaveCount(0);
  });

  test('a highlight never moves the map', async ({ page }) => {
    const before = (await primaryRoute(page).boundingBox())!;
    await page.getByRole('button', { name: 'Grus 20 %' }).click();
    await page.getByRole('slider', { name: 'Høydeprofil' }).focus();
    await page.keyboard.press('End');
    await page.waitForTimeout(400);
    const after = (await primaryRoute(page).boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  });
});
