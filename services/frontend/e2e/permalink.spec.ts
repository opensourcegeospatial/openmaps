import { test, expect } from './fixtures/test';
import { waitForMapReady, panMap } from './helpers/map';

test.describe('permalink (URL hash sync)', () => {
  test('panning the map updates window.location.hash to #map=z/lat/lng', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    // Pan to trigger a moveend + the debounced (400ms) hash writer.
    await panMap(page, 140, 90);

    // The hash should settle into the OSM-style `#map=ZOOM/LAT/LNG` form.
    await expect
      .poll(() => page.evaluate(() => window.location.hash), { timeout: 10_000 })
      .toMatch(/^#map=\d+\/-?\d+(\.\d+)?\/-?\d+(\.\d+)?/);
  });

  test('loading a URL with a hash restores that view and style', async ({ page, gotoApp }) => {
    // Restore zoom 14 centered near Oslo, with the "osm" base style.
    await gotoApp('#map=14/59.91/10.75&style=osm');
    await waitForMapReady(page);

    // The restored style is reflected in the style selector: the osm style's
    // URL is the selected value.
    await expect(page.locator('select')).toHaveValue('https://tile.openstreetmap.org/{z}/{x}/{y}.png');

    // The hash keeps the restored zoom (the writer re-serializes the live view,
    // which starts at the restored zoom 14).
    await expect
      .poll(() => page.evaluate(() => window.location.hash), { timeout: 10_000 })
      .toMatch(/^#map=14\//);

    // And the style segment is preserved in the hash.
    await expect
      .poll(() => page.evaluate(() => window.location.hash), { timeout: 10_000 })
      .toContain('style=osm');
  });
});
