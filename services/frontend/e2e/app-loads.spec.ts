import { test, expect } from './fixtures/test';
import { waitForMapReady, mapContainer, openTools } from './helpers/map';

test.describe('app boot', () => {
  test('boots past config gating and renders the map + core controls', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    // Leaflet map container present.
    await expect(mapContainer(page)).toBeVisible();

    // Core controls render:
    // - zoom pair (bottom-right)
    await expect(page.getByRole('button', { name: 'Zoom inn' })).toBeVisible();
    // - search bar (Norwegian placeholder)
    await expect(page.getByPlaceholder('Søk etter sted eller adresse…')).toBeVisible();
    // - style selector (two mocked styles -> a <select> is rendered)
    await expect(page.locator('select')).toBeVisible();
    // - layer manager button
    await expect(page.getByRole('button', { name: 'Kartlag', exact: true })).toBeVisible();
    // - the route entry in the rail
    await expect(page.getByRole('button', { name: 'Veibeskrivelse' })).toBeVisible();
    // - the tool group (avoid areas join it only while a route is planned)
    // The tools are one press away, not on the default screen.
    await expect(page.getByRole('button', { name: 'Verktøy', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Verktøy' })).toHaveCount(0);
    await openTools(page);
    await expect(page.getByRole('button', { name: 'Mål avstand', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unngå område', exact: true })).toHaveCount(0);
    // - Systemhelse is for operators: no button without ?health
    await expect(page.getByRole('button', { name: 'Vis/skjul systemhelse' })).toHaveCount(0);
  });

  test('shows the Systemhelse button only with ?health in the URL', async ({ page, gotoApp }) => {
    await gotoApp('?health');
    await waitForMapReady(page);
    const toggle = page.getByRole('button', { name: 'Vis/skjul systemhelse' });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByRole('dialog', { name: 'Systemhelse' })).toBeVisible();
  });

  test('boots without uncaught console errors', async ({ page, gotoApp, consoleErrors }) => {
    await gotoApp();
    await waitForMapReady(page);
    // Let any deferred startup work (streetview fetch, view emit) settle.
    await page.waitForTimeout(500);

    // Ignore benign noise that can appear from third-party CSS / favicon etc.
    const meaningful = consoleErrors.filter(
      (e) => !/favicon|ResizeObserver|Download the React DevTools/i.test(e)
    );
    expect(meaningful, `unexpected console errors:\n${meaningful.join('\n')}`).toEqual([]);
  });
});
