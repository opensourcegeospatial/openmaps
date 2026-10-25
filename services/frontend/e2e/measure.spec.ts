import { test, expect } from './fixtures/test';
import { waitForMapReady, mapContainer, openTools, drawPolygon } from './helpers/map';

/** Overlay-pane vector paths (measure line/polygon, vertices, routes, …). */
const overlayPaths = (page: Parameters<typeof waitForMapReady>[0]) =>
  page.locator('.leaflet-overlay-pane path');

test.describe('measurement tool', () => {
  test('a finished measurement stays in a readout that can be copied, and removing it clears the map', async ({
    page,
    gotoApp
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoApp();
    await waitForMapReady(page);

    await openTools(page);
    await page.getByRole('button', { name: 'Mål avstand', exact: true }).click();
    const map = mapContainer(page);
    await map.click({ position: { x: 500, y: 300 } });
    await page.waitForTimeout(120);
    await map.click({ position: { x: 700, y: 300 }, clickCount: 2 });
    await page.waitForTimeout(300);

    const readout = page.getByRole('region', { name: 'Måling' });
    await expect(readout).toBeVisible();
    await expect(readout).toContainText('Avstand');
    // The readout is the only place the result is shown: no popup on the line.
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
    // The readout is the one answer; no toast repeats it.
    await expect(page.getByRole('button', { name: 'Lukk varsel' })).toHaveCount(0);

    await readout.getByRole('button', { name: 'Kopier' }).click();
    await expect(readout.getByRole('button', { name: 'Kopiert' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Avstand: \d/);

    await readout.getByRole('button', { name: 'Fjern målingen' }).click();
    await expect(readout).toHaveCount(0);
    await expect(overlayPaths(page)).toHaveCount(0);
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  });

  test('a finished distance measurement stays on the map with its result', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await expect(overlayPaths(page)).toHaveCount(0);

    await openTools(page);
    await page.getByRole('button', { name: 'Mål avstand', exact: true }).click();
    const map = mapContainer(page);
    await map.click({ position: { x: 500, y: 300 } });
    await page.waitForTimeout(120);
    await map.click({ position: { x: 700, y: 300 } });
    await page.waitForTimeout(120);
    // Finish on the last vertex with a double-click.
    await map.click({ position: { x: 700, y: 300 }, clickCount: 2 });
    await page.waitForTimeout(300);

    // The measured line stays on the map and its result stays in the readout.
    await expect(page.getByRole('region', { name: 'Måling' })).toContainText('Avstand');
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
    await expect(overlayPaths(page).first()).toBeVisible();
  });

  test('a new measurement replaces the previous one only once finished; cancelling keeps it', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    const map = mapContainer(page);
    const readout = page.getByRole('region', { name: 'Måling' });

    await openTools(page);
    await page.getByRole('button', { name: 'Mål avstand', exact: true }).click();
    await map.click({ position: { x: 500, y: 300 } });
    await page.waitForTimeout(120);
    await map.click({ position: { x: 700, y: 300 }, clickCount: 2 });
    await expect(readout).toBeVisible();
    const first = (await readout.textContent()) ?? '';
    const paths = await overlayPaths(page).count();

    // Arming again keeps the finished one, and Escape leaves it as it was.
    await openTools(page);
    await page.getByRole('button', { name: 'Mål avstand', exact: true }).click();
    await expect(readout).toHaveText(first);
    await expect(overlayPaths(page)).toHaveCount(paths);
    await page.keyboard.press('Escape');
    await expect(readout).toHaveText(first);
    await expect(overlayPaths(page)).toHaveCount(paths);

    // Finishing a new one replaces it.
    await openTools(page);
    await page.getByRole('button', { name: 'Mål avstand', exact: true }).click();
    await map.click({ position: { x: 500, y: 450 } });
    await page.waitForTimeout(120);
    await map.click({ position: { x: 900, y: 450 }, clickCount: 2 });
    await expect(readout).not.toHaveText(first);
    await expect(overlayPaths(page)).toHaveCount(paths);
  });

  test('a toast moves below the armed tool banner instead of covering it', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();
    const toast = page.locator('[data-color]').filter({ hasText: 'Lagret i Mine steder' });
    await expect(toast).toBeVisible();

    await openTools(page);
    await page.getByRole('button', { name: 'Mål avstand', exact: true }).click();
    const banner = page.locator('.tool-banner > div');
    await expect(banner).toBeVisible();
    await expect
      .poll(async () => {
        const bannerBox = await banner.boundingBox();
        const toastBox = await toast.boundingBox();
        return Boolean(bannerBox && toastBox && toastBox.y >= bannerBox.y + bannerBox.height);
      })
      .toBe(true);
  });

  test('a finished line is not left under its readout', async ({ page, gotoApp }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoApp();
    await waitForMapReady(page);
    await openTools(page);
    await page.getByRole('button', { name: 'Mål avstand', exact: true }).click();
    const map = mapContainer(page);
    await map.click({ position: { x: 600, y: 520 } });
    await page.waitForTimeout(120);
    await map.click({ position: { x: 900, y: 520 }, clickCount: 2 });
    const readout = page.getByRole('region', { name: 'Måling' });
    await expect(readout).toBeVisible();
    await expect
      .poll(async () => {
        const box = await readout.boundingBox();
        const endX = await page.evaluate(() => {
          const vertices = [...document.querySelectorAll('.leaflet-overlay-pane path')]
            .map((path) => path.getBoundingClientRect())
            .filter((rect) => rect.width < 20 && rect.height < 20);
          return Math.max(...vertices.map((rect) => rect.x + rect.width / 2));
        });
        return Boolean(box && endX < box.x);
      })
      .toBe(true);
  });

  // Areas read in square metres, or square kilometres from one: never in
  // hectares (decided 2026-09-23). A small area in what used to be the hectare
  // range reads in whole square metres, since a decimal there claims a
  // precision no hand-drawn shape has.
  for (const [label, zoom, unit] of [
    ['a large area in square kilometres', 13, /^Areal[\s\S]*\d+(,\d{1,2})? km²/],
    ['a small area in whole square metres', 16, /^Areal[\s\S]*\b\d{1,3}(?:[\s\u00a0\u202f]\d{3})* m²/]
  ] as const) {
    test(`measures ${label}, never in hectares`, async ({ page, gotoApp }) => {
      await gotoApp(`#map=${zoom}/59.9127/10.7446`);
      await waitForMapReady(page);
      await openTools(page);
      await page.getByRole('button', { name: 'Mål areal', exact: true }).click();
      await drawPolygon(page, [
        { x: 600, y: 250 },
        { x: 850, y: 250 },
        { x: 850, y: 500 }
      ]);
      const readout = page.getByRole('region', { name: 'Måling' });
      await expect(readout).toBeVisible();
      const text = ((await readout.textContent()) ?? '').trim();
      expect(text).toMatch(unit);
      expect(text).not.toMatch(/\bha\b/);
      expect(text).not.toMatch(/\d,\d+ m²/);
    });
  }

  test('the first two points of an area are joined by a line', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await openTools(page);
    await page.getByRole('button', { name: 'Mål areal', exact: true }).click();
    const map = mapContainer(page);
    await map.click({ position: { x: 500, y: 300 } });
    await page.waitForTimeout(120);
    await map.click({ position: { x: 700, y: 300 } });
    // Two vertex dots and the line between them.
    await expect(overlayPaths(page)).toHaveCount(3);
  });
});
