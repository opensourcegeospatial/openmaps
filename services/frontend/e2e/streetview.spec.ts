import { test, expect } from './fixtures/test';
import { waitForMapReady, openTools, mapContainer } from './helpers/map';

const PANORAMAS = /\/streetview\/api\/panoramas(\?.*)?$/;

/** Gatebilde is a tool the user picks up: off on arrival, remembered in the hash. */
test.describe('street-view layer', () => {
  test('is off by default and loads points only once switched on', async ({ page, gotoApp }) => {
    const panoramaRequests: string[] = [];
    page.on('request', (req) => {
      if (PANORAMAS.test(req.url())) panoramaRequests.push(req.url());
    });

    // Zoom 15 is inside the layer's range, so only the default keeps it quiet.
    await gotoApp('#map=15/59.9139/10.7522');
    await waitForMapReady(page);
    await openTools(page);
    const row = page.getByRole('button', { name: 'Gatebilde', exact: true });
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(800);
    expect(panoramaRequests).toHaveLength(0);

    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => panoramaRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    // The link now carries the layer, so it can be shared switched on.
    await expect
      .poll(() => page.evaluate(() => window.location.hash), { timeout: 10_000 })
      .toContain('streetview=1');
  });

  test('a shared link with streetview=1 arrives with the layer on', async ({ page, gotoApp }) => {
    const panoramaRequests: string[] = [];
    page.on('request', (req) => {
      if (PANORAMAS.test(req.url())) panoramaRequests.push(req.url());
    });

    await gotoApp('#map=15/59.9139/10.7522&streetview=1');
    await waitForMapReady(page);
    await openTools(page);
    await expect(page.getByRole('button', { name: 'Gatebilde', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => panoramaRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('says why nothing is drawn: zoom in first, then no pictures in this area', async ({
    page,
    gotoApp
  }) => {
    // The mocked config starts below the layer's minimum zoom, and the mocked
    // panorama service has no points.
    await gotoApp();
    await waitForMapReady(page);
    await openTools(page);
    await page.getByRole('button', { name: 'Gatebilde', exact: true }).click();
    const tools = page.getByRole('group', { name: 'Verktøy' });
    await expect(tools.getByText('Zoom inn for å se gatebilder.')).toBeVisible();

    await page.getByRole('button', { name: 'Zoom inn', exact: true }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Zoom inn', exact: true }).click();
    await expect(tools.getByText('Ingen gatebilder i dette området.')).toBeVisible({ timeout: 10_000 });
    await expect(tools.getByText('Zoom inn for å se gatebilder.')).toHaveCount(0);
  });

  test('does not request panorama points below its minimum zoom, but does after zooming in', async ({
    page,
    gotoApp
  }) => {
    const panoramaRequests: string[] = [];
    page.on('request', (req) => {
      if (PANORAMAS.test(req.url())) panoramaRequests.push(req.url());
    });

    // The mocked config starts at zoom 13 (below the default minimum of 14).
    await gotoApp('#streetview=1');
    await waitForMapReady(page);
    await page.waitForTimeout(800);
    expect(panoramaRequests).toHaveLength(0);

    // Zoom in twice -> zoom 15 -> the layer starts loading points.
    await page.getByRole('button', { name: 'Zoom inn', exact: true }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Zoom inn', exact: true }).click();
    await expect.poll(() => panoramaRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('a layer that fails to load un-presses the tool and says so once', async ({ page, gotoApp }) => {
    await page.route(PANORAMAS, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    );

    await gotoApp('#map=15/59.9139/10.7522');
    await waitForMapReady(page);
    await openTools(page);
    const row = page.getByRole('button', { name: 'Gatebilde', exact: true });
    await row.click();

    await expect(page.getByText('Kunne ikke hente gatebilder. Prøv igjen om litt.')).toBeVisible({
      timeout: 10_000
    });
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    // Pan: the layer is off, so nothing retries and the message does not stack.
    await page.getByRole('button', { name: 'Zoom inn', exact: true }).click();
    await page.waitForTimeout(600);
    await expect(page.getByText('Kunne ikke hente gatebilder. Prøv igjen om litt.')).toHaveCount(1);
  });

  test('with the layer on, Enter on the map opens the nearest panorama, and Escape returns focus to the map', async ({
    page,
    gotoApp
  }) => {
    await page.route(PANORAMAS, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [10.7522, 59.9139] }, properties: { id: 'p1' } }
          ]
        })
      })
    );
    const loaded = page.waitForResponse(PANORAMAS);
    await gotoApp('#map=15/59.9139/10.7522&streetview=1');
    await waitForMapReady(page);
    await loaded;
    await page.waitForTimeout(400);

    const map = mapContainer(page);
    await page.getByPlaceholder('Søk etter sted eller adresse…').focus();
    await page.keyboard.press('Tab'); // Veibeskrivelse
    await page.keyboard.press('Tab'); // the map
    await expect(map).toBeFocused();
    await expect(map).toHaveAttribute('aria-label', /Med Gatebilde på åpner Enter/);

    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Gatebilde' });
    await expect(panel).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lukk gatebilde' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(map).toBeFocused();

    // Escape from the map closes it too.
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await map.focus();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(map).toBeFocused();

    // The row says how to reach a picture.
    await openTools(page);
    await expect(page.getByRole('group', { name: 'Verktøy' }).getByText(/trykk Enter på kartet/)).toBeVisible();
  });
});

/**
 * The tool stack lifts above the street-view panel (50vh). A full tools card,
 * and more so with a measurement readout above it, is taller than the room
 * that leaves: the group is capped and scrolls. It must never reach the
 * top-right cluster and cover the basemap select — the very control a tile
 * failure tells the user to reach for — and opening it must leave focus on a
 * row that is actually on screen (critique run 9).
 */
test.describe('the tool stack above an open panorama', () => {
  test('never covers the basemap select, and opens on a row the user can see', async ({
    page,
    gotoApp
  }) => {
    await page.route(PANORAMAS, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'p1',
              geometry: { type: 'Point', coordinates: [10.7522, 59.9139] },
              properties: { id: 'p1' }
            }
          ]
        })
      })
    );
    const loaded = page.waitForResponse(PANORAMAS);
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoApp('#map=15/59.9139/10.7522&streetview=1');
    await waitForMapReady(page);
    await loaded;
    await page.waitForTimeout(400);

    // Open the panorama the way a keyboard user does.
    await page.getByPlaceholder('Søk etter sted eller adresse…').focus();
    await page.keyboard.press('Tab'); // Veibeskrivelse
    await page.keyboard.press('Tab'); // the map
    await expect(mapContainer(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Lukk gatebilde' })).toBeVisible({ timeout: 10_000 });

    await openTools(page);
    await page.waitForTimeout(300); // the lift and the scroll have to settle

    const geometry = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>('.map-tools-scroll');
      const stack = document.querySelector<HTMLElement>('.map-tools-stack');
      const select = document.querySelector<HTMLElement>('select');
      const active = document.activeElement as HTMLElement | null;
      const g = group?.getBoundingClientRect();
      const s = stack?.getBoundingClientRect();
      const sel = select?.getBoundingClientRect();
      const a = active?.getBoundingClientRect();
      return {
        capped: group ? getComputedStyle(group).maxHeight !== 'none' : false,
        stackTop: s ? Math.round(s.top) : -1,
        selectBottom: sel ? Math.round(sel.bottom) : -1,
        selectCentreIsSelect: sel
          ? document.elementFromPoint(sel.left + sel.width / 2, sel.top + sel.height / 2)?.tagName === 'SELECT'
          : false,
        activeInsideGroup: Boolean(g && a && a.top >= g.top - 0.5 && a.bottom <= g.bottom + 0.5)
      };
    });

    // The group is capped only while the panel is open, and the stack stays
    // clear of the top-right cluster.
    expect(geometry.capped).toBe(true);
    expect(geometry.stackTop).toBeGreaterThan(geometry.selectBottom);
    expect(geometry.selectCentreIsSelect).toBe(true);
    // And the row the card opened on is one the user can actually see.
    expect(geometry.activeInsideGroup).toBe(true);
  });
});

/**
 * The other ordering. The test above opens the tools card AFTER the panorama;
 * this one opens it BEFORE, with a measurement readout already in the stack.
 * The cap then engages by RESIZING the group under an open card, which the
 * open-transition effect cannot see — it left the card at scrollTop 0 behind
 * the readout with its rows off screen (critique run 10). The 128px window
 * cannot hold the whole 199px card, and aligning its top then cut off the row
 * that is on — "Gatebilde", whose hint explains the panorama — at 40%; the
 * pressed row is what comes into view now (critique run 11).
 */
test.describe('the tool stack when the panorama opens under an open card', () => {
  test('brings the pressed row into view instead of leaving it behind the readout', async ({
    page,
    gotoApp
  }) => {
    await page.route(PANORAMAS, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'p1',
              geometry: { type: 'Point', coordinates: [10.7522, 59.9139] },
              properties: { id: 'p1' }
            }
          ]
        })
      })
    );
    const loaded = page.waitForResponse(PANORAMAS);
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoApp('#map=15/59.9139/10.7522&streetview=1');
    await waitForMapReady(page);
    await loaded;
    await page.waitForTimeout(400);

    // A finished measurement sits above the card in the stack.
    await openTools(page);
    await page.getByRole('button', { name: 'Mål avstand', exact: true }).click();
    // Two vertices at the same centre: the readout only has to exist to fill
    // the capped group. Panning with the arrows would move the map away from
    // the panorama point, and Enter then finds nothing near the crosshair.
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Måling' })).toBeVisible({ timeout: 10_000 });

    // The card is opened BEFORE the panorama.
    await openTools(page);
    await mapContainer(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Lukk gatebilde' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600); // lift, cap and re-scroll settle

    const geometry = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>('.map-tools-scroll');
      const card = document.querySelector<HTMLElement>('[role="group"][aria-label="Verktøy"]');
      const rows = card ? Array.from(card.querySelectorAll('li')) : [];
      const g = group?.getBoundingClientRect();
      const pressed = rows.find((r) => r.querySelector('[aria-pressed="true"]'));
      const b = pressed?.getBoundingClientRect();
      return {
        capped: group ? getComputedStyle(group).maxHeight !== 'none' : false,
        scrolledPastReadout: group ? group.scrollTop > 40 : false,
        pressedName: pressed?.querySelector('button')?.textContent?.trim() ?? null,
        pressedHasHint: Boolean(pressed?.querySelector('p')),
        pressedWhole: Boolean(g && b && b.top >= g.top - 0.5 && b.bottom <= g.bottom + 0.5)
      };
    });

    expect(geometry.capped).toBe(true);
    // The group scrolled past the readout rather than resting on it.
    expect(geometry.scrolledPastReadout).toBe(true);
    // And the row that is on — hint and all — is whole in the window.
    expect(geometry.pressedName).toBe('Gatebilde');
    expect(geometry.pressedHasHint).toBe(true);
    expect(geometry.pressedWhole).toBe(true);
  });
});
