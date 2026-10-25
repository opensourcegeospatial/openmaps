import { test, expect } from './fixtures/test';
import { waitForMapReady } from './helpers/map';

test.describe('layer manager', () => {
  test('opening the layer manager renders the panel', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);

    await page.getByRole('button', { name: 'Kartlag', exact: true }).click();

    // The modal renders with its heading and the empty-state copy.
    await expect(page.getByRole('heading', { name: 'Kartlag' })).toBeVisible();
    await expect(page.getByText('Ingen egne kartlag ennå')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Legg til karttjeneste' })).toBeVisible();
  });
});
