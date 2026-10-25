import { test, expect } from './fixtures/test';
import { waitForMapReady } from './helpers/map';

const POLYGON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[10.744, 59.912], [10.752, 59.912], [10.752, 59.916], [10.744, 59.912]]]
      }
    }
  ]
};

test.describe('layer manager accessibility', () => {
  test('the style fields are labelled and an imported layer gets a named opacity slider', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    await page.getByRole('button', { name: 'Kartlag', exact: true }).click();
    await page.getByRole('tab', { name: 'Importer fil' }).click();
    await page.locator('input[type=file]').setInputFiles({
      name: 'omrade.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(JSON.stringify(POLYGON))
    });

    await expect(page.getByLabel('Strek')).toBeVisible();
    await expect(page.getByLabel('Fyll', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Fyll, synlighet')).toBeVisible();

    await page.getByRole('button', { name: 'Legg til på kart' }).click();
    const slider = page.getByRole('slider', { name: /^Synlighet, omrade/ });
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute('aria-valuetext', '100 %');
  });

  test('removing a layer is confirmed in its place in the dialog, and Angre puts it back', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('button', { name: 'Kartlag', exact: true }).click();
    await page.getByRole('tab', { name: 'Importer fil' }).click();
    await page.locator('input[type=file]').setInputFiles({
      name: 'omrade.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(JSON.stringify(POLYGON))
    });
    await page.getByRole('button', { name: 'Legg til på kart' }).click();
    const dialog = page.getByRole('dialog', { name: 'Kartlag' });
    const slider = dialog.getByRole('slider', { name: /^Synlighet, omrade/ });
    await expect(slider).toBeVisible();

    await dialog.getByRole('button', { name: /^Fjern laget «omrade/ }).click();
    const undo = dialog.getByRole('button', { name: 'Angre' });
    await expect(undo).toBeFocused();
    await expect(dialog.getByText(/^Laget «omrade.*» er fjernet\.$/)).toBeVisible();
    // No toast sits over the dialog.
    await expect(page.getByRole('button', { name: 'Lukk varsel' })).toHaveCount(0);

    await undo.click();
    await expect(slider).toBeVisible();
    await expect(undo).toHaveCount(0);
    await expect(dialog.locator('[data-layer-name]')).toBeFocused();
  });

  test('after adding a layer focus lands on its name, Escape still closes, and the layer can be renamed', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('button', { name: 'Kartlag', exact: true }).click();
    await page.getByRole('tab', { name: 'Importer fil' }).click();
    await page.locator('input[type=file]').setInputFiles({
      name: 'omrade.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(JSON.stringify(POLYGON))
    });
    await page.getByRole('button', { name: 'Legg til på kart' }).click();
    const dialog = page.getByRole('dialog', { name: 'Kartlag' });
    const name = dialog.locator('[data-layer-name]');
    await expect(name).toBeFocused();

    // Escape inside the rename field keeps the old name and the dialog.
    await dialog.getByRole('button', { name: /^Gi laget «omrade.*» nytt navn$/ }).click();
    const field = dialog.getByRole('textbox', { name: /^Nytt navn på laget/ });
    await expect(field).toBeFocused();
    await field.fill('Tilsynsområde');
    await page.keyboard.press('Escape');
    await expect(name).toHaveText(/^omrade/);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: /nytt navn$/ }).click();
    await dialog.getByRole('textbox', { name: /^Nytt navn på laget/ }).fill('Tilsynsområde');
    await page.keyboard.press('Enter');
    await expect(name).toHaveText('Tilsynsområde');
    await expect(name).toBeFocused();

    // The dialog still hears Escape after all that.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test("a file layer's popup speaks Norwegian, down to Leaflet's close button", async ({ page, gotoApp }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('button', { name: 'Kartlag', exact: true }).click();
    await page.getByRole('tab', { name: 'Importer fil' }).click();
    const named = { ...POLYGON, features: [{ ...POLYGON.features[0], properties: { navn: 'Tilsynsområde' } }] };
    await page.locator('input[type=file]').setInputFiles({
      name: 'omrade.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(JSON.stringify(named))
    });
    await page.getByRole('button', { name: 'Legg til på kart' }).click();
    await page.getByRole('dialog', { name: 'Kartlag' }).getByRole('button', { name: 'Lukk kartlag' }).click();

    // The imported triangle has its right angle at the bottom right; click inside it there.
    const area = page.locator('.leaflet-overlay-pane path').last();
    const box = await area.boundingBox();
    if (!box) throw new Error('the imported area is not drawn');
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.75);
    await expect(page.locator('.leaflet-popup-content')).toContainText('Tilsynsområde');
    await expect(page.locator('.leaflet-popup-close-button')).toHaveAttribute('aria-label', 'Lukk');

    // The layer chip looks like a control, and it is one: it opens Kartlag.
    await page.getByRole('button', { name: /^1 eget kartlag/ }).click();
    await expect(page.getByRole('dialog', { name: 'Kartlag' })).toBeVisible();
  });

  test('Tab never leaves the Kartlag dialog, not even in its empty state', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('button', { name: 'Kartlag', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Kartlag' })).toBeVisible();

    // The empty state has the fewest real stops, which is where a trap that
    // counts elements the browser will never focus lets Tab walk out.
    const insideDialog = () =>
      page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await insideDialog()).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await insideDialog()).toBe(true);
    }
  });
});

/**
 * A modal keeps the page behind it from the pointer (its scrim) and from the
 * keyboard (its focus trap), but `aria-modal` only asks assistive technology
 * to do the same: with Kartlag open, the area answer behind it was still
 * readable in the accessibility tree (critique run 15). Everything outside
 * now steps back for real — except the regions that speak for the toasts,
 * which have to keep speaking (polish, run 14).
 */
test('with Kartlag open, the page behind it steps back, and the toast regions do not', async ({
  page,
  gotoApp
}) => {
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
  const answer = page.getByRole('heading', { name: /treff for «apotek»/ });
  await expect(answer).toBeVisible({ timeout: 15_000 });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const readable = async (needle: string): Promise<number> => {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
      nodes: { ignored: boolean; name?: { value?: string } }[];
    };
    return nodes.filter((node) => !node.ignored && String(node.name?.value ?? '').includes(needle)).length;
  };
  expect(await readable('treff for «apotek»')).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Kartlag', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Kartlag' })).toBeVisible();
  await expect(page.locator('[data-rail]')).toHaveAttribute('inert', '');
  await expect(page.locator('.leaflet-container')).toHaveAttribute('inert', '');
  await expect(page.locator('[data-toast-layer]')).not.toHaveAttribute('inert', '');
  expect(await readable('treff for «apotek»')).toBe(0);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Kartlag' })).toHaveCount(0);
  await expect(page.locator('[data-rail]')).not.toHaveAttribute('inert', '');
  expect(await readable('treff for «apotek»')).toBeGreaterThan(0);
  await cdp.detach();
});
