import { test, expect } from './fixtures/test';
import { waitForMapReady, mapContainer } from './helpers/map';

/**
 * The right-click menu must stay inside the viewport. Opened near the bottom
 * or right edge it used to overflow, and because it focuses its first item
 * on open, the browser scrolled the app shell to reveal it — clipping the
 * search bar at the top for as long as the menu stayed open.
 */
test.describe('context menu', () => {
  test('opened at the bottom-right corner it is clamped to the viewport and nothing scrolls', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const { width, height } = viewport as { width: number; height: number };

    const searchBefore = await page.getByPlaceholder('Søk etter sted eller adresse…').boundingBox();
    expect(searchBefore).not.toBeNull();

    // Right-click 12px inside the corner (clear of the attribution control).
    await mapContainer(page).click({ button: 'right', position: { x: width - 300, y: height - 12 } });
    const menu = page.getByRole('menu', { name: 'Kartvalg' });
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    const { x, y, width: w, height: h } = box as { x: number; y: number; width: number; height: number };
    expect(x + w, 'menu right edge').toBeLessThanOrEqual(width);
    expect(y + h, 'menu bottom edge').toBeLessThanOrEqual(height);

    // Focus moved into the menu without scrolling the shell: the search bar
    // has not moved.
    await expect(menu.getByRole('menuitem', { name: 'Hva er her?' })).toBeFocused();
    const searchAfter = await page.getByPlaceholder('Søk etter sted eller adresse…').boundingBox();
    expect(searchAfter?.y).toBe(searchBefore?.y);

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('offers its actions in three groups and asks nothing else', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);

    await mapContainer(page).click({ button: 'right', position: { x: 500, y: 400 } });
    const menu = page.getByRole('menu', { name: 'Kartvalg' });
    await expect(menu).toBeVisible();

    // The profile choice belongs to the route panel, not to the shortcut.
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Hva er her?',
      'Veibeskrivelse herfra',
      'Viapunkt her',
      'Veibeskrivelse hit',
      'Kopier koordinater'
    ]);
    await expect(menu.getByRole('separator')).toHaveCount(2);
    await expect(menu.getByRole('button')).toHaveCount(0);
    await expect(menu.getByText('Kjør')).toHaveCount(0);
  });

  test('Hva er her? opens the place card, and Kopier koordinater copies the header', async ({
    page,
    gotoApp
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoApp();
    await waitForMapReady(page);

    await mapContainer(page).click({ button: 'right', position: { x: 700, y: 400 } });
    const menu = page.getByRole('menu', { name: 'Kartvalg' });
    const coordinates = (await menu.locator('div').first().innerText()).trim();
    await menu.getByRole('menuitem', { name: 'Kopier koordinater' }).click();
    await expect(menu).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(coordinates);
    await expect(page.getByText('Koordinatene er kopiert')).toBeVisible();

    await mapContainer(page).click({ button: 'right', position: { x: 700, y: 400 } });
    await page.getByRole('menuitem', { name: 'Hva er her?' }).click();
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible({ timeout: 10_000 });
  });

  test('only the focused item is a tab stop, and Tab closes the menu back to the map', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await mapContainer(page).focus();
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu', { name: 'Kartvalg' });
    await expect(menu.getByRole('menuitem', { name: 'Hva er her?' })).toBeFocused();
    await expect(menu.locator('[role=menuitem]:not([tabindex="-1"])')).toHaveCount(0);

    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(mapContainer(page)).toBeFocused();
  });
});
