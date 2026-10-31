import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { waitForMapReady, mapContainer } from './helpers/map';

/**
 * The Koordinater tab: a position goes where it says. The nearest address is
 * told, never moved to, because the person asked for that exact point.
 */
const ADDRESS_ANSWER = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      // About 900 m from the searched point: far enough to see if the pin follows.
      geometry: { type: 'Point', coordinates: [10.76, 59.92] },
      properties: {
        display_name: 'Rådhusplassen 1, 0160 Oslo, Norge',
        address: { road: 'Rådhusplassen', house_number: '1', postcode: '0160', city: 'Oslo' }
      }
    }
  ]
};

const OSLO_HEADING = '59,91390° N, 10,75220° Ø';
const READINGS = 'Slik kan koordinatene leses';

async function answerReverse(page: Page, body: unknown): Promise<void> {
  await page.route(/\/api\/reverse(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

async function openCoordinatesTab(page: Page) {
  await page.getByRole('radio', { name: 'Koordinater' }).click();
  return page.getByRole('combobox', { name: 'Koordinater' });
}

/** How far the selected pin sits from the centre of the map, in pixels. */
async function pinDistanceFromMapCentre(page: Page): Promise<number> {
  return page.evaluate(() => {
    const map = document.querySelector('.leaflet-container')!.getBoundingClientRect();
    const paths = [...document.querySelectorAll('.leaflet-overlay-pane path')];
    const distances = paths.map((path) => {
      const box = path.getBoundingClientRect();
      return Math.hypot(
        box.x + box.width / 2 - (map.x + map.width / 2),
        box.y + box.height / 2 - (map.y + map.height / 2)
      );
    });
    return distances.length ? Math.min(...distances) : Infinity;
  });
}

test.describe('coordinate search', () => {
  test('a UTM value goes to its exact point and names the nearest address', async ({ page, gotoApp }) => {
    await answerReverse(page, ADDRESS_ANSWER);
    await gotoApp();
    await waitForMapReady(page);

    const input = await openCoordinatesTab(page);
    await input.fill('32V 597980 6643119');
    await expect(page.getByRole('option', { name: /UTM sone 32V/ })).toBeVisible();
    await input.press('Enter');

    const card = page.getByRole('region', { name: 'Detaljer' });
    await expect(card.getByRole('heading', { name: OSLO_HEADING })).toBeVisible();
    await expect(card.getByText('Nærmeste adresse: Rådhusplassen 1, 0160 Oslo')).toBeVisible();

    await expect(input).toHaveValue('32V 597980 6643119');
    await expect(page).toHaveURL(/#map=\d+\/59\.9139\d?\/10\.7522\d?/);
    await expect.poll(() => pinDistanceFromMapCentre(page)).toBeLessThan(3);

    // The answer takes focus, as a place picked from the list does.
    await expect(card.locator(':focus')).toHaveCount(1);
  });

  test('numbers that fit both ways can be chosen, and chosen again', async ({ page, gotoApp }) => {
    await answerReverse(page, ADDRESS_ANSWER);
    await gotoApp();
    await waitForMapReady(page);

    const input = await openCoordinatesTab(page);
    await input.fill('10,7522 59,9139');
    await expect(page.getByRole('listbox', { name: READINGS }).getByRole('option')).toHaveCount(2);
    await input.press('Enter');
    const card = page.getByRole('region', { name: 'Detaljer' });
    await expect(card.getByRole('heading', { name: '10,75220° N, 59,91390° Ø' })).toBeVisible();

    await input.focus();
    await page.getByRole('option', { name: /Lengdegrad først/ }).click();
    await expect(card.getByRole('heading', { name: OSLO_HEADING })).toBeVisible();
    await expect(page).toHaveURL(/#map=\d+\/59\.9139\d?\/10\.7522\d?/);
  });

  test('a point with no address stays a point and says so', async ({ page, gotoApp }) => {
    await answerReverse(page, { type: 'FeatureCollection', features: [] });
    await gotoApp();
    await waitForMapReady(page);

    const input = await openCoordinatesTab(page);
    await input.fill('59.9139 N 10.7522 E');
    await input.press('Enter');

    const card = page.getByRole('region', { name: 'Detaljer' });
    await expect(card.getByRole('heading', { name: OSLO_HEADING })).toBeVisible();
    await expect(card.getByText('Fant ingen adresse for punktet.')).toBeVisible();
  });

  test('asking again after a failed lookup keeps the point', async ({ page, gotoApp }) => {
    let healthy = false;
    await page.route(/\/api\/reverse(\?.*)?$/, (route) =>
      healthy
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ADDRESS_ANSWER) })
        : route.fulfill({ status: 503, body: 'nede' })
    );
    await gotoApp();
    await waitForMapReady(page);

    const input = await openCoordinatesTab(page);
    await input.fill('32V 597980 6643119');
    await input.press('Enter');

    const card = page.getByRole('region', { name: 'Detaljer' });
    const retry = card.getByRole('button', { name: 'Prøv igjen' });
    await expect(retry).toBeVisible();

    healthy = true;
    await retry.click();
    await expect(card.getByText('Nærmeste adresse: Rådhusplassen 1, 0160 Oslo')).toBeVisible();
    await expect(card.getByRole('heading', { name: OSLO_HEADING })).toBeVisible();
    await expect.poll(() => pinDistanceFromMapCentre(page)).toBeLessThan(3);
  });

  test('a position searched for comes back from Nylige søk as the same exact point', async ({ page, gotoApp }) => {
    await answerReverse(page, ADDRESS_ANSWER);
    await gotoApp();
    await waitForMapReady(page);

    const input = await openCoordinatesTab(page);
    await input.fill('32V 597980 6643119');
    await input.press('Enter');
    await expect(page.getByRole('region', { name: 'Detaljer' })).toBeVisible();

    await page.getByRole('radio', { name: 'Steder' }).click();
    await expect(page.getByRole('region', { name: 'Detaljer' })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Søk etter sted eller adresse' }).focus();
    await page.getByRole('option', { name: `Gå til ${OSLO_HEADING}` }).click();

    const card = page.getByRole('region', { name: 'Detaljer' });
    await expect(card.getByRole('heading', { name: OSLO_HEADING })).toBeVisible();
    await expect(card.getByText('Nærmeste adresse: Rådhusplassen 1, 0160 Oslo')).toBeVisible();
    await expect.poll(() => pinDistanceFromMapCentre(page)).toBeLessThan(3);
  });

  test('the arrow keys reach the tab, and each tab keeps to its own text', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);

    const places = page.getByRole('radio', { name: 'Steder' });
    await page.getByRole('combobox', { name: 'Søk etter sted eller adresse' }).fill('Oslo');
    await places.focus();
    await page.keyboard.press('ArrowLeft');

    const tab = page.getByRole('radio', { name: 'Koordinater' });
    await expect(tab).toBeFocused();
    await expect(tab).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('combobox', { name: 'Koordinater' })).toHaveValue('');
    await expect(page.getByText('Skriv eller lim inn')).toBeVisible();
  });

  test('coordinates keep steady figures in the field and the rows', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);

    const input = await openCoordinatesTab(page);
    await input.fill('10,7522 59,9139');
    const row = page.getByRole('listbox', { name: READINGS }).getByRole('option').first().locator('p').first();
    await expect(input).toHaveCSS('font-variant-numeric', 'tabular-nums');
    await expect(row).toHaveCSS('font-variant-numeric', 'tabular-nums');
  });

  test('hovering a reading shows it without moving the map', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await expect(page).toHaveURL(/#map=/);
    const before = page.url();

    const input = await openCoordinatesTab(page);
    await input.fill('59.9 N 10.7 E');
    await page.getByRole('listbox', { name: READINGS }).getByRole('option').hover();
    await expect(mapContainer(page).locator('.leaflet-overlay-pane path').first()).toBeAttached();
    expect(page.url()).toBe(before);
  });
});
