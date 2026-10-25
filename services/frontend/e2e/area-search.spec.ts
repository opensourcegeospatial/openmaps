import { test, expect } from './fixtures/test';
import { mapContainer, waitForMapReady } from './helpers/map';

/**
 * "Hva finnes i kartutsnittet?" can take up to a minute. When nothing comes back the card
 * must say so, not return to its idle hint as if nothing had happened.
 */
test.describe('area search', () => {
  test('a search with no hits says so, with a next step', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);

    await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
    const input = page.getByPlaceholder('F.eks. apotek eller lekeplasser');
    await expect(input).toBeVisible();
    // The idle hint no longer hedges about English next to a Norwegian example.
    await expect(page.getByText('prøv på engelsk')).toHaveCount(0);

    await input.fill('apotek');
    await page.getByRole('button', { name: 'Søk', exact: true }).click();

    // The shared mock answers with an empty collection.
    const empty = page.getByRole('status').filter({ hasText: 'Ingen treff for «apotek» i kartutsnittet' });
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toContainText('prøv et annet ord');
    // The mock does not name its engine, so nobody is told to switch language.
    await expect(empty).not.toContainText('engelsk');
    await expect(page.getByRole('heading', { name: /treff$/ })).toHaveCount(0);

    // Typing again clears the verdict.
    await input.fill('apotek i nærheten');
    await expect(empty).toHaveCount(0);
  });
});

async function searchArea(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
  await page.getByPlaceholder('F.eks. apotek eller lekeplasser').fill(text);
  await page.getByRole('button', { name: 'Søk', exact: true }).click();
}

test.describe('area search results', () => {
  test('the header restates the question and names how it was read', async ({ page, gotoApp }) => {
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          generator: 'keyword',
          query: '[out:json];node["amenity"="pharmacy"](59.9,10.7,59.95,10.8);out center;',
          features: [
            { type: 'Feature', geometry: { type: 'Point', coordinates: [10.749, 59.9127] }, properties: { name: 'Vitusapotek Jernbanetorget', amenity: 'pharmacy', 'addr:street': 'Jernbanetorget', 'addr:housenumber': '4' } },
            { type: 'Feature', geometry: { type: 'Point', coordinates: [10.74, 59.9135] }, properties: { name: 'Apotek 1 Karl Johan', amenity: 'pharmacy' } }
          ]
        })
      })
    );
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    await expect(page.getByRole('heading', { name: '2 treff for «apotek»' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Søkt på ordene du skrev')).toBeVisible();
    // With an answer on screen, the idle hint steps aside.
    await expect(page.getByText('Beskriv hva du leter etter')).toHaveCount(0);
    // The query that ran is there for whoever wants to check or reuse it.
    await page.getByText('Vis spørringen').click();
    await expect(page.getByText('node["amenity"="pharmacy"]', { exact: false })).toBeVisible();

    // Numbered on the map as in the list; a hovered row lifts its dot and names it.
    await expect(page.locator('.overpass-hit')).toHaveText(['1', '2']);
    const row1 = page.getByRole('button', { name: /^Treff 1,/ });
    await row1.hover();
    await expect(page.locator('.overpass-hit.is-active')).toHaveText('1');
    await expect(page.locator('.leaflet-tooltip.overpass-tooltip')).toHaveText('Vitusapotek Jernbanetorget');

    // A hit opens the same card as a searched place, above the list, which stays.
    await row1.click();
    const card = page.getByRole('region', { name: 'Detaljer' });
    await expect(card.getByRole('heading', { name: 'Vitusapotek Jernbanetorget' })).toBeFocused();
    await expect(card.getByText('Apotek', { exact: true })).toBeVisible();
    // Sharing the rail with the list it came from, the card keeps what names
    // the place and what can be done with it, and folds the facts one click
    // away, so the hits above stay comparable (decided 2026-09-18).
    await expect(card.getByText('Jernbanetorget 4')).toHaveCount(0);
    await card.getByRole('button', { name: 'Vis detaljer' }).click();
    await expect(card.getByText('Jernbanetorget 4')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Veibeskrivelse hit' })).toBeEnabled();
    await expect(card.getByRole('button', { name: 'Lagre i Mine steder' })).toBeVisible();
    await expect(row1).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.overpass-hit.is-selected')).toHaveText('1');
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
    const cardTop = (await card.boundingBox())?.y ?? 0;
    const listTop = (await page.getByRole('heading', { name: '2 treff for «apotek»' }).boundingBox())?.y ?? 0;
    expect(cardTop).toBeLessThan(listTop);

    // A dot on the map opens its hit too.
    await page.locator('.overpass-hit', { hasText: /^2$/ }).dispatchEvent('click');
    await expect(card.getByRole('heading', { name: 'Apotek 1 Karl Johan' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Treff 2,/ })).toHaveAttribute('aria-current', 'true');
    // The facts left unfolded on the last hit do not stay unfolded on this
    // one, so the list's height never depends on which row was opened last.
    // (This hit carries no facts at all, so it has nothing to fold either.)
    await expect(card.getByRole('button', { name: 'Skjul detaljer' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Vis detaljer' })).toHaveCount(0);

    // Escape closes the card and hands focus back to the hit's row; the list stays.
    await card.getByRole('button', { name: 'Lukk detaljer' }).focus();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Treff 2,/ })).toBeFocused();
    await expect(page.locator('.overpass-hit.is-selected')).toHaveCount(0);
  });

  test('with the local model, a search with no hits suggests English', async ({ page, gotoApp }) => {
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ type: 'FeatureCollection', generator: 'byt5', features: [] })
      })
    );
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    const empty = page.getByRole('status').filter({ hasText: 'Ingen treff for «apotek» i kartutsnittet' });
    await expect(empty).toContainText('skriv det på engelsk', { timeout: 15_000 });
  });
});

const HIT_NAMES = ['Majorstuen', 'Grünerløkka', 'Storo', 'Bislett', 'Tøyen', 'Vika', 'Aker brygge', 'Frogner', 'Sagene', 'Ullevål', 'Nydalen', 'Skøyen', 'Helsfyr', 'Bryn'];
const MANY_HITS = {
  type: 'FeatureCollection',
  generator: 'byt5',
  query: '[out:json][timeout:25];nwr["amenity"="pharmacy"](59.89,10.70,59.94,10.80);out center;',
  features: HIT_NAMES.map((n, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10.715 + (i % 5) * 0.012, 59.905 + Math.floor(i / 5) * 0.007] },
    properties: {
      name: i === 1 ? 'Vitusapotek Jernbanetorget – Oslo City kjøpesenter, 2. etasje ved hovedinngangen' : `Apotek 1 ${n}`,
      amenity: 'pharmacy',
      'addr:street': 'Storgata',
      'addr:housenumber': String(10 + i),
      'addr:city': 'Oslo',
      opening_hours: 'Mo-Fr 09:00-20:00; Sa 10:00-18:00',
      dispensing: 'yes',
      'contact:website': 'https://www.apotek1.no'
    }
  }))
};

/** Whether `inner` lies within `outer`'s box, i.e. is not scrolled or clipped out of it. */
async function insideOf(
  inner: import('@playwright/test').Locator,
  outer: import('@playwright/test').Locator
): Promise<boolean> {
  const a = await inner.boundingBox();
  const b = await outer.boundingBox();
  return Boolean(a && b && a.y >= b.y - 1 && a.y + a.height <= b.y + b.height + 1);
}

/**
 * On a laptop-height screen the rail cannot show a long results list and a
 * whole card. The open panel leads; the list yields down to its header and
 * the current row.
 */
test.describe('area search on a laptop-height screen', () => {
  // Registered in each test, before gotoApp, so it wins over the shared mocks.
  async function mockManyHits(page: import('@playwright/test').Page): Promise<void> {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANY_HITS) })
    );
  }

  test("an open hit's card keeps its directions in view, and the list keeps the hit's row", async ({
    page,
    gotoApp
  }) => {
    await mockManyHits(page);
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    const heading = page.getByRole('heading', { name: '14 treff for «apotek»' });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    const row = page.getByRole('button', { name: /^Treff 2,/ });
    await row.click();
    const card = page.getByRole('region', { name: 'Detaljer' });
    await expect(card.getByRole('heading', { level: 2 })).toBeFocused();
    const panel = page.locator('aside', { has: card });
    const results = page.locator('aside', { has: heading });

    expect(await insideOf(card.getByRole('button', { name: 'Veibeskrivelse hit' }), panel)).toBe(true);
    expect(await insideOf(row, page.getByRole('list').filter({ has: row }))).toBe(true);

    // Folded, the whole card is reachable without scrolling it: its name, its
    // directions and the way to the facts are all in view at once.
    expect(await panel.evaluate((el: HTMLElement) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);

    // And the list is still a list: room for more than two rows, so the hits
    // can be compared rather than stepped through one at a time.
    const list = page.getByRole('list').filter({ has: row });
    const listBox = await list.boundingBox();
    const rowBox = await row.boundingBox();
    const resultsBox = await results.boundingBox();
    expect(resultsBox!.height).toBeGreaterThanOrEqual(280);
    // More than two rows, against the single row this list collapsed to before
    // the card learned to fold (critique run 8). This fixture's header also
    // carries "Vis spørringen", so it is the densest header the list has.
    expect(listBox!.height / rowBox!.height).toBeGreaterThan(2);

    // Unfolded, the card takes the room it needs and a band at its foot says
    // more lies below, until the end.
    await card.getByRole('button', { name: 'Vis detaljer' }).click();
    const edge = panel.locator('[data-scroll-edge]');
    await expect(edge).toHaveCount(1);
    await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(edge).toHaveCount(0);
  });

  // The route panel takes the Veibeskrivelse button's place, above the list.
  // It once sat below the list through CSS `order` while coming first in the
  // DOM, so Tab ran down to it and back up to the list, against what is seen
  // (critique run 13): what is read first must be what is seen first.
  test('the route panel above the results keeps its fields in view, in the order seen', async ({ page, gotoApp }) => {
    await mockManyHits(page);
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    const heading = page.getByRole('heading', { name: '14 treff for «apotek»' });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Veibeskrivelse', exact: true }).click();
    const routeHeading = page.getByRole('heading', { name: 'Veibeskrivelse' });
    const panel = page.locator('aside', { has: routeHeading });
    expect(await insideOf(page.getByRole('combobox', { name: 'Destinasjon' }), panel)).toBe(true);
    expect(await insideOf(page.getByRole('button', { name: 'Sykle' }), panel)).toBe(true);
    await expect(heading).toBeVisible();

    // Seen first and read first: the panel is above the list on screen and
    // before it in the document.
    const panelBox = (await panel.boundingBox())!;
    const listBox = (await page.locator('aside', { has: heading }).boundingBox())!;
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(listBox.y);
    const panelFirstInDom = await routeHeading.evaluate(
      (route, list) => Boolean(route.compareDocumentPosition(list as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
      await heading.elementHandle()
    );
    expect(panelFirstInDom).toBe(true);
  });

  /**
   * An area search can cost a minute of model inference. Asking what one point
   * on the map is must not throw that answer away: the card docks above the
   * list exactly as a hit's card does, and the list survives untouched. Only a
   * pick in the search field replaces it (critique run 9).
   */
  test('a map click answers without destroying the area-search answer', async ({ page, gotoApp }) => {
    await mockManyHits(page);
    await page.route(/\/api\/reverse(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [10.75, 59.91] },
              properties: {
                display_name: 'Kaffebrenneriet, 12, Storgata, Sentrum, Oslo, 0184, Norge',
                name: 'Kaffebrenneriet',
                address: { road: 'Storgata', house_number: '12', postcode: '0184', city: 'Oslo' }
              }
            }
          ]
        })
      })
    );
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    const heading = page.getByRole('heading', { name: '14 treff for «apotek»' });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    const rows = page.getByRole('button', { name: /^Treff \d+,/ });
    await expect(rows).toHaveCount(14);

    await mapContainer(page).click({ position: { x: 900, y: 600 } });
    const card = page.getByRole('region', { name: 'Detaljer' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole('heading', { name: 'Kaffebrenneriet' })).toBeVisible();

    // The answer is still there, whole.
    await expect(heading).toBeVisible();
    await expect(rows).toHaveCount(14);

    // The card docks above the list, as a hit's card does...
    const cardTop = (await card.boundingBox())?.y ?? 0;
    const listTop = (await heading.boundingBox())?.y ?? 0;
    expect(cardTop).toBeLessThan(listTop);
    // ...and folds its facts, so the rows stay comparable.
    await expect(card.getByRole('button', { name: 'Vis detaljer' })).toBeVisible();

    // Closing it leaves the answer untouched.
    await page.getByRole('button', { name: 'Lukk detaljer' }).first().click();
    await expect(card).toHaveCount(0);
    await expect(rows).toHaveCount(14);
  });
});

/**
 * Unfolding a compact card's facts is a request to read them, so the rail's
 * priority inverts: the card takes the room and the list drops to its header
 * and a row, keeping the open hit in view. Before this the card grew by 3px
 * and left 371px of facts hidden behind a scroll (critique run 10).
 */
test.describe('reading the facts on a hit card', () => {
  test('the card takes the room, the list keeps the open hit, and folding gives it back', async ({
    page,
    gotoApp
  }) => {
    // Own setup: mockManyHits is private to the laptop-height describe above.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANY_HITS) })
    );
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    await expect(page.getByRole('heading', { name: '14 treff for «apotek»' })).toBeVisible({
      timeout: 15_000
    });

    const row = page.getByRole('button', { name: /^Treff 2,/ });
    await row.click();
    const card = page.getByRole('region', { name: 'Detaljer' });
    const panel = page.locator('aside', { has: card });
    const foldedHeight = (await panel.boundingBox())!.height;

    await card.getByRole('button', { name: 'Vis detaljer' }).click();
    await page.waitForTimeout(450); // the floor change and the scroll settle

    // The card grew, and the facts it promised are actually on screen.
    const openHeight = (await panel.boundingBox())!.height;
    expect(openHeight).toBeGreaterThan(foldedHeight + 100);
    expect(await insideOf(card.getByText('Adresse'), panel)).toBe(true);

    // The list yielded, but kept the hit being read about.
    const list = page.getByRole('list').filter({ has: row });
    expect(await insideOf(row, list)).toBe(true);
    await expect(row).toHaveAttribute('aria-current', 'true');

    // Folding hands the room straight back.
    await card.getByRole('button', { name: 'Skjul detaljer' }).click();
    await page.waitForTimeout(350);
    expect((await panel.boundingBox())!.height).toBeCloseTo(foldedHeight, -1);
  });
});

/**
 * An area answer can cost a minute of model inference, so closing it is
 * undoable like every other destructive one-click in the product — the route,
 * recent searches and avoid areas all offer "Angre" (critique run 10).
 */
test.describe('closing the area results', () => {
  test('offers Angre, and Angre brings the answer back', async ({ page, gotoApp }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANY_HITS) })
    );
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    const heading = page.getByRole('heading', { name: '14 treff for «apotek»' });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    const rows = page.getByRole('button', { name: /^Treff \d+,/ });
    await expect(rows).toHaveCount(14);

    await page.getByRole('button', { name: 'Lukk resultatliste' }).click();
    await expect(heading).toHaveCount(0);
    await expect(rows).toHaveCount(0);

    // The toast names the question it discarded, and offers it back.
    const toast = page.getByText('Treffene for «apotek» er fjernet');
    await expect(toast).toBeVisible();
    await page.getByRole('button', { name: 'Angre' }).click();

    await expect(heading).toBeVisible();
    await expect(rows).toHaveCount(14);
  });
});

/**
 * One hit is the commonest shape of an everyday question ("nearest
 * legevakt"), and beside another panel it once showed 23px of its only row,
 * the name hidden under the list's own header: a full header (119px) and a
 * row (71px) cannot share the 9rem the list is left. Any panel sharing the
 * rail now folds the header, whatever the number of hits (critique run 11).
 */
test.describe('a one-hit answer beside another panel', () => {
  const ONE_HIT = { ...MANY_HITS, features: MANY_HITS.features.slice(0, 1) };

  async function expectRowWhole(page: import('@playwright/test').Page): Promise<void> {
    const heading = page.getByRole('heading', { name: '1 treff for «apotek»' });
    const results = page.locator('aside', { has: heading });
    const row = page.getByRole('button', { name: /^Treff 1,/ });
    await expect(async () => {
      const r = await row.boundingBox();
      const h = await results.locator('header').boundingBox();
      const a = await results.boundingBox();
      // The whole row, below the pinned header and inside the list.
      expect(r!.y).toBeGreaterThanOrEqual(h!.y + h!.height - 1);
      expect(r!.y + r!.height).toBeLessThanOrEqual(a!.y + a!.height + 1);
    }).toPass();
    await expect(results.getByText('Tolket av innebygd modell (best på engelsk)')).toHaveCount(0);
  }

  test("under the hit's own card", async ({ page, gotoApp }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ONE_HIT) })
    );
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    await page.getByRole('button', { name: /^Treff 1,/ }).click();
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible();
    await expectRowWhole(page);
  });

  test('under a computed route', async ({ page, gotoApp }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ONE_HIT) })
    );
    await gotoApp();
    await waitForMapReady(page);
    await mapContainer(page).click({ button: 'right', position: { x: 400, y: 300 } });
    await page.getByRole('menuitem', { name: 'Veibeskrivelse herfra' }).click();
    await mapContainer(page).click({ button: 'right', position: { x: 600, y: 200 } });
    await page.getByRole('menuitem', { name: 'Veibeskrivelse hit' }).click();
    await expect(page.getByText('Avstand', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await searchArea(page, 'apotek');
    await expect(page.getByRole('heading', { name: '1 treff for «apotek»' })).toBeVisible({ timeout: 15_000 });
    await expectRowWhole(page);
  });
});

/**
 * The header restates a question that is still in the search field, so it
 * never needs to be whole: a 150-character question once made it 310px, half
 * the rail (critique run 11). Two lines at most, the rest in a tooltip.
 */
test.describe('a long question in the results header', () => {
  test('holds to two lines and carries the rest in a tooltip', async ({ page, gotoApp }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MANY_HITS, features: MANY_HITS.features.slice(0, 3) })
      })
    );
    await gotoApp();
    await waitForMapReady(page);
    const question =
      'alle apotek og legevakter og tannleger og fysioterapeuter i nærheten av hovedkontoret vårt i sentrum som har åpent etter klokka atten på hverdager';
    await searchArea(page, question);
    const heading = page.getByRole('heading', { name: /^3 treff for/ });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      const lines = await heading.evaluate(
        (el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)
      );
      expect(Math.round(lines)).toBe(2);
    }).toPass();
    await expect(heading).toHaveAttribute('title', `3 treff for «${question}»`);
  });
});

/**
 * An area answer can take a minute to compute. Clearing the field or
 * switching the search mode asks nothing new, so the answer stays; an arrow
 * key in the mode radios used to throw it away with no way back. The area
 * question comes back with its mode (critique run 12).
 */
test.describe('the area answer outlives the search field', () => {
  test('through a mode switch, an arrow key and a cleared field', async ({ page, gotoApp }) => {
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANY_HITS) })
    );
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    const heading = page.getByRole('heading', { name: '14 treff for «apotek»' });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    const rows = page.locator('[data-overpass-row]');

    await page.getByRole('radio', { name: 'Steder' }).click();
    await expect(rows).toHaveCount(14);
    await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
    await expect(page.getByPlaceholder('F.eks. apotek eller lekeplasser')).toHaveValue('apotek');

    await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('radio', { name: 'Steder' })).toBeChecked();
    await expect(rows).toHaveCount(14);

    await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
    await page.getByRole('button', { name: 'Tøm søkefeltet' }).click();
    await expect(rows).toHaveCount(14);
    await expect(heading).toBeVisible();
  });

  // Finding the hits and then checking one against an address is the whole
  // loop, and looking the address up was the last path that threw the answer
  // away — silently, with no Angre to bring it back (critique run 15).
  test('through a place looked up in the search field', async ({ page, gotoApp }) => {
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANY_HITS) })
    );
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    const heading = page.getByRole('heading', { name: '14 treff for «apotek»' });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    await page.getByRole('radio', { name: 'Steder' }).click();
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();

    // The card for the place opens above the answer, which is still there.
    const card = page.getByRole('region', { name: 'Detaljer' });
    await expect(card).toBeVisible();
    await expect(heading).toBeVisible();
    await expect(page.locator('[data-overpass-row]')).toHaveCount(14);
    const cardBox = (await card.boundingBox())!;
    const listBox = (await heading.boundingBox())!;
    expect(cardBox.y).toBeLessThan(listBox.y);
  });

  test('a newer answer retires the older Angre, and Angre lands on what came back', async ({ page, gotoApp }) => {
    let body: unknown = MANY_HITS;
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    );
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    await expect(page.getByRole('heading', { name: '14 treff for «apotek»' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Lukk resultatliste' }).click();
    const undo = page.locator('[data-undo-notice="area-results"]');
    await expect(undo).toContainText('Treffene for «apotek» er fjernet');
    await undo.getByRole('button', { name: 'Angre' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /^Treff 1,/ })).toBeFocused();

    await page.getByRole('button', { name: 'Lukk resultatliste' }).click();
    await expect(undo).toBeVisible();
    body = { ...MANY_HITS, features: MANY_HITS.features.slice(0, 3) };
    await page.getByPlaceholder('F.eks. apotek eller lekeplasser').fill('legevakt');
    await page.getByRole('button', { name: 'Søk', exact: true }).click();
    await expect(page.getByRole('heading', { name: '3 treff for «legevakt»' })).toBeVisible({ timeout: 15_000 });
    await expect(undo).toHaveCount(0);
  });

  // A search that can take a minute used to end in silence for a screen
  // reader, with focus dropped on the page by the disabled Søk (critique run 12).
  test('Søk keeps focus while searching, and the answer is announced', async ({ page, gotoApp }) => {
    await page.route(/\/api\/overpass(\?.*)?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANY_HITS) });
    });
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
    await page.getByPlaceholder('F.eks. apotek eller lekeplasser').fill('apotek');
    // One control across the wait: its name says what it is doing.
    const search = page.getByRole('button', { name: /^Søk(er…)?$/ });
    const look = () =>
      search.evaluate((el) => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, color: style.color, opacity: style.opacity };
      });
    await search.focus();
    await page.keyboard.press('Enter');
    await expect(search).toHaveAttribute('aria-disabled', 'true');
    await expect(search).toHaveText('Søker…');
    await expect(search).toBeFocused();
    // The wait has one indicator, on the control that started it.
    await expect(page.locator('[data-rail] .animate-spin')).toHaveCount(1);
    await expect(search.locator('.animate-spin')).toHaveCount(1);
    // Busy is said in words, not by fading: the label keeps its resting
    // contrast for the whole wait. Run 13 dimmed the fill to rescue the focus
    // ring and left the label at 2.23:1 for up to a minute (critique run 16).
    // Read once the button's own transition has settled, still busy.
    await page.waitForTimeout(400);
    await expect(search).toHaveAttribute('aria-disabled', 'true');
    const busy = await look();
    await expect(page.getByRole('heading', { name: '14 treff for «apotek»' })).toBeVisible({ timeout: 15_000 });
    await expect(search).toHaveText('Søk');
    await expect(search).toBeFocused();
    await page.waitForTimeout(400);
    expect(busy).toEqual(await look());
    await expect(page.locator('[role="status"].sr-only').filter({ hasText: '14 treff for «apotek»' })).toHaveCount(1);
  });
});

/**
 * The open hit's row tint alone is 1.18:1; its numeral is ringed the way its
 * dot on the map is (critique run 12).
 */
test.describe('the open hit in the list', () => {
  test("has its numeral ringed, and no other row's is", async ({ page, gotoApp }) => {
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANY_HITS) })
    );
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    await page.getByRole('button', { name: /^Treff 2,/ }).click();
    const ringed = await page.locator('[data-overpass-row]').evaluateAll((rows) =>
      rows.map((row) => {
        const badge = row.querySelector('span[aria-hidden="true"]') as HTMLElement;
        return /0px 0px 0px 4px/.test(getComputedStyle(badge).boxShadow);
      })
    );
    expect(ringed[1]).toBe(true);
    expect(ringed.filter(Boolean)).toHaveLength(1);
  });
});

/**
 * The area field asks again the question its answer on screen answers, not
 * whatever was typed and never searched, and the idle line ("Beskriv hva du
 * leter etter") stays away while an answer stands (critique run 13).
 */
test.describe('the area field around a kept answer', () => {
  test('restores the question asked, and only while its answer stands', async ({ page, gotoApp }) => {
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANY_HITS) })
    );
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    await expect(page.getByRole('heading', { name: '14 treff for «apotek»' })).toBeVisible({ timeout: 15_000 });
    const field = page.getByPlaceholder('F.eks. apotek eller lekeplasser');
    await field.fill('lekeplass');
    await page.getByRole('radio', { name: 'Steder' }).click();
    await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
    await expect(field).toHaveValue('apotek');
    await expect(page.getByText('Beskriv hva du leter etter')).toHaveCount(0);

    await page.getByRole('button', { name: 'Lukk resultatliste' }).click();
    await page.getByRole('radio', { name: 'Steder' }).click();
    await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
    await expect(field).toHaveValue('');
    await expect(page.getByText('Beskriv hva du leter etter')).toHaveCount(1);
  });
});

/**
 * The route is one settled answer; the list is the comparison being made. On a
 * tall screen every extra pixel used to go to the route panel while the list
 * sat at its floor of two rows of fourteen, and the answer's own fit left the
 * first hits under the rail (critique run 15).
 */
test.describe('the rail beside a computed route', () => {
  async function areaThenRoute(page: import('@playwright/test').Page, height: number): Promise<void> {
    await page.setViewportSize({ width: 1440, height });
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANY_HITS) })
    );
  }

  async function measure(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const rail = document.querySelector('[data-rail]')!.getBoundingClientRect();
      const panel = document.querySelector('aside')!.getBoundingClientRect();
      const row = document.querySelector('[data-overpass-row]')!.getBoundingClientRect();
      const list = document
        .querySelector('[data-overpass-row]')!
        .closest('div[class*="pointer-events-auto"]')!
        .getBoundingClientRect();
      const header = list.height - (list.bottom - row.top);
      return {
        share: +(panel.height / rail.height).toFixed(2),
        rows: +((list.height - header) / row.height).toFixed(2)
      };
    });
  }

  // The cap is for a settled route, not for a card whose facts the user asked
  // to read: capped, an expanded card showed 387px of 577 at 768 where it had
  // 398 before (decided run 10, measured again in polish 15).
  test('the cap stands down while a hit card\'s facts are unfolded', async ({ page, gotoApp }) => {
    await areaThenRoute(page, 768);
    await gotoApp();
    await waitForMapReady(page);
    await searchArea(page, 'apotek');
    await expect(page.getByRole('heading', { name: '14 treff for «apotek»' })).toBeVisible({ timeout: 15_000 });

    const card = page.getByRole('region', { name: 'Detaljer' });
    await page.getByRole('button', { name: /^Treff 2,/ }).click();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Vis detaljer' }).click();
    await page.waitForTimeout(400);

    const share = await page.evaluate(() => {
      const rail = document.querySelector('[data-rail]')!.getBoundingClientRect().height;
      const panel = document.querySelector('aside')!.getBoundingClientRect().height;
      return panel / rail;
    });
    expect(share).toBeGreaterThan(0.55);
  });

  for (const [height, minRows] of [
    [720, 1.9],
    [1080, 4]
  ] as const) {
    test(`at 1440x${height} the route takes at most 55% and the list keeps ${minRows} rows`, async ({
      page,
      gotoApp
    }) => {
      await areaThenRoute(page, height);
      await gotoApp();
      await waitForMapReady(page);
      await searchArea(page, 'apotek');
      await expect(page.getByRole('heading', { name: '14 treff for «apotek»' })).toBeVisible({ timeout: 15_000 });

      // The answer's own fit keeps every numbered hit clear of the rail.
      const underRail = await page.evaluate(() => {
        const rail = document.querySelector('[data-rail]')!.getBoundingClientRect();
        return Array.from(document.querySelectorAll('.overpass-hit')).filter((dot) => {
          const b = dot.getBoundingClientRect();
          return b.left < rail.right && b.right > rail.left && b.top < rail.bottom && b.bottom > rail.top;
        }).length;
      });
      expect(underRail).toBe(0);

      await mapContainer(page).click({ button: 'right', position: { x: 900, y: 300 } });
      await page.getByRole('menuitem', { name: 'Veibeskrivelse herfra' }).click();
      await mapContainer(page).click({ button: 'right', position: { x: 1000, y: 500 } });
      await page.getByRole('menuitem', { name: 'Veibeskrivelse hit' }).click();
      await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(400);

      const { share, rows } = await measure(page);
      expect(share).toBeLessThanOrEqual(0.56);
      expect(rows).toBeGreaterThanOrEqual(minRows);
    });
  }
});

/**
 * Two jobs, two vocabularies: "her" is one point on the map, and the area
 * search says where it looks. Three near-identical names — the mode "Hva
 * finnes her?", the hint "…se hva som er der", and the map menu's "Hva er
 * her?" — sat within 86px of each other for two different jobs (critique
 * run 15).
 */
test('the point and the area job never borrow each other\'s words', async ({ page, gotoApp }) => {
  await gotoApp();
  await waitForMapReady(page);

  // The search card: the area mode names the map extent, and the hint names
  // what a click answers with.
  const card = page.locator('div.shadow-lg').first();
  await expect(card.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' })).toBeVisible();
  await expect(card).toContainText('Klikk i kartet for å se stedet eller adressen der.');
  await expect(card).not.toContainText('hva som er der');
  await expect(card.getByText(/Hva (finnes|er) her/)).toHaveCount(0);

  // "Her" belongs to the one-point question, in the map's own menu.
  await mapContainer(page).click({ button: 'right', position: { x: 500, y: 300 } });
  await expect(page.getByRole('menuitem', { name: 'Hva er her?' })).toBeVisible();

  // And the mode says its scope once: the helper under the field does not
  // repeat it.
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
  const helper = card.getByText('Beskriv hva du leter etter.');
  await expect(helper).toBeVisible();
  await expect(helper).not.toContainText('kartutsnittet');
});
