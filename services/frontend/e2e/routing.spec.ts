import { test, expect, type Page } from './fixtures/test';
import { mapContainer, waitForMapReady } from './helpers/map';

/**
 * Drive the UI into navigation mode with a "from" set, then fill the
 * destination via the NavigationPanel autocomplete and select a result so a
 * route is computed.
 */
async function setupRoute(page: Page): Promise<void> {
  // 1. Search and select a feature -> opens the details sidebar.
  const search = page.getByPlaceholder('Søk etter sted eller adresse…');
  await search.fill('Oslo');
  // Anchored: the accessible name is "Oslo, Norge city" and must not match
  // "Oslo Sentralstasjon, Oslo, Norge".
  const firstResult = page.getByRole('option', { name: /^Oslo, Norge/ });
  await expect(firstResult).toBeVisible({ timeout: 10_000 });
  await firstResult.click();

  // 2. "Herfra" sets the origin and switches to navigation mode.
  await page.getByRole('button', { name: 'Veibeskrivelse herfra' }).click();
  await expect(page.getByRole('heading', { name: 'Veibeskrivelse' })).toBeVisible();

  // 3. Fill the destination input and pick the autocomplete result.
  const toInput = page.getByPlaceholder('Velg destinasjon…');
  await toInput.fill('Sentral');
  // NavigationPanel dropdown shows result.name / first part of display_name.
  const dest = page.getByRole('option', { name: /^Oslo Sentralstasjon, Oslo, Norge/ }).first();
  await expect(dest).toBeVisible({ timeout: 10_000 });
  await dest.click();
}

/**
 * A route with a stop between its ends, beside a 14-hit area answer at
 * 1280×720, whose recalculation for "Sykle" fails 1.5 s late, after a place
 * card has opened above it: the failure is held back below the card.
 */
async function holdFailureBehindCard(page: Page, gotoApp: () => Promise<void>): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  const steps = Array.from({ length: 12 }, (_, i) => ({
    text: `Trinn nummer ${i + 1} med en ganske lang instruksjonstekst`,
    distance: 300,
    time: 20000,
    interval: [0, 1]
  }));
  let fail = false;
  await page.route(/\/api\/route(\?.*)?$/, async (route) => {
    if (fail) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ status: 502, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
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
    });
  });
  // An area answer shares the rail, as when a caseworker routes to one of
  // the pharmacies found: that is when the route panel is short enough for
  // a held-back failure to stay out of sight (0 of 112px at 720).
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
  await gotoApp();
  await waitForMapReady(page);
  await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
  await page.getByPlaceholder('F.eks. apotek eller lekeplasser').fill('apotek');
  await page.getByRole('button', { name: 'Søk', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^14 treff for «apotek»/ })).toBeVisible({ timeout: 15_000 });
  await mapContainer(page).click({ button: 'right', position: { x: 400, y: 300 } });
  await page.getByRole('menuitem', { name: 'Veibeskrivelse herfra' }).click();
  await mapContainer(page).click({ button: 'right', position: { x: 800, y: 500 } });
  await page.getByRole('menuitem', { name: 'Viapunkt her' }).click();
  await mapContainer(page).click({ button: 'right', position: { x: 600, y: 200 } });
  await page.getByRole('menuitem', { name: 'Veibeskrivelse hit' }).click();
  await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 15_000 });

  fail = true;
  await page.getByRole('button', { name: 'Sykle', exact: true }).click();
  await mapContainer(page).click({ position: { x: 1000, y: 300 } });
  const card = page.getByRole('region', { name: 'Detaljer' });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('alert').filter({ hasText: 'Viser forrige rute' })).toHaveCount(1, { timeout: 10_000 });
  await page.waitForTimeout(300);
}

test.describe('routing', () => {
  test('computing a route shows the distance/time summary from the mocked /route', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);

    // Route summary labels + values (single route: 2000 m -> "2 km", 150000 ms -> "3 min";
    // Norwegian formats, see lib/format.ts).
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Reisetid', { exact: true })).toBeVisible();
    await expect(page.getByText('2 km', { exact: true })).toBeVisible();
    await expect(page.getByText('3 min', { exact: true })).toBeVisible();

    // Turn-by-turn steps header (h6; the panel title is the h5) + first instruction.
    await expect(page.getByRole('heading', { name: 'Trinn for trinn', level: 3 })).toBeVisible();
    await expect(page.getByText('Kjør mot sørvest')).toBeVisible();
  });

  test('toggling "Vis alternative ruter" shows >1 route and selecting one activates it', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);

    // Wait for the initial (single) route summary first.
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Toggle alternatives -> the request gains alternatives=true, and the mock
    // returns the multi-route payload.
    const altToggle = page.getByRole('checkbox', { name: 'Vis alternative ruter' });
    await altToggle.check();

    // The "Ruter" list appears with more than one route entry.
    await expect(page.getByRole('heading', { name: 'Ruter' })).toBeVisible({ timeout: 10_000 });
    const routeButtons = page.getByRole('button', { name: /^Rute \d/ });
    await expect(routeButtons).toHaveCount(2);

    // The primary route (Rute 1) is active initially.
    const primary = page.getByRole('button', { name: 'Rute 1' });
    const alternative = page.getByRole('button', { name: 'Rute 2' });
    await expect(primary).toHaveAttribute('aria-pressed', 'true');
    await expect(alternative).toHaveAttribute('aria-pressed', 'false');

    // Selecting the alternative makes it the active route.
    await alternative.click();
    await expect(alternative).toHaveAttribute('aria-pressed', 'true');
    await expect(primary).toHaveAttribute('aria-pressed', 'false');

    // The summary now reflects the alternative's distance/time (2600 m, 180000 ms).
    // Exact match: the route list and instructions also contain "2,6 km".
    await expect(page.getByText('2,6 km', { exact: true })).toBeVisible();
    await expect(page.getByText('3 min', { exact: true })).toBeVisible();
  });
});

/**
 * The chosen route is filled like the pressed Reisemiddel segment. With a
 * tint it measured 1.18:1 in light, and in dark it had the weakest outline in
 * the list (critique run 12). WCAG 1.4.11 asks 3:1 for a state.
 */
test.describe('the chosen route', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`stands out from the card and the other routes (${scheme})`, async ({ page, gotoApp }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await gotoApp();
      await waitForMapReady(page);
      await setupRoute(page);
      await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('checkbox', { name: 'Vis alternative ruter' }).check();
      await expect(page.getByRole('heading', { name: 'Ruter' })).toBeVisible({ timeout: 10_000 });
      const ratio = await page.getByRole('button', { name: /^Rute 1/ }).evaluate((el) => {
        const lum = (c: string) => {
          const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
            const x = Number(v) / 255;
            return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const fill = getComputedStyle(el).backgroundColor;
        const card = getComputedStyle(el.closest('aside') as HTMLElement).backgroundColor;
        const [hi, lo] = [lum(fill), lum(card)].sort((p, q) => q - p);
        return (hi + 0.05) / (lo + 0.05);
      });
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  }
});

test.describe('alternatives and via points', () => {
  test('the first via point switches alternatives off everywhere: request, checkbox and list', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });

    const altToggle = page.getByRole('checkbox', { name: 'Vis alternative ruter' });
    await altToggle.check();
    await expect(page.getByRole('heading', { name: 'Ruter' })).toBeVisible({ timeout: 10_000 });

    // Add a via point from the map's own menu.
    const viaRequest = page.waitForRequest(
      (req) => req.url().includes('/api/route') && req.url().includes('waypoint='),
      { timeout: 15_000 }
    );
    await page.locator('.leaflet-container').click({ button: 'right', position: { x: 640, y: 420 } });
    await page.getByRole('menuitem', { name: 'Viapunkt her' }).click();
    const request = await viaRequest;
    // The client only sends alternatives=true; off means the parameter is absent.
    expect(new URL(request.url()).searchParams.get('alternatives')).toBeNull();

    // The panel says the same thing as the request.
    await expect(altToggle).toBeDisabled();
    await expect(altToggle).not.toBeChecked();
    await expect(page.getByText('Ikke tilgjengelig med viapunkter')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ruter' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Rute \d/ })).toHaveCount(0);
  });
});

test.describe('Reisemiddel on close', () => {
  test('closing the route panel resets Reisemiddel to Kjør, and Angre brings the choice back', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });

    const walk = page.getByRole('button', { name: 'Gå', exact: true });
    await walk.click();
    await expect(walk).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Lukk veibeskrivelse' }).click();
    await page.getByRole('button', { name: 'Angre' }).click();
    await expect(page.getByRole('button', { name: 'Gå', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Lukk veibeskrivelse' }).click();
    await page.getByRole('button', { name: 'Veibeskrivelse', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Kjør', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('route panel order', () => {
  test('asks where before how, and offers alternatives only once a route exists', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    await page.getByRole('button', { name: 'Veibeskrivelse' }).click();
    const start = page.getByRole('combobox', { name: 'Startpunkt' });
    await expect(start).toBeFocused();

    // Before a route: no alternatives toggle, and the Reisemiddel group sits
    // beneath the destination field with Kjør preselected.
    await expect(page.getByRole('checkbox', { name: 'Vis alternative ruter' })).toHaveCount(0);
    const destination = page.getByRole('combobox', { name: 'Destinasjon' });
    const drive = page.getByRole('button', { name: 'Kjør', exact: true });
    await expect(drive).toHaveAttribute('aria-pressed', 'true');
    const destinationBox = await destination.boundingBox();
    const driveBox = await drive.boundingBox();
    expect(destinationBox).not.toBeNull();
    expect(driveBox).not.toBeNull();
    expect(driveBox!.y).toBeGreaterThan(destinationBox!.y + destinationBox!.height);

    // Fill both stops from the panel's own fields.
    await start.fill('Oslo');
    await page
      .getByRole('listbox', { name: 'Startpunkt – forslag' })
      .getByRole('option', { name: /^Oslo, Norge/ })
      .click();
    await destination.fill('Sentral');
    await page
      .getByRole('listbox', { name: 'Destinasjon – forslag' })
      .getByRole('option', { name: /^Oslo Sentralstasjon/ })
      .click();

    // The answer arrives beneath the question, and only now the refinement.
    const summary = page.getByText('Avstand', { exact: true });
    await expect(summary).toBeVisible({ timeout: 10_000 });
    const toggle = page.getByRole('checkbox', { name: 'Vis alternative ruter' });
    await expect(toggle).toBeVisible();
    const summaryBox = await summary.boundingBox();
    const toggleBox = await toggle.boundingBox();
    expect(summaryBox!.y).toBeGreaterThan(driveBox!.y);
    expect(toggleBox!.y).toBeGreaterThan(summaryBox!.y);
  });
});

test.describe('routing is not lost on map clicks', () => {
  test('a map click while planning opens the place above the route, without moving the map', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });
    const hash = () => page.evaluate(() => window.location.hash);
    await expect.poll(hash, { timeout: 10_000 }).toContain('route=');
    const zoomOf = (value: string) => value.match(/map=(\d+)\//)?.[1];
    const zoomBefore = zoomOf(await hash());

    await page.locator('.leaflet-container').click({ position: { x: 900, y: 600 } });
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // The route and its panel are untouched, and the view did not jump.
    await expect(page.getByRole('heading', { name: 'Veibeskrivelse', level: 2 })).toBeVisible();
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible();
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2);
    // The stops wear the route panel's marks: a ring for the start, a dot for the destination.
    await expect(page.locator('.route-stop--from, .route-stop--to')).toHaveCount(2);
    const after = await hash();
    expect(zoomOf(after)).toBe(zoomBefore);
    expect(after).toContain('route=');

    // Escape closes the place first; the route stays.
    await page.getByRole('button', { name: 'Lukk detaljer' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Detaljer' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Veibeskrivelse', level: 2 })).toBeVisible();
  });

  test('a place opened from the map while planning can become a via point', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.locator('.leaflet-container').click({ position: { x: 900, y: 600 } });
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible({ timeout: 10_000 });
    const viaRequest = page.waitForRequest(
      (req) => req.url().includes('/api/route') && req.url().includes('waypoint='),
      { timeout: 15_000 }
    );
    await page.getByRole('button', { name: 'Viapunkt her' }).click();
    await viaRequest;
    await expect(page.getByRole('region', { name: 'Detaljer' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Viapunkt 1' })).toBeVisible();
  });

  test('clearing the search field keeps the route, and route pins are not dead tab stops', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Tøm søkefeltet' }).click();
    await page.waitForTimeout(600);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible();
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('route=');
    await expect(page.locator('.leaflet-marker-icon[tabindex="0"]')).toHaveCount(0);
  });

  test('clicking the route line itself keeps the computed route', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.locator('.leaflet-overlay-pane path.leaflet-interactive').first().click({ force: true });
    await page.waitForTimeout(500);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible();
  });
});

test.describe('route summary stays reachable', () => {
  // Beside an area answer at 1280×720 the numbers sat half under the panel's
  // edge (16 of the 27px of "5,4 km", none clear of the fade) and the foot bar
  // waited for the summary to leave view entirely, so it never came. The bar
  // now shows whenever the summary is not wholly readable (critique run 14).
  test('beside a hit list at 720, the numbers are readable in the foot bar, which brings the summary back', async ({
    page,
    gotoApp
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
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
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 15_000 });

    const bar = page.getByRole('button', { name: /Vis ruten/ });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('5,4 km');

    await bar.click();
    const summary = page.getByText('Avstand', { exact: true }).locator('xpath=../..');
    const panel = page.locator('aside', { has: summary });
    await expect(async () => {
      const s = (await summary.boundingBox())!;
      const p = (await panel.boundingBox())!;
      // Wholly readable: inside the panel and clear of the 24px fade.
      expect(s.y).toBeGreaterThanOrEqual(p.y);
      expect(s.y + s.height).toBeLessThanOrEqual(p.y + p.height - 24);
    }).toPass();
    await expect(bar).toHaveCount(0);
  });

  test('a long route panel keeps distance and time at its foot, and brings the summary back', async ({
    page,
    gotoApp
  }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });

    // The alternatives list makes the answer half long enough that the summary
    // leaves view once the panel is scrolled to its foot — the state the bar at
    // the foot exists for. (One empty via row alone no longer does it: the
    // panel settles at 757px in a 436px slot with the summary still in view.)
    await page.getByRole('checkbox', { name: 'Vis alternative ruter' }).check();
    await expect(page.getByRole('heading', { name: 'Ruter' })).toBeVisible();
    const panel = page.locator('aside', { has: page.getByRole('heading', { name: 'Veibeskrivelse' }) });
    await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));

    const bar = page.getByRole('button', { name: /Vis ruten/ });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('2 km');

    await bar.click();
    await expect(page.getByText('Avstand', { exact: true })).toBeInViewport();
    await expect(bar).toHaveCount(0);
  });
});

test.describe('route failures', () => {
  test('a failed recalculation stays readable when the panel overflows', async ({ page, gotoApp }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    let fail = false;
    await page.route(/\/api\/route(\?.*)?$/, (route) =>
      fail ? route.fulfill({ status: 502, contentType: 'application/json', body: '{}' }) : route.fallback()
    );
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });
    // One empty via row is all the panel allows; the route's own steps already
    // carry the answer half past the fold at this height.
    await page.getByRole('button', { name: 'Legg til viapunkt' }).click();
    const overflows = await page
      .locator('aside', { has: page.getByRole('heading', { name: 'Veibeskrivelse' }) })
      .evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(overflows).toBe(true);

    fail = true;
    await page.getByRole('button', { name: 'Gå', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Kunne ikke beregne ruten.' });
    await expect(alert).toBeVisible();

    // The whole sentence is inside the panel's box, not cut off by its fold.
    const panel = page.locator('aside', { has: alert });
    const alertBox = await alert.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(alertBox!.y).toBeGreaterThanOrEqual(panelBox!.y - 1);
    expect(alertBox!.y + alertBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height + 1);
    await expect(page.getByRole('button', { name: /Vis ruten/ })).toHaveCount(0);

    // Scrolled past its own header, the panel still shows its name and its way out.
    await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const bar = panel.locator('[data-panel-bar]');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Veibeskrivelse');
    await expect(bar.getByRole('button', { name: 'Lukk veibeskrivelse' })).toBeVisible();
  });

  // The banner says "Viser forrige rute"; the numbers it points at must be on
  // screen with it. On a three-stop route they sat 14px below the panel, while
  // a bottom margin meant to reserve their room never fired: the test above
  // only ever looked at the banner (critique run 11).
  test("a failed recalculation brings the kept route's numbers into view", async ({ page, gotoApp }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const steps = Array.from({ length: 12 }, (_, i) => ({
      text: `Trinn nummer ${i + 1} med en ganske lang instruksjonstekst`,
      distance: 300,
      time: 20000,
      interval: [0, 1]
    }));
    let fail = false;
    await page.route(/\/api\/route(\?.*)?$/, (route) =>
      fail
        ? route.fulfill({ status: 502, contentType: 'application/json', body: '{}' })
        : route.fulfill({
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
    await mapContainer(page).click({ button: 'right', position: { x: 400, y: 300 } });
    await page.getByRole('menuitem', { name: 'Veibeskrivelse herfra' }).click();
    await mapContainer(page).click({ button: 'right', position: { x: 800, y: 500 } });
    await page.getByRole('menuitem', { name: 'Viapunkt her' }).click();
    await mapContainer(page).click({ button: 'right', position: { x: 600, y: 200 } });
    await page.getByRole('menuitem', { name: 'Veibeskrivelse hit' }).click();
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 15_000 });

    fail = true;
    await page.getByRole('button', { name: 'Sykle', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Viser forrige rute' });
    await expect(alert).toBeVisible();
    const panel = page.locator('aside', { has: alert });
    const distance = panel.getByText('5,4 km', { exact: true });
    await expect(async () => {
      const p = (await panel.boundingBox())!;
      const v = (await distance.boundingBox())!;
      const a = (await alert.boundingBox())!;
      // Inside the panel and clear of the 24px fade at its foot…
      expect(v.y).toBeGreaterThanOrEqual(p.y);
      expect(v.y + v.height).toBeLessThanOrEqual(p.y + p.height - 24);
      // …with the banner that points at them still whole above.
      expect(a.y).toBeGreaterThanOrEqual(p.y);
    }).toPass();
  });

  // The panel used to be rendered in two places, so opening a card rebuilt
  // it, and the rebuild re-ran the failure scroll: a place asked about while
  // a failed route stood opened 0px visible, focus on its hidden name
  // (critique run 12).
  test('a place opened on the map while a failed route stands opens in view', async ({ page, gotoApp }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const steps = Array.from({ length: 12 }, (_, i) => ({
      text: `Trinn nummer ${i + 1} med en ganske lang instruksjonstekst`,
      distance: 300,
      time: 20000,
      interval: [0, 1]
    }));
    let fail = false;
    await page.route(/\/api\/route(\?.*)?$/, (route) =>
      fail
        ? route.fulfill({ status: 502, contentType: 'application/json', body: '{}' })
        : route.fulfill({
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
    await mapContainer(page).click({ button: 'right', position: { x: 400, y: 300 } });
    await page.getByRole('menuitem', { name: 'Veibeskrivelse herfra' }).click();
    await mapContainer(page).click({ button: 'right', position: { x: 800, y: 500 } });
    await page.getByRole('menuitem', { name: 'Viapunkt her' }).click();
    await mapContainer(page).click({ button: 'right', position: { x: 600, y: 200 } });
    await page.getByRole('menuitem', { name: 'Veibeskrivelse hit' }).click();
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 15_000 });
    fail = true;
    await page.getByRole('button', { name: 'Sykle', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Viser forrige rute' })).toBeVisible();

    await mapContainer(page).click({ position: { x: 1000, y: 300 } });
    const card = page.getByRole('region', { name: 'Detaljer' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    const panel = page.locator('aside', { has: card });
    const name = card.getByRole('heading', { level: 2 });
    await expect(name).toBeFocused();
    await expect(async () => {
      const p = (await panel.boundingBox())!;
      const n = (await name.boundingBox())!;
      // The name the focus is on is inside the panel's box, not scrolled away.
      expect(n.y).toBeGreaterThanOrEqual(p.y);
      expect(n.y + n.height).toBeLessThanOrEqual(p.y + p.height);
    }).toPass();
  });

  // The same rebuild emptied a destination the user had typed but not yet
  // picked, whenever a card opened or closed (critique run 12).
  test('a destination typed but not yet picked survives a place opened on the map', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('button', { name: 'Veibeskrivelse', exact: true }).click();
    const destination = page.getByPlaceholder('Velg destinasjon…');
    await destination.fill('Storgata 1');
    await page.keyboard.press('Escape');
    await mapContainer(page).click({ position: { x: 1000, y: 300 } });
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible({ timeout: 10_000 });
    await expect(destination).toHaveValue('Storgata 1');
    await page.getByRole('button', { name: 'Lukk detaljer' }).first().click();
    await expect(destination).toHaveValue('Storgata 1');
  });

  // A slow router can answer after the user has opened a card; that failure
  // used to scroll the panel away from the card, leaving 0px of it in view
  // (critique run 13). It is announced and waits below the card instead.
  test('a failure that arrives after a card opened leaves the card in view, and shows once the card closes', async ({
    page,
    gotoApp
  }) => {
    await holdFailureBehindCard(page, gotoApp);
    const card = page.getByRole('region', { name: 'Detaljer' });

    const panel = page.locator('aside', { has: card });
    const name = card.getByRole('heading', { level: 2 });
    const p = (await panel.boundingBox())!;
    const n = (await name.boundingBox())!;
    expect(n.y).toBeGreaterThanOrEqual(p.y);
    expect(n.y + n.height).toBeLessThanOrEqual(p.y + p.height);

    // Held back while the card was open, the failure comes into view once it
    // closes. Held back for good, 0 of the banner's 112px showed, and only the
    // pressed travel mode hinted at it (critique run 14).
    await card.getByRole('button', { name: 'Lukk detaljer' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Viser forrige rute' });
    const routePanel = page.locator('aside', { has: alert });
    await expect(async () => {
      const a = (await alert.boundingBox())!;
      const r = (await routePanel.boundingBox())!;
      expect(a.y).toBeGreaterThanOrEqual(r.y);
      expect(a.y + a.height).toBeLessThanOrEqual(r.y + r.height);
    }).toPass();
  });

  // Closed from the panel's condensed bar with the panel scrolled down, the
  // card leaves the failure above the view. Scrolled to alone, the kept
  // numbers landed under the bar, with 0 of the banner's 112px in view
  // (polish, critique run 14).
  test('a failure held back by a card closed from the panel bar comes into view below the bar', async ({
    page,
    gotoApp
  }) => {
    await holdFailureBehindCard(page, gotoApp);
    const card = page.getByRole('region', { name: 'Detaljer' });
    await page.locator('aside', { has: card }).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.locator('[data-panel-bar]').getByRole('button', { name: 'Lukk detaljer' }).click();
    await expect(card).toHaveCount(0);

    const alert = page.getByRole('alert').filter({ hasText: 'Viser forrige rute' });
    const panel = page.locator('aside', { has: alert });
    const distance = panel.getByText('5,4 km', { exact: true });
    await expect(async () => {
      const p = (await panel.boundingBox())!;
      const bar = await panel.locator('[data-panel-bar]').boundingBox();
      const clearTop = bar ? bar.y + bar.height : p.y;
      for (const shown of [(await alert.boundingBox())!, (await distance.boundingBox())!]) {
        expect(shown.y).toBeGreaterThanOrEqual(clearTop);
        expect(shown.y + shown.height).toBeLessThanOrEqual(p.y + p.height - 24);
      }
    }).toPass();
  });

  test('a failed recalculation says why and keeps the last route', async ({ page, gotoApp }) => {
    let fail = false;
    await page.route(/\/api\/route(\?.*)?$/, (route) =>
      fail ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.fallback()
    );
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });

    fail = true;
    await page.getByRole('button', { name: 'Gå', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Kunne ikke beregne ruten.' });
    await expect(alert).toContainText('Rutetjenesten svarer ikke.');
    // The pressed mode is "Gå" while the kept route is the car one: say so.
    await expect(alert).toContainText('Viser forrige rute (Kjør).');
    await expect(page.getByText('Forrige rute', { exact: true })).toBeVisible();
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible();

    // The sticky summary bar never draws over an alert.
    await expect(page.getByRole('button', { name: /Vis ruten/ })).toHaveCount(0);

    fail = false;
    await alert.getByRole('button', { name: 'Prøv igjen' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Kunne ikke beregne ruten.' })).toHaveCount(0);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible();
  });

  test('a refused API key is named in the failure banner', async ({ page, gotoApp }) => {
    await page.route(/\/api\/route(\?.*)?$/, (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Rutetjenesten avviste API-nøkkelen (sjekk GRAPHHOPPER_API_KEY)',
          code: 'graphhopper_key_rejected'
        })
      })
    );
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);

    const alert = page.getByRole('alert').filter({ hasText: 'Kunne ikke beregne ruten.' });
    await expect(alert).toContainText('Rutetjenesten avviste API-nøkkelen.');
    // Our own sentence, never the backend's text or its variable name.
    await expect(alert).not.toContainText('GRAPHHOPPER_API_KEY');
  });
});

/**
 * The route follows the stops that were picked, not the text in the fields.
 * A field left holding something else says the trip goes somewhere it does
 * not, and recovering from a failure used to drop the keyboard on the page
 * (critique run 15).
 */
test.describe('a panel that keeps its word', () => {
  test('a stray key over a picked stop goes back to the stop the route follows', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });

    const destination = page.getByRole('combobox', { name: 'Destinasjon' });
    const full = 'Oslo Sentralstasjon, Oslo, Norge';
    await destination.focus();
    await expect(destination).toHaveValue(full);
    // Focus selects the whole stop so typing replaces it: one key is enough.
    // The selection is what makes that true, so wait for it rather than
    // racing it — typed too early, the key only appends.
    await expect
      .poll(async () => destination.evaluate((el: HTMLInputElement) => el.selectionEnd))
      .toBe(full.length);
    await page.keyboard.type('x');
    await expect(destination).toHaveValue('x');

    // Escape puts the stop back rather than leaving the panel disagreeing
    // with the route still drawn on the map.
    await page.keyboard.press('Escape');
    await expect(destination).toHaveValue(full);
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible();

    // So does leaving the field. (The field kept focus through the Escape, so
    // the selection has to be made again for a key to replace the stop.)
    await destination.press('ControlOrMeta+a');
    await page.keyboard.type('y');
    await expect(destination).toHaveValue('y');
    await page.keyboard.press('Tab');
    await expect(destination).toHaveValue('Oslo Sentralstasjon');
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible();
  });

  test('"Prøv igjen" hands focus on: to the next attempt, then to the numbers', async ({
    page,
    gotoApp
  }) => {
    let fail = true;
    await page.route(/\/api\/route(\?.*)?$/, async (route) => {
      if (fail) {
        await route.fulfill({ status: 502, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fallback();
    });
    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);
    const retry = page.getByRole('button', { name: 'Prøv igjen' });
    await expect(retry).toBeVisible({ timeout: 10_000 });

    // Failing again: focus lands on the attempt that is left to make.
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Prøv igjen' })).toBeFocused({ timeout: 10_000 });

    // Succeeding: focus lands on the answer it produced.
    fail = false;
    await page.keyboard.press('Enter');
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => page.evaluate(() => document.activeElement?.textContent ?? ''), { timeout: 5_000 })
      .toContain('Avstand');
  });
});
