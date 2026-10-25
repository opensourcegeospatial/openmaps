import { test, expect } from './fixtures/test';
import { waitForMapReady, mapContainer } from './helpers/map';

/**
 * A click on the map always answers with the details card. When the point
 * has no address, or the lookup fails, the card opens on the coordinates and
 * says why — the click is never swallowed into a toast with no next step.
 */
test.describe('map click', () => {
  test('a point without an address opens the card on its coordinates', async ({ page, gotoApp }) => {
    await page.route(/\/api\/reverse(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ type: 'FeatureCollection', features: [] })
      })
    );
    await gotoApp();
    await waitForMapReady(page);

    await mapContainer(page).click({ position: { x: 900, y: 600 } });
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /° N, .*° Ø$/ })).toBeVisible();
    await expect(page.getByText('Fant ingen adresse for punktet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Veibeskrivelse hit' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Lukk varsel' })).toHaveCount(0);
  });

  test('a website is shown as text with Kopier, never as a link', async ({ page, gotoApp }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route(/\/api\/reverse(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [10.7522, 59.9139] },
              properties: {
                display_name: 'Kaffebrenneriet, Storgata 12, Oslo',
                name: 'Kaffebrenneriet',
                type: 'cafe',
                category: 'amenity',
                extratags: { website: 'https://kaffebrenneriet.no' }
              }
            }
          ]
        })
      })
    );
    await gotoApp();
    await waitForMapReady(page);

    await mapContainer(page).click({ position: { x: 900, y: 600 } });
    const card = page.locator('aside');
    await expect(card.getByText('https://kaffebrenneriet.no')).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole('link')).toHaveCount(0);

    await card.getByRole('button', { name: 'Kopier' }).click();
    await expect(card.getByRole('button', { name: 'Kopiert' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://kaffebrenneriet.no');
  });

  test('a failed lookup opens the card on the coordinates and names the failure', async ({
    page,
    gotoApp
  }) => {
    let fail = true;
    await page.route(/\/api\/reverse(\?.*)?$/, (route) =>
      fail ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : route.fallback()
    );
    await gotoApp();
    await waitForMapReady(page);

    await mapContainer(page).click({ position: { x: 900, y: 600 } });
    const card = page.getByRole('region', { name: 'Detaljer' });
    await expect(page.getByRole('heading', { name: /° N, .*° Ø$/ })).toBeVisible({ timeout: 10_000 });
    // What happened and why, in plain words — never the backend's own detail.
    await expect(card).toContainText('Kunne ikke hente adressen for punktet.');
    await expect(card).toContainText('Adressetjenesten svarte med en feil.');
    await expect(page.getByRole('button', { name: 'Lukk varsel' })).toHaveCount(0);

    // The coordinates are what the failure still gives, so they can be copied.
    await card.getByRole('button', { name: 'Kopier' }).click();
    await expect(card.getByRole('button', { name: 'Kopiert' })).toBeVisible();

    // And the same question can be asked again, without hunting for the pixel.
    fail = false;
    await card.getByRole('button', { name: 'Prøv igjen' }).click();
    await expect(card).not.toContainText('Kunne ikke hente adressen for punktet.', { timeout: 10_000 });
  });

  test('a map click never moves the map, marks the point at once, and a late answer leaves focus where the user typed', async ({
    page,
    gotoApp
  }) => {
    await page.route(/\/api\/reverse(\?.*)?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fallback();
    });
    await gotoApp();
    await waitForMapReady(page);
    const hash = () => page.evaluate(() => window.location.hash);
    const zoomOf = (value: string) => value.match(/map=(\d+)\//)?.[1];
    await expect.poll(hash, { timeout: 10_000 }).toContain('map=');
    const zoomBefore = zoomOf(await hash());

    await mapContainer(page).click({ position: { x: 900, y: 600 } });
    await expect(page.locator('.lookup-pending')).toHaveCount(1);

    const input = page.getByPlaceholder('Søk etter sted eller adresse…');
    await input.click();
    await input.pressSequentially('Oslo sentrum', { delay: 200 });
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible({ timeout: 10_000 });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Oslo sentrum');
    await expect(page.locator('.lookup-pending')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: /^Detaljer: / })).toHaveCount(1);

    await page.waitForTimeout(500);
    expect(zoomOf(await hash())).toBe(zoomBefore);
  });
});
