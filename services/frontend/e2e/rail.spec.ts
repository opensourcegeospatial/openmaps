import { test, expect, type Page } from './fixtures/test';
import { waitForMapReady, mapContainer, openTools } from './helpers/map';

/**
 * The left rail's seams: the lists under the search card must not steal the
 * next click, focus must land somewhere sensible when a card opens or closes,
 * and Escape must always be a way out.
 */

async function pickOslo(page: Page): Promise<void> {
  const search = page.getByPlaceholder('Søk etter sted eller adresse…');
  await search.fill('Oslo');
  const firstResult = page.getByRole('option', { name: /^Oslo, Norge/ });
  await expect(firstResult).toBeVisible({ timeout: 10_000 });
  await firstResult.click();
}

test.describe('rail', () => {
  test('the route button takes its first click while the place lists are open', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await pickOslo(page);
    // Clear and refocus: the pick is now a recent search and the lists open
    // under the card, pushing the route button down.
    await page.getByRole('button', { name: 'Tøm søkefeltet' }).click();
    await page.getByPlaceholder('Søk etter sted eller adresse…').click();
    await expect(page.getByRole('group', { name: 'Nylige søk' })).toBeVisible();

    await page.getByRole('button', { name: 'Veibeskrivelse' }).click();
    await expect(page.getByRole('heading', { name: 'Veibeskrivelse', level: 2 })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Startpunkt' })).toBeFocused();
  });

  test('a details card takes focus when it opens and hands it back on Escape', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await pickOslo(page);

    const name = page.getByRole('heading', { name: 'Oslo', exact: true });
    await expect(name).toBeVisible();
    await expect(name).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Detaljer' })).toHaveCount(0);
    await expect(page.getByPlaceholder('Søk etter sted eller adresse…')).toBeFocused();
  });

  test('Escape closes the route panel, the toast undoes it, focus returns to the rail button', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await mapContainer(page).click({ button: 'right', position: { x: 500, y: 400 } });
    await page.getByRole('menuitem', { name: 'Veibeskrivelse herfra' }).click();
    const start = page.getByRole('combobox', { name: 'Startpunkt' });
    await expect(start).not.toHaveValue('', { timeout: 10_000 });

    // Escape from a control that is not a text field.
    await page.getByRole('button', { name: 'Bytt start og destinasjon' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Veibeskrivelse', level: 2 })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Veibeskrivelse' })).toBeFocused();

    await page.getByRole('button', { name: 'Angre' }).click();
    await expect(page.getByRole('heading', { name: 'Veibeskrivelse', level: 2 })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Startpunkt' })).not.toHaveValue('');
  });

  test('Escape disarms an armed measuring tool', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await openTools(page);
    await page.getByRole('button', { name: 'Mål avstand', exact: true }).click();
    // Arming puts the card away; the control carries the state.
    const toggle = page.getByRole('button', { name: /^Verktøy/ });
    await expect(toggle).toHaveAttribute('aria-label', 'Verktøy (Mål avstand er på)');
    await expect(page.getByRole('group', { name: 'Verktøy' })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Esc avbryter' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-label', 'Verktøy');
    await expect(page.getByRole('status').filter({ hasText: 'Esc avbryter' })).toHaveCount(0);
  });

  test('the basemap picker has an accessible name', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await expect(page.getByRole('combobox', { name: 'Bakgrunnskart' })).toBeVisible();
  });
});
