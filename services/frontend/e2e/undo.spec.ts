import { test, expect, type Page } from './fixtures/test';
import { drawPolygon, mapContainer, openTools, waitForMapReady } from './helpers/map';

/**
 * Destructive one-click actions can be taken back where the thing was.
 */
test.describe('undo', () => {
  test('clearing recent searches can be undone where the list was', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);

    const search = page.getByPlaceholder('Søk etter sted eller adresse…');
    await search.fill('Oslo');
    const firstResult = page.getByRole('option', { name: /^Oslo, Norge/ });
    await expect(firstResult).toBeVisible({ timeout: 10_000 });
    await firstResult.click();

    // The pick is now a recent search, listed while the empty field has focus.
    await page.getByRole('button', { name: 'Tøm søkefeltet' }).click();
    await search.click();
    await expect(page.getByRole('group', { name: 'Nylige søk' })).toBeVisible();

    await page.getByRole('button', { name: 'Tøm nylige søk' }).click();
    await expect(page.getByRole('group', { name: 'Nylige søk' })).toHaveCount(0);

    const undo = page.getByRole('button', { name: 'Angre' });
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(undo).toHaveCount(0);

    await search.click();
    await expect(page.getByRole('group', { name: 'Nylige søk' })).toBeVisible();
  });
});

/**
 * Angre used to leave focus on the page, where Tab starts over at the top:
 * the toast that held focus is gone, and the control pressed before it often
 * went with what it removed. Focus now goes to what came back (critique run 12).
 */
test.describe('focus after Angre', () => {
  async function planRoute(page: Page): Promise<void> {
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Veibeskrivelse herfra' }).click();
    await page.getByPlaceholder('Velg destinasjon…').fill('Sentral');
    await page.getByRole('option', { name: /^Oslo Sentralstasjon, Oslo, Norge/ }).first().click();
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });
  }

  async function angre(page: Page, message: string | RegExp): Promise<void> {
    const notice = page.locator('[data-undo-notice]').filter({ hasText: message });
    await notice.getByRole('button', { name: 'Angre' }).focus();
    await page.keyboard.press('Enter');
  }

  test('a restored route puts focus in its first field', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await planRoute(page);
    await page.getByRole('button', { name: 'Lukk veibeskrivelse' }).first().click();
    await angre(page, 'Ruten er fjernet');
    await expect(page.getByPlaceholder('Velg startpunkt…')).toBeFocused();
  });

  test('restored avoid areas put focus back on "Fjern"', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await planRoute(page);
    await openTools(page);
    await page.getByRole('button', { name: 'Unngå område', exact: true }).click();
    await drawPolygon(page, [
      { x: 360, y: 260 },
      { x: 460, y: 260 },
      { x: 410, y: 360 }
    ]);
    await expect(page.getByText('1 område unngås')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Fjern', exact: true }).click();
    await angre(page, 'Området er fjernet');
    await expect(page.getByRole('button', { name: 'Fjern', exact: true })).toBeFocused();
  });

  test('a saved place restored after its card closed puts focus in the search field', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();
    await page.getByRole('button', { name: 'Fjern fra Mine steder' }).click();
    await page.getByRole('button', { name: 'Lukk detaljer' }).first().click();
    await angre(page, '«Oslo» er fjernet fra Mine steder');
    // The field "Mine steder" belongs to: emptied, it lists the place again.
    const search = page.getByPlaceholder('Søk etter sted eller adresse…');
    await expect(search).toBeFocused();
    await page.getByRole('button', { name: 'Tøm søkefeltet' }).click();
    await search.focus();
    await expect(page.getByRole('group', { name: 'Mine steder' }).getByRole('option', { name: 'Gå til Oslo, Norge' })).toBeVisible();
  });
});

/**
 * One undo model (critique run 13): an undo waits instead of timing out, there
 * is only ever one, it is withdrawn once what it would restore is gone, Escape
 * inside it closes it rather than the panel behind, and focus never falls on
 * the page around it.
 */
test.describe('the undo model', () => {
  async function planRoute(page: Page): Promise<void> {
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Veibeskrivelse herfra' }).click();
    await page.getByPlaceholder('Velg destinasjon…').fill('Sentral');
    await page.getByRole('option', { name: /^Oslo Sentralstasjon, Oslo, Norge/ }).first().click();
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });
  }

  test('one undo at a time; Escape in it closes it and not the card', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    const search = page.getByPlaceholder('Søk etter sted eller adresse…');
    await search.fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();
    await page.getByRole('button', { name: 'Fjern fra Mine steder' }).click();
    await search.fill('Sentral');
    await page.getByRole('option', { name: /^Oslo Sentralstasjon/ }).first().click();
    await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();
    await page.getByRole('button', { name: 'Fjern fra Mine steder' }).click();
    await expect(page.getByRole('button', { name: 'Angre' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Angre' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Angre' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible();
  });

  // Withdrawn once a new route is begun, its first stop set, or it would put
  // the old route back over the new one; merely opening the empty panel to
  // look used to cost the undo too (critique run 14).
  test("a closed route's undo survives opening the panel, and is withdrawn once a stop is set", async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await planRoute(page);
    await page.getByRole('button', { name: 'Lukk veibeskrivelse' }).first().click();
    const undo = page.locator('[data-undo-notice]').filter({ hasText: 'Ruten er fjernet' });
    await expect(undo).toBeVisible();

    await page.getByRole('button', { name: 'Veibeskrivelse', exact: true }).click();
    await expect(page.getByPlaceholder('Velg startpunkt…')).toBeFocused();
    // An undo has no timer, so its still being here is the rule, not luck.
    await expect(undo).toBeVisible();

    await mapContainer(page).click({ button: 'right', position: { x: 400, y: 300 } });
    await page.getByRole('menuitem', { name: 'Veibeskrivelse herfra' }).click();
    // Withdrawn at once, and said so.
    await expect(undo).toHaveCount(0, { timeout: 1000 });
    await expect(page.getByText('Kan ikke lenger angres: Ruten er fjernet')).toHaveCount(1);
  });

  test('cleared avoid areas\' undo is withdrawn once a new area is drawn', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await planRoute(page);
    await openTools(page);
    await page.getByRole('button', { name: 'Unngå område', exact: true }).click();
    await drawPolygon(page, [{ x: 360, y: 260 }, { x: 460, y: 260 }, { x: 410, y: 360 }]);
    await expect(page.getByText('1 område unngås')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Fjern', exact: true }).click();
    const undo = page.locator('[data-undo-notice]').filter({ hasText: 'Området er fjernet' });
    await expect(undo).toBeVisible();
    await openTools(page);
    await page.getByRole('button', { name: 'Unngå område', exact: true }).click();
    await expect(undo).toBeVisible();
    await drawPolygon(page, [{ x: 500, y: 260 }, { x: 600, y: 260 }, { x: 550, y: 360 }]);
    // Withdrawn at once, not left to lapse (see above).
    await expect(undo).toHaveCount(0, { timeout: 1000 });
    await expect(page.getByText('1 område unngås')).toBeVisible({ timeout: 10_000 });
  });

  test('clearing recent searches by keyboard keeps focus in the field, and so does its Angre', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    const search = page.getByPlaceholder('Søk etter sted eller adresse…');
    await search.fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Tøm søkefeltet' }).click();
    await search.focus();
    await page.getByRole('button', { name: 'Tøm nylige søk' }).focus();
    await page.keyboard.press('Enter');
    await expect(search).toBeFocused();
    await page.getByRole('button', { name: 'Angre' }).focus();
    await page.keyboard.press('Enter');
    await expect(search).toBeFocused();
    await expect(page.getByRole('group', { name: 'Nylige søk' })).toBeVisible();
  });

  test("the card's route buttons move focus on to the route", async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Veibeskrivelse herfra' }).focus();
    await page.keyboard.press('Enter');
    // The next stop still to fill.
    await expect(page.getByPlaceholder('Velg destinasjon…')).toBeFocused();

    await mapContainer(page).click({ position: { x: 1000, y: 300 } });
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Viapunkt her' }).focus();
    await page.keyboard.press('Enter');
    // The via row it just added.
    await expect(page.getByPlaceholder('Viapunkt 1…')).toBeFocused();
  });

  test('an undo withdrawn while it holds focus hands focus back', async ({ page, gotoApp }) => {
    let delay = 0;
    await page.route(/\/api\/overpass(\?.*)?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          generator: 'byt5',
          features: Array.from({ length: 4 }, (_, i) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [10.72 + i * 0.01, 59.91] },
            properties: { name: `Apotek ${i + 1}`, amenity: 'pharmacy' }
          }))
        })
      });
    });
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
    const field = page.getByPlaceholder('F.eks. apotek eller lekeplasser');
    await field.fill('apotek');
    await page.getByRole('button', { name: 'Søk', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^4 treff for «apotek»/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Lukk resultatliste' }).click();
    delay = 1500;
    await field.fill('legevakt');
    await page.getByRole('button', { name: 'Søk', exact: true }).click();
    // Still waiting for the new answer, the user is on the old one's Angre.
    await page.getByRole('button', { name: 'Angre' }).focus();
    await expect(page.getByRole('heading', { name: /^4 treff for «legevakt»/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Angre' })).toHaveCount(0);
    await expect(field).toBeFocused();
  });
});

/**
 * An undo waits, so it can outlive the moment a modal opens. It waits in the
 * place the removed thing had, so under the Kartlag dialog it steps back with
 * the rest of the page — under the scrim, out of reach — and comes back when
 * the dialog closes (critique runs 13 and 15).
 */
test('a waiting undo steps back behind a modal dialog, and returns when it closes', async ({ page, gotoApp }) => {
  await gotoApp();
  await waitForMapReady(page);
  await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
  await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
  await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();
  await page.getByRole('button', { name: 'Fjern fra Mine steder' }).click();
  const undo = page.locator('[data-undo-notice]').filter({ hasText: 'fjernet fra Mine steder' });
  await expect(undo).toBeVisible();

  const onTop = () =>
    undo.evaluate((notice) => {
      const box = notice.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && notice.contains(hit));
    });
  await page.getByRole('button', { name: 'Kartlag' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await onTop()).toBe(false);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await onTop()).toBe(true);
});

/**
 * Critique run 14: undos about different things wait side by side; closing a
 * waiting undo from the keyboard never drops focus on the page, even when the
 * button that raised it is gone; and "Fjern" moves focus on in the panel.
 */
test.describe('the undo model, per subject', () => {
  async function planRoute(page: Page): Promise<void> {
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Veibeskrivelse herfra' }).click();
    await page.getByPlaceholder('Velg destinasjon…').fill('Sentral');
    await page.getByRole('option', { name: /^Oslo Sentralstasjon, Oslo, Norge/ }).first().click();
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });
  }

  test('undos about different things wait side by side', async ({ page, gotoApp }) => {
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          generator: 'byt5',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [10.75, 59.91] },
              properties: { name: 'Apotek 1', amenity: 'pharmacy' }
            }
          ]
        })
      })
    );
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
    await page.getByPlaceholder('F.eks. apotek eller lekeplasser').fill('apotek');
    await page.getByRole('button', { name: 'Søk', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^1 treff for «apotek»/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Lukk resultatliste' }).click();

    await page.getByRole('radio', { name: 'Steder' }).click();
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();
    await page.getByRole('button', { name: 'Fjern fra Mine steder' }).click();

    // The area answer, a minute of work, is not given up for a star click, and
    // each waits where its own thing was: the answer in the list's place, the
    // saved place at the foot of the field its list belongs to.
    await expect(page.getByRole('button', { name: 'Angre' })).toHaveCount(2);
    await expect(page.locator('[data-undo-notice="area-results"]')).toContainText('Treffene for «apotek» er fjernet');
    await expect(page.locator('[data-undo-notice="saved-place"]')).toContainText('fjernet fra Mine steder');
  });

  test('closing a waiting undo by keyboard hands focus back, though what raised it is gone', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await planRoute(page);
    await page.getByRole('button', { name: 'Lukk veibeskrivelse' }).first().click();
    const directions = page.getByRole('button', { name: 'Veibeskrivelse', exact: true });
    await expect(directions).toBeFocused();
    // From there, on to the toast and closed with Escape: the "Lukk
    // veibeskrivelse" that raised it is gone, so focus goes back to where the
    // user came from.
    await page.locator('[data-undo-notice]').filter({ hasText: 'Ruten er fjernet' }).getByRole('button', { name: 'Angre' }).focus();
    await page.keyboard.press('Escape');
    await expect(directions).toBeFocused();
  });

  test('"Fjern" by keyboard moves focus on to the next control in the panel', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await planRoute(page);
    await openTools(page);
    await page.getByRole('button', { name: 'Unngå område', exact: true }).click();
    await drawPolygon(page, [{ x: 360, y: 260 }, { x: 460, y: 260 }, { x: 410, y: 360 }]);
    await expect(page.getByText('1 område unngås')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Fjern', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('checkbox', { name: 'Vis alternative ruter' })).toBeFocused();
  });

  // With no route left to show (the areas block every way), "Fjern" is the
  // last control in the panel, and focus fell on the page (polish, critique
  // run 14).
  test('"Fjern" with nothing after it hands focus back to what precedes it', async ({ page, gotoApp }) => {
    await page.route(/\/api\/route(\?.*)?$/, (route) =>
      route.request().url().includes('avoid_areas')
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ routes: [], dashed_segments: [] })
          })
        : route.fallback()
    );
    await gotoApp();
    await waitForMapReady(page);
    await planRoute(page);
    await openTools(page);
    await page.getByRole('button', { name: 'Unngå område', exact: true }).click();
    await drawPolygon(page, [{ x: 360, y: 260 }, { x: 460, y: 260 }, { x: 410, y: 360 }]);
    await expect(page.getByText('1 område unngås')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^Fant ingen rute mellom punktene/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Fjern', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Sykle', exact: true })).toBeFocused();
  });
});

/**
 * Under the Kartlag dialog a timed toast ran out unseen behind the scrim, and
 * the stack stayed reachable behind a modal. Its timer now holds while the
 * dialog is open and the stack is inert; the toast is still there when the
 * dialog closes, and then runs its course (critique run 14).
 */
test('a timed toast holds behind the Kartlag dialog, out of reach, and runs its course after', async ({
  page,
  gotoApp
}) => {
  test.setTimeout(45_000);
  await gotoApp();
  await waitForMapReady(page);
  await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
  await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
  await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();
  const saved = page.locator('[data-color]').filter({ hasText: 'Lagret i Mine steder' });
  await expect(saved).toBeVisible();

  await page.getByRole('button', { name: 'Kartlag' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.toast-stack')).toHaveAttribute('inert', '');
  // Well past its 4 s: held, not run out behind the scrim.
  await page.waitForTimeout(6_000);
  await expect(saved).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast-stack')).not.toHaveAttribute('inert', '');
  await expect(saved).toBeVisible();
  await expect(saved).toHaveCount(0, { timeout: 8_000 });
});

/**
 * An undo waits where the removed thing was, not in a corner: four of them
 * used to park 360x384px over the map, swallowing clicks there, looking like
 * notifications that lapse, 23 Tab presses from the action they undo
 * (critique run 15). The Kartlag dialog already put its undo in the removed
 * row's place; this is that pattern everywhere.
 */
test.describe('where an undo waits', () => {
  const MANY_HITS = {
    type: 'FeatureCollection',
    generator: 'byt5',
    features: Array.from({ length: 14 }, (_, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [10.715 + (i % 5) * 0.012, 59.905 + Math.floor(i / 5) * 0.007] },
      properties: { name: `Apotek ${i + 1}`, amenity: 'pharmacy' }
    }))
  };

  test('in the rail, in the place the thing had, and never over the map', async ({ page, gotoApp }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route(/\/api\/overpass(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANY_HITS) })
    );
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
    await page.getByPlaceholder('F.eks. apotek eller lekeplasser').fill('apotek');
    await page.getByRole('button', { name: 'Søk', exact: true }).click();
    await expect(page.getByRole('heading', { name: /14 treff/ })).toBeVisible({ timeout: 15_000 });

    const listBox = (await page.locator('[data-overpass-row]').first().boundingBox())!;
    await page.getByRole('button', { name: 'Lukk resultatliste' }).click();

    // Where the list was: inside the rail, at the top of the space it had.
    const notice = page.locator('[data-undo-notice="area-results"]');
    await expect(notice).toBeVisible();
    const rail = (await page.locator('[data-rail]').boundingBox())!;
    const box = (await notice.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(rail.x);
    expect(box.x + box.width).toBeLessThanOrEqual(rail.x + rail.width + 1);
    expect(box.y).toBeLessThanOrEqual(listBox.y);
    // And it is announced where it stands, not from a corner.
    await expect(page.locator('[role="status"]').filter({ hasText: 'Treffene for «apotek» er fjernet' })).toHaveCount(1);

    // Nothing waits over the map any more: the stack is empty, and a click in
    // the corner the stack used to fill reaches the map.
    await expect(page.locator('.toast-stack [data-toast-id]')).toHaveCount(0);
    await mapContainer(page).click({ position: { x: 1000, y: 200 } });
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible({ timeout: 10_000 });
  });

  test('a Tab press from what removed it, not twenty-three', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Veibeskrivelse herfra' }).click();
    await page.getByPlaceholder('Velg destinasjon…').fill('Sentral');
    await page.getByRole('option', { name: /^Oslo Sentralstasjon, Oslo, Norge/ }).first().click();
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Lukk veibeskrivelse' }).first().focus();
    await page.keyboard.press('Enter');
    // Focus lands on the Veibeskrivelse button that took the panel's place;
    // the undo waits right under it.
    await expect(page.getByRole('button', { name: 'Veibeskrivelse', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.locator('[data-undo-notice="route-closed"]').getByRole('button', { name: 'Angre' })
    ).toBeFocused();
  });
});

/**
 * An undo's words fit the place it waits in: inside the route panel the
 * message stands on one line beside its buttons, where "Det unngåtte området
 * er fjernet" took three, and the "×" says what it closes (critique run 15).
 */
test('a cleared-areas undo says it on one line, and its × is named', async ({ page, gotoApp }) => {
  await gotoApp();
  await waitForMapReady(page);
  await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
  await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
  await page.getByRole('button', { name: 'Veibeskrivelse herfra' }).click();
  await page.getByPlaceholder('Velg destinasjon…').fill('Sentral');
  await page.getByRole('option', { name: /^Oslo Sentralstasjon, Oslo, Norge/ }).first().click();
  await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });
  await openTools(page);
  await page.getByRole('button', { name: 'Unngå område', exact: true }).click();
  await drawPolygon(page, [{ x: 360, y: 260 }, { x: 460, y: 260 }, { x: 410, y: 360 }]);
  await expect(page.getByText('1 område unngås')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Fjern', exact: true }).click();

  const notice = page.locator('[data-undo-notice="avoid-areas"]');
  await expect(notice).toContainText('Området er fjernet');
  const lines = await notice.evaluate((el) => {
    const message = el.querySelector('span[id]') as HTMLElement;
    const style = getComputedStyle(message);
    return message.getBoundingClientRect().height / parseFloat(style.lineHeight);
  });
  expect(lines).toBeLessThanOrEqual(1.05);
  await expect(notice.getByRole('button', { name: 'Lukk meldingen' })).toBeVisible();
});

/**
 * With motion turned off there is no countdown to watch, so the line says
 * only "this one goes by itself" — and a held timer fades, where running and
 * held used to look exactly alike (critique run 15).
 */
test('with reduced motion, a held countdown reads as held', async ({ page, gotoApp }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoApp();
  await waitForMapReady(page);
  await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
  await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
  await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();

  const line = page.locator('.toast-countdown');
  await expect(line).toBeVisible();
  const running = await line.evaluate((el) => ({
    opacity: Number(getComputedStyle(el).opacity),
    animation: getComputedStyle(el).animationName
  }));
  expect(running.animation).toBe('none');

  await page.locator('[data-toast-id]').first().hover();
  await expect(line).toHaveClass(/is-held/);
  const held = await line.evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(held).toBeLessThan(running.opacity / 2);
});

/**
 * Two things the move into place made structural (polish, critique run 15):
 * a place is starred from its card, which the area search opens too, so the
 * undo cannot belong to one search mode; and what was removed names itself,
 * with no limit on how long that name is.
 */
test('a place removed from a hit card has its undo, and a long name keeps it to two lines', async ({
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
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [10.75, 59.91] },
            properties: {
              // No dash or comma to distil away: the whole name reaches the
              // message, as a long Norwegian institution name would.
              name: 'Vitusapotek Jernbanetorget Oslo City kjøpesenter andre etasje ved hovedinngangen mot Karl Johans gate',
              amenity: 'pharmacy'
            }
          }
        ]
      })
    })
  );
  await gotoApp();
  await waitForMapReady(page);
  await page.getByRole('radio', { name: 'Hva finnes i kartutsnittet?' }).click();
  await page.getByPlaceholder('F.eks. apotek eller lekeplasser').fill('apotek');
  await page.getByRole('button', { name: 'Søk', exact: true }).click();
  await expect(page.getByRole('heading', { name: /1 treff/ })).toBeVisible({ timeout: 15_000 });

  // The star lives on the hit's card, in a mode that is not "Steder".
  await page.getByRole('button', { name: /^Treff 1,/ }).click();
  await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();
  await page.getByRole('button', { name: 'Fjern fra Mine steder' }).click();

  const notice = page.locator('[data-undo-notice="saved-place"]');
  await expect(notice).toBeVisible();
  const message = notice.locator('span[id]');
  const lines = await message.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      lines: el.getBoundingClientRect().height / parseFloat(style.lineHeight),
      title: el.getAttribute('title'),
      says: el.textContent?.includes('er fjernet fra Mine')
    };
  });

  expect(lines.lines).toBeLessThanOrEqual(2.05);
  // Clamped, the full text is still there for the pointer and the screen reader.
  expect(lines.title).toContain('Karl Johans gate');
  expect(lines.says).toBe(true);
});
