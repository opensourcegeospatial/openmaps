import { test, expect, type Page } from './fixtures/test';
import { waitForMapReady, drawPolygon, openTools } from './helpers/map';

/** Put the app into navigation mode with an active route (so re-routing fires). */
async function setupRoute(page: Page): Promise<void> {
  const search = page.getByPlaceholder('Søk etter sted eller adresse…');
  await search.fill('Oslo');
  const firstResult = page.getByRole('option', { name: /^Oslo, Norge/ });
  await expect(firstResult).toBeVisible({ timeout: 10_000 });
  await firstResult.click();

  await page.getByRole('button', { name: 'Veibeskrivelse herfra' }).click();
  await expect(page.getByRole('heading', { name: 'Veibeskrivelse', level: 2 })).toBeVisible();

  const toInput = page.getByPlaceholder('Velg destinasjon…');
  await toInput.fill('Sentral');
  const dest = page.getByRole('option', { name: /^Oslo Sentralstasjon, Oslo, Norge/ }).first();
  await expect(dest).toBeVisible({ timeout: 10_000 });
  await dest.click();

  await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });
}

test.describe('avoid area', () => {
  test('drawing an avoid area registers it and re-fires routing with avoid_areas', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);

    // Listen for the next /route request that carries avoid_areas.
    const avoidRoutePromise = page.waitForRequest(
      (req) => req.url().includes('/api/route') && req.url().includes('avoid_areas='),
      { timeout: 15_000 }
    );

    // Activate the "Unngå område" draw control from the Verktøy card.
    await openTools(page);
    const drawBtn = page.getByRole('button', { name: 'Unngå område', exact: true });
    await drawBtn.click();
    // Drawing-mode tooltip confirms the control is armed.
    await expect(
      page.getByRole('status').filter({ hasText: 'tegne området som skal unngås' })
    ).toBeVisible();

    // Draw a triangle near the map center and finish with a double-click.
    await drawPolygon(page, [
      { x: 360, y: 260 },
      { x: 460, y: 260 },
      { x: 410, y: 360 }
    ]);

    // Routing re-fires; assert the outgoing request included avoid_areas.
    const avoidRequest = await avoidRoutePromise;
    // The parameter is a JSON array of rings, each a [lng,lat][] with >= 3 vertices.
    const raw = new URL(avoidRequest.url()).searchParams.get('avoid_areas');
    expect(raw, 'avoid_areas should be present').not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].length).toBeGreaterThanOrEqual(3);

    // The sidebar status chip reflects the registered avoid area.
    await expect(page.getByText('1 område unngås')).toBeVisible({ timeout: 10_000 });

    // A red avoid polygon is rendered on the map overlay pane.
    await expect(page.locator('.leaflet-overlay-pane path').first()).toBeVisible();
  });
});
