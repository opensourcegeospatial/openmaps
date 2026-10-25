import { test, expect, type Page } from './fixtures/test';
import { waitForMapReady, mapContainer } from './helpers/map';

/**
 * Guards the type scale.
 *
 * The @mattilsynet/design Tailwind preset points `--text-*` at design-system
 * tokens that are never defined on `:root`, so without the bridge in
 * `src/app.css` every `text-xs/sm/lg/xl` utility silently resolves to
 * inheritance and the whole UI renders at the 18px body size; `font-semibold`
 * likewise referenced a token that does not exist and rendered at 400. That
 * shipped unnoticed once. These assertions read the *computed* values the
 * browser actually uses, at the 1280px desktop viewport the suite runs at
 * (`--mtds-base: 18`, so the scale is 14 / 16 / 21 / 24 px).
 */

const ROLE_CLASSES = {
  'text-xs': { fontSize: '14px', lineHeight: '21px' },
  'text-sm': { fontSize: '16px', lineHeight: '24px' },
  'text-lg': { fontSize: '21px' },
  'text-xl': { fontSize: '24px' }
} as const;

const WEIGHT_CLASSES = {
  'font-medium': '500',
  // Retired in favour of font-medium, but must never fall back to 400 again.
  'font-semibold': '500'
} as const;

async function computedFor(page: Page, className: string, props: string[]) {
  return page.evaluate(
    ([cls, wanted]) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0';
      const el = document.createElement('span');
      el.className = cls;
      el.textContent = 'Ag';
      host.appendChild(el);
      document.body.appendChild(host);
      const style = getComputedStyle(el);
      const out: Record<string, string> = {};
      for (const p of wanted) out[p] = style.getPropertyValue(p);
      host.remove();
      return out;
    },
    [className, props] as const
  );
}

test.describe('typography', () => {
  test('size and weight utilities resolve to the design-system scale', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    for (const [cls, expected] of Object.entries(ROLE_CLASSES)) {
      const got = await computedFor(page, cls, ['font-size', 'line-height']);
      expect(got['font-size'], `${cls} font-size`).toBe(expected.fontSize);
      if ('lineHeight' in expected) {
        expect(got['line-height'], `${cls} line-height`).toBe(expected.lineHeight);
      }
    }

    for (const [cls, weight] of Object.entries(WEIGHT_CLASSES)) {
      const got = await computedFor(page, cls, ['font-weight']);
      expect(got['font-weight'], `${cls} font-weight`).toBe(weight);
    }
  });

  test('a panel title outranks its body and its labels', async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);

    // The context menu carries a Label-role coordinate line and Body-role items.
    await mapContainer(page).click({ button: 'right', position: { x: 500, y: 400 } });
    const menu = page.getByRole('menu', { name: 'Kartvalg' });
    await expect(menu).toBeVisible();
    const coords = menu.locator('div').first();
    await expect(coords).toContainText('° N');
    expect(await coords.evaluate((n) => getComputedStyle(n).fontSize)).toBe('14px');
    const item = menu.getByRole('menuitem', { name: 'Veibeskrivelse herfra' });
    expect(await item.evaluate((n) => getComputedStyle(n).fontSize)).toBe('16px');

    // Opening the route panel gives us a Headline-role title.
    await item.click();
    const title = page.getByRole('heading', { name: 'Veibeskrivelse' });
    await expect(title).toBeVisible();
    const titleStyle = await title.evaluate((n) => ({
      fontSize: getComputedStyle(n).fontSize,
      fontWeight: getComputedStyle(n).fontWeight
    }));
    expect(titleStyle).toEqual({ fontSize: '21px', fontWeight: '500' });

    // And the panel's body sits at 16px under it.
    const startField = page.getByRole('combobox', { name: 'Startpunkt' });
    await expect(startField).toBeVisible();
    expect(await startField.evaluate((n) => getComputedStyle(n).fontSize)).toBe('16px');
  });

  test('a fact reads as a subtle label over its value, and numbers that move use tabular figures', async ({
    page,
    gotoApp
  }) => {
    await page.route(/\/api\/reverse(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [10.7522, 59.9139] },
              properties: {
                display_name: 'Kaffebrenneriet, Storgata 12, Oslo',
                name: 'Kaffebrenneriet',
                type: 'cafe',
                address: { road: 'Storgata', house_number: '12', city: 'Oslo' }
              }
            }
          ]
        })
      })
    );
    await gotoApp();
    await waitForMapReady(page);

    await mapContainer(page).click({ position: { x: 900, y: 600 } });
    const card = page.getByRole('region', { name: 'Detaljer' });
    const label = card.getByText('Adresse', { exact: true });
    await expect(label).toBeVisible({ timeout: 10_000 });
    const value = card.getByText('Storgata 12, Oslo', { exact: true });
    const read = (n: Element) => ({ size: getComputedStyle(n).fontSize, color: getComputedStyle(n).color });
    const labelStyle = await label.evaluate(read);
    const valueStyle = await value.evaluate(read);
    expect(labelStyle.size).toBe('14px');
    expect(valueStyle.size).toBe('16px');
    expect(labelStyle.color).not.toBe(valueStyle.color);

    // Coordinates in the map menu keep their width as the point changes.
    await mapContainer(page).click({ button: 'right', position: { x: 500, y: 400 } });
    const coords = page.getByRole('menu', { name: 'Kartvalg' }).locator('div').first();
    await expect(coords).toContainText('° N');
    expect(await coords.evaluate((n) => getComputedStyle(n).fontVariantNumeric)).toBe('tabular-nums');
  });
});
