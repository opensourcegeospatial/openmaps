import { test, expect, type Page } from './fixtures/test';
import { waitForMapReady, mapContainer } from './helpers/map';

/**
 * Every map tool keeps a keyboard path: arming a row hands focus to the map,
 * Space adds a vertex where the crosshair stands (the map centre), the arrow
 * keys move the map underneath it, Backspace removes the last vertex and
 * Enter (or "Fullfør") finishes. Escape and "Avbryt" discard the draft.
 */
const overlayPaths = (page: Page) => page.locator('.leaflet-overlay-pane path');
// The banner's second status line (the instruction line ends with "Esc avbryter.").
const liveLine = (page: Page) =>
  page.getByRole('status').filter({ hasText: /punkt/ }).filter({ hasNotText: 'Esc avbryter' });

async function armByKeyboard(page: Page, name: string): Promise<void> {
  // Open the Verktøy card from the keyboard; it lands focus on its first row.
  const toggle = page.getByRole('button', { name: /^Verktøy/ });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Mål avstand', exact: true })).toBeFocused();
  const row = page.getByRole('button', { name, exact: true });
  await row.focus();
  await page.keyboard.press('Enter');
  // Arming closes the card and hands focus to the map.
  await expect(page.getByRole('button', { name: /^Verktøy/ })).toHaveAttribute('aria-label', `Verktøy (${name} er på)`);
  await expect(page.getByRole('group', { name: 'Verktøy' })).toHaveCount(0);
  await expect(mapContainer(page)).toBeFocused();
}

/** Pan the focused map with the arrow keys and let Leaflet's animation settle. */
async function panByKeys(page: Page, key: string, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
}

test.describe('keyboard map tools', () => {
  test('Enter on the focused map asks what is at the crosshair', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    const lookup = page.waitForRequest((req) => req.url().includes('/api/reverse'), { timeout: 10_000 });

    await page.getByPlaceholder('Søk etter sted eller adresse…').focus();
    await page.keyboard.press('Tab'); // Veibeskrivelse
    await page.keyboard.press('Tab'); // the map
    await expect(mapContainer(page)).toBeFocused();
    await expect(page.locator('.map-crosshair')).toBeVisible();

    await page.keyboard.press('Enter');
    await lookup;
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible({ timeout: 10_000 });
  });

  test('a distance can be measured with Space, the arrow keys and Enter', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await armByKeyboard(page, 'Mål avstand');

    // The crosshair only appears under keyboard focus, and Fullfør waits for two points.
    await expect(page.locator('.map-crosshair')).toBeVisible();
    await expect(liveLine(page)).toHaveText('Ingen punkter ennå');
    await expect(page.getByRole('button', { name: 'Fullfør' })).toBeDisabled();

    await page.keyboard.press('Space');
    await expect(liveLine(page)).toHaveText('1 punkt');
    await panByKeys(page, 'ArrowRight', 3);
    await page.keyboard.press('Space');
    await expect(liveLine(page)).toContainText('2 punkter · Avstand:');
    await expect(page.getByRole('button', { name: 'Fullfør' })).toBeEnabled();

    // Backspace takes the last point back; Space adds it again.
    await page.keyboard.press('Backspace');
    await expect(liveLine(page)).toHaveText('1 punkt');
    await page.keyboard.press('Space');
    await expect(liveLine(page)).toContainText('2 punkter');

    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Måling' })).toContainText('Avstand');
    await expect(page.getByRole('button', { name: /^Verktøy/ })).toHaveAttribute('aria-label', 'Verktøy');
    await expect(page.getByRole('button', { name: 'Fullfør' })).toHaveCount(0);
    await expect(overlayPaths(page).first()).toBeVisible();
  });

  test('Avbryt discards a draft measurement instead of leaving it on the map', async ({ page, gotoApp }) => {
    // At the narrowest desktop width the pointer and key hints wrap differently.
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoApp();
    await waitForMapReady(page);
    await armByKeyboard(page, 'Mål avstand');
    await page.keyboard.press('Space');
    await panByKeys(page, 'ArrowDown', 2);
    await page.keyboard.press('Space');
    await expect(overlayPaths(page).first()).toBeVisible();

    // The banner keeps its height when focus leaves the map, so Avbryt does not
    // move away between press and release.
    const banner = page.locator('.tool-banner > div');
    const withKeys = (await banner.boundingBox())?.height;
    await page.getByRole('button', { name: 'Avbryt' }).focus();
    await page.waitForTimeout(100);
    expect((await banner.boundingBox())?.height, 'banner height after focus leaves the map').toBe(withKeys);
    await page.getByRole('button', { name: 'Avbryt' }).click();
    await expect(page.getByRole('button', { name: /^Verktøy/ })).toHaveAttribute('aria-label', 'Verktøy');
    await expect(overlayPaths(page)).toHaveCount(0);
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  });

  test('an avoid area can be drawn with the keyboard and reaches the routing request', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    // A route first: the avoid tool only exists while planning one.
    const search = page.getByPlaceholder('Søk etter sted eller adresse…');
    await search.fill('Oslo');
    const firstResult = page.getByRole('option', { name: /^Oslo, Norge/ });
    await expect(firstResult).toBeVisible({ timeout: 10_000 });
    await firstResult.click();
    await page.getByRole('button', { name: 'Veibeskrivelse herfra' }).click();
    const toInput = page.getByPlaceholder('Velg destinasjon…');
    await toInput.fill('Sentral');
    const dest = page.getByRole('option', { name: /^Oslo Sentralstasjon, Oslo, Norge/ }).first();
    await expect(dest).toBeVisible({ timeout: 10_000 });
    await dest.click();
    await expect(page.getByText('Avstand', { exact: true })).toBeVisible({ timeout: 10_000 });

    const avoidRoutePromise = page.waitForRequest(
      (req) => req.url().includes('/api/route') && req.url().includes('avoid_areas='),
      { timeout: 15_000 }
    );

    await armByKeyboard(page, 'Unngå område');
    await expect(page.getByRole('status').filter({ hasText: 'tegne området som skal unngås' })).toBeVisible();
    await page.keyboard.press('Space');
    await panByKeys(page, 'ArrowRight', 2);
    await page.keyboard.press('Space');
    await panByKeys(page, 'ArrowDown', 2);
    await page.keyboard.press('Space');
    await expect(liveLine(page)).toHaveText('3 punkter');
    await page.keyboard.press('Enter');

    const avoidRequest = await avoidRoutePromise;
    const raw = new URL(avoidRequest.url()).searchParams.get('avoid_areas');
    const parsed = JSON.parse(raw as string);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toHaveLength(3);
    await expect(page.getByText('1 område unngås')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^Verktøy/ })).toHaveAttribute('aria-label', 'Verktøy');
  });
});
