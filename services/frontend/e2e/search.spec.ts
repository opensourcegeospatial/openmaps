import { test, expect } from './fixtures/test';
import { waitForMapReady, mapContainer } from './helpers/map';

test.describe('search', () => {
  test('typing a query shows mocked Nominatim results', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);

    const input = page.getByPlaceholder('Søk etter sted eller adresse…');
    await input.fill('Oslo');

    // Results are rendered as buttons inside a <li> list, keyed by display_name.
    // SearchField debounces at 300ms.
    await expect(page.getByRole('option', { name: /^Oslo, Norge/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('option', { name: /^Oslo Sentralstasjon, Oslo, Norge/ })).toBeVisible();
  });

  test('selecting a result updates the map and opens the details sidebar', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    const input = page.getByPlaceholder('Søk etter sted eller adresse…');
    await input.fill('Oslo');

    const firstResult = page.getByRole('option', { name: /^Oslo, Norge/ });
    await expect(firstResult).toBeVisible({ timeout: 10_000 });
    await firstResult.click();

    // Selecting a feature opens the details sidebar with the heading "Detaljer".
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible();
    // The selected feature's display_name is shown in the sidebar.
    await expect(
      page.getByRole('heading', { name: 'Oslo', exact: true })
    ).toBeVisible();

    // At rest the field reads the place as people say it; the long name is its
    // tooltip, and comes back on focus to be edited.
    await expect(input).toHaveValue('Oslo');
    await expect(input).toHaveAttribute('title', 'Oslo, Norge');
    await input.focus();
    await expect(input).toHaveValue('Oslo, Norge');

    // A blue selected-feature marker (circleMarker) is rendered on the map.
    await expect(page.locator('.leaflet-overlay-pane path').first()).toBeVisible();
  });
});

test.describe('search result hover', () => {
  test('hovering a result highlights it without moving the map', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);

    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    const first = page.getByRole('option', { name: /^Oslo, Norge/ });
    await expect(first).toBeVisible({ timeout: 10_000 });

    await first.hover();
    // The hash writer runs 400 ms after a moveend; give it time to (not) fire.
    await page.waitForTimeout(800);
    // A jump would have written #map=18/... (jumpToFeature zooms to 18).
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).not.toMatch(/^#map=18\//);
    // The hover highlight is drawn on the map.
    await expect(page.locator('.leaflet-overlay-pane path').first()).toBeVisible();
  });
});

test.describe('search in context', () => {
  test('the geocode request carries the current map view as a viewbox', async ({ page, gotoApp }) => {
    await gotoApp('#map=14/59.91/10.75');
    await waitForMapReady(page);

    const request = page.waitForRequest((req) => /\/api\/search\?/.test(req.url()));
    // Also wait for the mocked answer: ending the test with the request still in
    // flight lets page teardown race Vite's dev proxy, which logs a spurious error.
    const response = page.waitForResponse((res) => /\/api\/search\?/.test(res.url()));
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Storgata');
    await response;

    const url = new URL((await request).url());
    expect(url.searchParams.get('q')).toBe('Storgata');
    // A zoom-14 view centred on Oslo: west,south,east,north all near 10.7x / 59.9x.
    expect(url.searchParams.get('viewbox')).toMatch(/^10\.\d+,59\.\d+,10\.\d+,59\.\d+$/);
  });
});

test.describe('recent searches and Mine steder', () => {
  test('a selected result reappears under "Nylige søk", can be starred, and survives a reload', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    const input = page.getByPlaceholder('Søk etter sted eller adresse…');
    await input.fill('Oslo');
    const firstResult = page.getByRole('option', { name: /^Oslo, Norge/ });
    await expect(firstResult).toBeVisible({ timeout: 10_000 });
    await firstResult.click();
    await expect(page.getByRole('heading', { name: 'Oslo', exact: true })).toBeVisible();

    // Star it from the details sidebar.
    await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();
    await expect(page.getByRole('button', { name: 'Fjern fra Mine steder' })).toBeVisible();

    // Clear the field and focus it: both lists show the place.
    await page.getByRole('button', { name: 'Tøm søkefeltet' }).click();
    await input.focus();
    await expect(page.getByRole('group', { name: 'Mine steder' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Nylige søk' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Gå til Oslo, Norge' })).toHaveCount(2);

    // Both lists live in localStorage, so they survive a reload.
    await page.reload();
    await waitForMapReady(page);
    await input.focus();
    await expect(page.getByRole('group', { name: 'Mine steder' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Nylige søk' })).toBeVisible();

    // Picking a saved place opens its details again.
    await page.getByRole('option', { name: 'Gå til Oslo, Norge' }).first().click();
    await expect(page.getByRole('heading', { name: 'Oslo', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fjern fra Mine steder' })).toBeVisible();
  });

  // Mine steder lives only in this browser; a mis-pressed star was the last
  // one-click removal without Angre (critique run 11).
  test('removing a saved place can be taken back where Mine steder is listed', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    const input = page.getByPlaceholder('Søk etter sted eller adresse…');
    await input.fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();
    await page.getByRole('button', { name: 'Fjern fra Mine steder' }).click();
    await expect(page.getByRole('button', { name: 'Lagre i Mine steder' })).toBeVisible();

    // At the foot of the field Mine steder belongs to, named the way people
    // say it, so the Angre is clear even after another card opened.
    const notice = page.locator('[data-undo-notice="saved-place"]');
    await expect(notice).toContainText('«Oslo» er fjernet fra Mine steder');
    // By keyboard: focus returns to the star, not to the top of the page (critique run 12).
    await notice.getByRole('button', { name: 'Angre' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Fjern fra Mine steder' })).toBeFocused();

    // Back in storage, not just on screen.
    await page.reload();
    await waitForMapReady(page);
    await input.focus();
    await expect(page.getByRole('group', { name: 'Mine steder' })).toBeVisible();
  });

  test('a plain map click opens the details but is not remembered as a recent search', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    // A map click reverse-geocodes (mocked) and opens the details sidebar…
    await mapContainer(page).click({ position: { x: 640, y: 360 } });
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible({ timeout: 10_000 });

    // …but the empty search field lists no recent searches afterwards.
    await page.getByRole('button', { name: 'Lukk detaljer' }).click();
    await page.getByPlaceholder('Søk etter sted eller adresse…').focus();
    await expect(page.getByRole('group', { name: 'Nylige søk' })).toHaveCount(0);
  });
});

test.describe('search announcements', () => {
  test('the number of places found is announced', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await expect(page.getByRole('option', { name: /^Oslo, Norge/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('status').filter({ hasText: /^\d+ treff$/ })).toHaveCount(1);
  });
});

test.describe('search recovery', () => {
  test('Enter picks the first place found', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    const input = page.getByPlaceholder('Søk etter sted eller adresse…');
    await input.fill('Oslo');
    await expect(page.getByRole('option', { name: /^Oslo, Norge/ })).toBeVisible({ timeout: 10_000 });
    await input.press('Enter');
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible();
  });

  test('a failed search offers Prøv igjen, which searches the same text again', async ({ page, gotoApp }) => {
    let fail = true;
    await page.route(/\/api\/search(\?.*)?$/, (route) =>
      fail ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : route.fallback()
    );
    await gotoApp();
    await waitForMapReady(page);

    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    const alert = page.getByRole('alert').filter({ hasText: 'Søket kunne ikke utføres.' });
    await expect(alert).toBeVisible({ timeout: 10_000 });

    fail = false;
    await alert.getByRole('button', { name: 'Prøv igjen' }).click();
    await expect(page.getByRole('option', { name: /^Oslo, Norge/ })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('search modes', () => {
  test('both modes are visible as one radio group, and the arrow keys switch between them', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    const group = page.getByRole('radiogroup', { name: 'Søkemodus' });
    const places = group.getByRole('radio', { name: 'Steder' });
    const area = group.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' });
    await expect(places).toHaveAttribute('aria-checked', 'true');
    await expect(area).toHaveAttribute('aria-checked', 'false');

    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await places.focus();
    await page.keyboard.press('ArrowRight');
    await expect(area).toBeFocused();
    await expect(area).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByPlaceholder('F.eks. apotek eller lekeplasser')).toBeVisible();
    // A mode switch starts with an empty field, so text never runs together.
    await expect(page.getByPlaceholder('F.eks. apotek eller lekeplasser')).toHaveValue('');

    await places.click();
    await expect(page.getByPlaceholder('Søk etter sted eller adresse…')).toBeFocused();
  });
});

test.describe('search keyboard model', () => {
  test('the arrow keys move through the places found and Enter picks the highlighted one', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    const input = page.getByPlaceholder('Søk etter sted eller adresse…');
    await input.fill('Oslo');
    const options = page.getByRole('listbox').getByRole('option');
    await expect(options.first()).toBeVisible({ timeout: 10_000 });
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-expanded', 'true');

    await input.press('ArrowDown');
    await input.press('ArrowDown');
    const second = options.nth(1);
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(input).toHaveAttribute('aria-activedescendant', (await second.getAttribute('id')) ?? '');
    await input.press('Enter');
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible();
    // The field reads the picked place by its short name; the long name is its tooltip.
    await expect(input).toHaveValue('Oslo S');
    await expect(input).toHaveAttribute('title', /Sentralstasjon/);
  });
});

test.describe('a rich place card on a laptop-height screen', () => {
  const RICH_PLACE = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10.7505, 59.9133] },
    properties: {
      osm_id: 2001,
      place_id: 2001,
      display_name: 'Kaffebrenneriet Storgata, 12, Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge',
      name: 'Kaffebrenneriet Storgata',
      type: 'cafe',
      category: 'amenity',
      address: { road: 'Storgata', house_number: '12', postcode: '0184', city: 'Oslo' },
      extratags: {
        website: 'https://www.kaffebrenneriet.no/butikker/oslo/storgata-12',
        opening_hours: 'Mo-Fr 07:00-18:00; Sa 09:00-17:00; Su off',
        phone: '+47 22 00 00 00',
        wheelchair: 'limited',
        cuisine: 'coffee_shop',
        toilets: 'no',
        'survey:source': 'mapillary'
      }
    }
  };

  test('keeps its directions in view and shows that more lies below', async ({ page, gotoApp }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route(/\/api\/search(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ type: 'FeatureCollection', features: [RICH_PLACE] })
      })
    );
    await gotoApp();
    await waitForMapReady(page);
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Kaffebrenneriet');
    await page.getByRole('option', { name: /^Kaffebrenneriet Storgata/ }).click();

    const card = page.getByRole('region', { name: 'Detaljer' });
    await expect(card).toBeVisible();
    // What it is follows the name; nothing labels it from above.
    await expect(card.getByText('Kafé', { exact: true })).toBeVisible();
    const panel = page.locator('aside', { has: card });
    const hit = await card.getByRole('button', { name: 'Veibeskrivelse hit' }).boundingBox();
    const box = await panel.boundingBox();
    expect(hit!.y + hit!.height).toBeLessThanOrEqual(box!.y + box!.height);

    const edge = panel.locator('[data-scroll-edge]');
    await expect(edge).toHaveCount(1);

    // Scrolled past its own header, the card keeps its name and its exit.
    await panel.evaluate((el) => el.scrollTo(0, 300));
    const bar = panel.locator('[data-panel-bar]');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Kaffebrenneriet Storgata');
    await expect(bar.getByRole('button', { name: 'Lukk detaljer' })).toBeVisible();

    await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(edge).toHaveCount(0);
  });
});

/**
 * PRODUCT.md's primary user opens this map a few times a year and remembers
 * nothing. One line on the default screen teaches what the map itself answers,
 * and it steps aside the moment there is something else to read.
 */
test.describe('the map hint', () => {
  test('teaches what the map answers, and steps aside once something is on screen', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    const hint = page.getByText('Klikk i kartet for å se stedet eller adressen der.');
    await expect(hint).toBeVisible();
    // The line pointing at the tools in the corners is gone (2026-09-23).
    await expect(page.getByText(/nederst til høyre/)).toHaveCount(0);

    const input = page.getByPlaceholder('Søk etter sted eller adresse…');
    await input.fill('Oslo');
    const first = page.getByRole('option', { name: /^Oslo, Norge/ });
    await expect(first).toBeVisible({ timeout: 10_000 });
    await expect(hint).toHaveCount(0);

    await first.click();
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible();
    await expect(hint).toHaveCount(0);

    // With the answer closed, the field cleared and its lists put away — the
    // cleared field is focused, and recent searches are also something to
    // read — the screen is empty again and the hint comes back.
    await page.getByRole('button', { name: 'Lukk detaljer' }).first().click();
    await page.getByRole('button', { name: 'Tøm søkefeltet' }).click();
    // Escape has to reach the field itself: clearing leaves focus on the
    // clear button, and the recent searches are still a list to read.
    await input.click();
    await page.keyboard.press('Escape');
    await expect(hint).toBeVisible();
  });
});
