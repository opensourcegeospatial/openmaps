import { test, expect, type Page, type Locator } from './fixtures/test';
import { mapContainer, waitForMapReady } from './helpers/map';

/**
 * An answer with an extent is always wholly on the map, as a map gesture never
 * moves it (critique run 16). A route used to be the one answer the map never
 * framed: Oslo to Bergen read "463 km · 6 t" over a line leaving the corner,
 * and "Vis ruten" only scrolled the panel. An area answer survived any pan
 * with nothing saying its hits had left the view.
 */

const BERGEN = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'osm-9',
      bbox: [5.2, 60.3, 5.45, 60.45],
      geometry: { type: 'Point', coordinates: [5.3221, 60.3913] },
      properties: { osm_type: 'node', osm_id: 9009, place_id: 9009, display_name: 'Bergen, Norge', name: 'Bergen', type: 'city' }
    }
  ]
};

const OSLO_TO_BERGEN = {
  routes: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [10.7522, 59.9139],
          [9.5, 60.5],
          [7.2, 60.75],
          [5.3221, 60.3913]
        ]
      },
      properties: {
        distance: 463000,
        time: 21600000,
        instructions: [
          { text: 'Kjør mot vest', distance: 463000, time: 21600000, interval: [0, 3] },
          { text: 'Du er fremme ved destinasjonen', distance: 0, time: 0, interval: [3, 3] }
        ],
        primary: true,
        route_index: 0,
        style: 'solid'
      }
    }
  ],
  dashed_segments: []
};

const SIX_HITS = {
  type: 'FeatureCollection',
  generator: 'keyword',
  features: Array.from({ length: 6 }, (_, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10.72 + (i % 3) * 0.02, 59.905 + Math.floor(i / 3) * 0.012] },
    properties: { name: `Apotek ${i + 1}`, amenity: 'pharmacy' }
  }))
};

/** Where an element's box sits, and whether it is on screen right of the rail. */
async function clearOfRail(page: Page, element: Locator): Promise<boolean> {
  const box = await element.boundingBox();
  const rail = await page.locator('[data-rail]').boundingBox();
  const viewport = page.viewportSize();
  if (!box || !rail || !viewport) return false;
  return (
    box.x >= rail.x + rail.width &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height
  );
}

/**
 * Drag the map with the mouse, starting right of the rail and clear of the
 * controls. It holds still before letting go: Leaflet throws the map on from
 * the last ~50ms of movement, and that momentum made the pan's length vary.
 */
async function dragMap(page: Page, dx: number, dy: number): Promise<void> {
  const box = (await mapContainer(page).boundingBox())!;
  const x = box.x + 820;
  const y = box.y + (dy > 0 ? 60 : box.height - 60);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

/** The route's own line: the only solid stroke in the route colour. */
function routeLine(page: Page): Locator {
  return page.locator('.leaflet-overlay-pane path[stroke="#116e6b"]:not([stroke-dasharray])');
}

async function planOsloToBergen(page: Page): Promise<void> {
  const search = page.getByPlaceholder('Søk etter sted eller adresse…');
  await search.fill('Oslo');
  await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
  await page.getByRole('button', { name: 'Veibeskrivelse herfra' }).click();
  await page.getByPlaceholder('Velg destinasjon…').fill('Bergen');
  await page.getByRole('option', { name: /^Bergen, Norge/ }).click();
  await expect(page.getByText('463 km').first()).toBeVisible({ timeout: 15_000 });
}

test.describe('a route is always wholly on the map', () => {
  // installMocks is requested so the shared mocks are in place first: routes
  // registered later win, and without it they arrived later and won instead.
  test.beforeEach(async ({ page, installMocks }) => {
    void installMocks;
    await page.route(/\/api\/search(\?.*)?$/, async (route, request) => {
      if (!request.url().includes('Bergen')) return route.fallback();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BERGEN) });
    });
    await page.route(/\/api\/route(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OSLO_TO_BERGEN) })
    );
  });

  test('a destination far away brings the whole route into view', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await planOsloToBergen(page);

    // The map framed the answer: both ends and the line, right of the rail.
    // Before, the destination sat at x = −1,011,616 (critique run 16).
    await expect(async () => {
      expect(await clearOfRail(page, page.locator('.route-stop--to'))).toBe(true);
      expect(await clearOfRail(page, page.locator('.route-stop--from'))).toBe(true);
      expect(await clearOfRail(page, routeLine(page))).toBe(true);
    }).toPass({ timeout: 5_000 });
  });

  test('a refinement of the route in view keeps the view the user chose', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await planOsloToBergen(page);
    await expect(async () => {
      expect(await clearOfRail(page, page.locator('.route-stop--to'))).toBe(true);
    }).toPass({ timeout: 5_000 });

    // The user takes the map somewhere else…
    await dragMap(page, 0, 300);
    await page.waitForTimeout(600);
    const before = (await page.locator('.route-stop--to').boundingBox())!;

    // …then asks for the same stops again, or refines the route: nothing of
    // that is a new answer, so the view stays where they put it.
    await page.getByRole('button', { name: 'Gå', exact: true }).click();
    await expect(page.getByText('463 km').first()).toBeVisible();
    await page.getByRole('button', { name: 'Legg til viapunkt' }).click();
    await page.waitForTimeout(600);
    const after = (await page.locator('.route-stop--to').boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThan(2);
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  });
});

test.describe('a route taken out of view', () => {
  test.beforeEach(async ({ page, installMocks }) => {
    void installMocks;
    await page.route(/\/api\/search(\?.*)?$/, async (route, request) => {
      if (!request.url().includes('Bergen')) return route.fallback();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BERGEN) });
    });
    await page.route(/\/api\/route(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OSLO_TO_BERGEN) })
    );
  });

  test('says so under its numbers, and "Vis ruten" brings it back', async ({ page, gotoApp }) => {
    // Tall enough that the summary stays in the panel: the bar that stands in
    // for it never shows, which is where the way back used to end.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp();
    await waitForMapReady(page);
    await planOsloToBergen(page);
    const note = page.getByRole('status').filter({ hasText: /^Ruten/ });
    await expect(async () => {
      expect(await clearOfRail(page, page.locator('.route-stop--to'))).toBe(true);
    }).toPass({ timeout: 5_000 });
    // In view, there is nothing to say.
    await expect(page.getByRole('button', { name: 'Vis ruten', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /km.+Vis ruten/ })).toHaveCount(0);

    await dragMap(page, 0, 900);
    await expect(note).toHaveText('Ruten vises ikke på kartet.');
    await page.getByRole('button', { name: 'Vis ruten', exact: true }).click();
    await expect(async () => {
      expect(await clearOfRail(page, page.locator('.route-stop--to'))).toBe(true);
      expect(await clearOfRail(page, page.locator('.route-stop--from'))).toBe(true);
    }).toPass({ timeout: 5_000 });
    await expect(note).toHaveCount(0);
    // Focus went on to the numbers, not to the page.
    await expect(page.getByText('Avstand', { exact: true }).locator('xpath=../..')).toBeFocused();
  });

  test('only partly out of view is said as such', async ({ page, gotoApp }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp();
    await waitForMapReady(page);
    await planOsloToBergen(page);
    await page.waitForTimeout(600);
    // The route fills the frame's width, so a sideways drag takes its east end
    // (Oslo) past the edge and leaves the rest in view.
    await dragMap(page, 300, 0);
    await expect(page.getByRole('status').filter({ hasText: /^Ruten/ })).toHaveText('Ruten vises ikke helt på kartet.');
  });
});

test('a route planned where the user is looking leaves the view alone', async ({ page, gotoApp }) => {
  await gotoApp();
  await waitForMapReady(page);
  await mapContainer(page).click({ button: 'right', position: { x: 760, y: 360 } });
  await page.getByRole('menuitem', { name: 'Veibeskrivelse herfra' }).click();
  const from = page.locator('.route-stop--from');
  await expect(from).toBeVisible();
  const before = (await from.boundingBox())!;
  await mapContainer(page).click({ button: 'right', position: { x: 860, y: 300 } });
  await page.getByRole('menuitem', { name: 'Veibeskrivelse hit' }).click();
  await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  const after = (await from.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
});

test('"Vis ruten" brings the route back onto the map, not only the numbers into the panel', async ({
  page,
  gotoApp
}) => {
  // A route beside a 14-hit answer: the panel's summary is below its fold, so
  // the bar standing in for it shows (see routing.spec).
  await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        generator: 'byt5',
        features: Array.from({ length: 14 }, (_, i) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10.715 + (i % 5) * 0.012, 59.905 + Math.floor(i / 5) * 0.007] },
          properties: { name: `Apotek ${i + 1}`, amenity: 'pharmacy' }
        }))
      })
    })
  );
  const steps = Array.from({ length: 4 }, (_, i) => ({ text: `Trinn ${i + 1}`, distance: 300, time: 20000, interval: [0, 1] }));
  await page.route(/\/api\/route(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        routes: [
          {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[10.7522, 59.9139], [10.7461, 59.9111]] },
            properties: { distance: 5400, time: 640000, instructions: steps, primary: true, route_index: 0, style: 'solid' }
          }
        ],
        dashed_segments: []
      })
    })
  );
  await gotoApp();
  await waitForMapReady(page);
  await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
  await page.getByPlaceholder('F.eks. apotek eller lekeplasser').fill('apotek');
  await page.getByRole('button', { name: 'Søk', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^14 treff for/ })).toBeVisible({ timeout: 15_000 });
  await mapContainer(page).click({ button: 'right', position: { x: 700, y: 300 } });
  await page.getByRole('menuitem', { name: 'Veibeskrivelse herfra' }).click();
  await mapContainer(page).click({ button: 'right', position: { x: 800, y: 200 } });
  await page.getByRole('menuitem', { name: 'Veibeskrivelse hit' }).click();
  // The bar, named by its numbers; the panel's own "Vis ruten" appears too
  // once the route leaves the view.
  const bar = page.getByRole('button', { name: /km.+Vis ruten/ });
  await expect(bar).toBeVisible({ timeout: 15_000 });

  // The map is taken far from the route.
  await dragMap(page, 0, 700);
  await expect(async () => {
    expect(await clearOfRail(page, page.locator('.route-stop--to'))).toBe(false);
  }).toPass({ timeout: 5_000 });

  await bar.click();
  await expect(async () => {
    expect(await clearOfRail(page, page.locator('.route-stop--to'))).toBe(true);
    expect(await clearOfRail(page, page.locator('.route-stop--from'))).toBe(true);
  }).toPass({ timeout: 5_000 });
});

test.describe('an area answer and the view it was asked about', () => {
  test.beforeEach(async ({ page, gotoApp }) => {
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIX_HITS) })
    );
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
    await page.getByPlaceholder('F.eks. apotek eller lekeplasser').fill('apotek');
    await page.getByRole('button', { name: 'Søk', exact: true }).click();
    await expect(page.getByRole('heading', { name: '6 treff for «apotek»' })).toBeVisible({ timeout: 15_000 });
    // Let the answer's own fit land: Leaflet ignores a drag while a zoom animates.
    await page.waitForTimeout(600);
  });

  test('a pan that takes the hits away says so, and "Vis alle treff" brings them back', async ({ page }) => {
    const list = page.getByRole('complementary', { name: '6 treff for «apotek»' });
    const note = list.getByRole('status');
    // Every hit is in view: nothing to say, and nothing takes room.
    await expect(note).toHaveText('');
    await expect(list.getByRole('button', { name: 'Vis alle treff' })).toHaveCount(0);

    // One drag used to leave six confident rows over an empty map.
    await dragMap(page, 0, 700);
    // Said in the verb its button answers with, and never with
    // "kartutsnittet": every hit lies inside the extent that was searched.
    await expect(note).toHaveText('Ingen av treffene vises på kartet.');
    const showAll = list.getByRole('button', { name: 'Vis alle treff' });
    await showAll.focus();
    await page.keyboard.press('Enter');

    // The answer is back on the map, the note has nothing left to say, and
    // focus went on to the rows rather than dropping to the page.
    await expect(note).toHaveText('');
    await expect(showAll).toHaveCount(0);
    await expect(page.locator('[data-overpass-row="0"]')).toBeFocused();
    const dots = page.locator('.overpass-hit');
    await expect(dots).toHaveCount(6);
    for (let i = 0; i < 6; i += 1) {
      expect(await clearOfRail(page, dots.nth(i))).toBe(true);
    }
  });

  test('some hits out of view are counted', async ({ page }) => {
    const note = page.getByRole('complementary', { name: '6 treff for «apotek»' }).getByRole('status');
    // A drag to the right takes the eastern hits past the edge and keeps the rest.
    await dragMap(page, 400, 0);
    await expect(note).toHaveText(/^[1-5] av 6 treff vises ikke på kartet\.$/);
  });

  test('the extent that was asked about is drawn while its answer stands', async ({ page }) => {
    const extent = page.locator('path.area-extent');
    await expect(extent).toHaveCount(1);
    // A query's edge must never eat a map click.
    expect(await extent.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');

    await page.getByRole('button', { name: 'Lukk resultatliste' }).click();
    await expect(extent).toHaveCount(0);
    await page.locator('[data-undo-notice="area-results"]').getByRole('button', { name: 'Angre' }).click();
    await expect(extent).toHaveCount(1);
  });
});

test('a single hit out of view is named as one', async ({ page, gotoApp }) => {
  await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...SIX_HITS, features: SIX_HITS.features.slice(0, 1) })
    })
  );
  await gotoApp();
  await waitForMapReady(page);
  await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
  await page.getByPlaceholder('F.eks. apotek eller lekeplasser').fill('apotek');
  await page.getByRole('button', { name: 'Søk', exact: true }).click();
  const list = page.getByRole('complementary', { name: '1 treff for «apotek»' });
  await expect(list).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await dragMap(page, 0, 700);
  await expect(list.getByRole('status')).toHaveText('Treffet vises ikke på kartet.');
  await list.getByRole('button', { name: 'Vis treffet' }).click();
  await expect(list.getByRole('status')).toHaveText('');
});
