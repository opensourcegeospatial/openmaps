import { test, expect, type Page } from './fixtures/test';
import { waitForMapReady } from './helpers/map';

/**
 * Drive the UI into navigation mode with an origin + destination set, so the
 * app fires a /route request (which a per-test mock can fail).
 */
async function setupRoute(page: Page): Promise<void> {
  const search = page.getByPlaceholder('Søk etter sted eller adresse…');
  await search.fill('Oslo');
  const firstResult = page.getByRole('option', { name: /^Oslo, Norge/ });
  await expect(firstResult).toBeVisible({ timeout: 10_000 });
  await firstResult.click();

  await page.getByRole('button', { name: 'Veibeskrivelse herfra' }).click();
  await expect(page.getByRole('heading', { name: 'Veibeskrivelse', level: 2 })).toBeVisible();

  const toInput = page.getByPlaceholder('Velg destinasjon…');
  await toInput.fill('Sentral');
  const dest = page.getByRole('option', { name: /^Oslo Sentralstasjon, Oslo, Norge/ }).first();
  await expect(dest).toBeVisible({ timeout: 10_000 });
  await dest.click();
}

test.describe('accessibility: dialogs', () => {
  test('Escape closes the layer manager and restores focus to the trigger', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    const trigger = page.getByRole('button', { name: 'Kartlag', exact: true });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Kartlag' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Focus should return to the button that opened the dialog.
    await expect(trigger).toBeFocused();
  });
});

test.describe('accessibility: routing feedback', () => {
  test('a failing /route is announced once, in the route panel, and never stacks', async ({
    page,
    gotoApp
  }) => {
    // Force the routing backend to error for this test only.
    await page.route(/\/api\/route(\?.*)?$/, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    );

    await gotoApp();
    await waitForMapReady(page);
    await setupRoute(page);

    // One alert, next to the fields that caused it; no toast repeating it.
    const banner = page.getByRole('alert').filter({ hasText: 'Kunne ikke beregne ruten' });
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Lukk varsel' })).toHaveCount(0);

    // The banner carries its own retry; a retry that fails again replaces, not stacks.
    const retry = banner.getByRole('button', { name: 'Prøv igjen' });
    await expect(retry).toBeVisible();
    const retried = page.waitForRequest((req) => req.url().includes('/api/route'), { timeout: 10_000 });
    await retry.click();
    await retried;
    await page.waitForTimeout(300);
    await expect(page.getByRole('alert').filter({ hasText: 'Kunne ikke beregne ruten' })).toHaveCount(1);

    // A second failure (another profile) replaces the message instead of adding one.
    await page.getByRole('button', { name: 'Gå', exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('alert').filter({ hasText: 'Kunne ikke beregne ruten' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Lukk varsel' })).toHaveCount(0);
  });
});

test.describe('accessibility: keyboard paths', () => {
  test('the layer manager is a real tab list that opens on its first tab', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('button', { name: 'Kartlag', exact: true }).click();

    const firstTab = page.getByRole('tab', { name: /^Egne kartlag/ });
    await expect(firstTab).toBeFocused();
    await expect(firstTab).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowRight');
    const serviceTab = page.getByRole('tab', { name: 'Legg til karttjeneste' });
    await expect(serviceTab).toBeFocused();
    await expect(serviceTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toBeVisible();

    // Fields are labelled, and the required one says so.
    const url = page.getByLabel('Tjeneste-URL *');
    await expect(url).toBeVisible();
    await expect(url).toHaveAttribute('required', '');
  });

  test('Tab reaches the search card first and every stop shows a focus ring', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);

    await page.keyboard.press('Tab');
    // The chosen search mode is the first stop; the two modes are one stop.
    const modeToggle = page.getByRole('radio', { name: 'Steder' });
    await expect(modeToggle).toBeFocused();
    // The teal keyboard ring is a box-shadow; hover/mouse focus leaves it off.
    await page.waitForTimeout(300);
    const ring = await modeToggle.evaluate((n) => getComputedStyle(n).boxShadow);
    expect(ring, 'focus-visible ring on the search mode').not.toBe('none');

    await page.keyboard.press('Tab');
    await expect(page.getByPlaceholder('Søk etter sted eller adresse…')).toBeFocused();

    await page.keyboard.press('Tab');
    const directions = page.getByRole('button', { name: 'Veibeskrivelse' });
    await expect(directions).toBeFocused();
    expect(await directions.evaluate((n) => getComputedStyle(n).boxShadow)).not.toBe('none');
  });

  test('Shift+F10 on the map opens the context menu at the map centre', async ({
    page,
    gotoApp
  }) => {
    await gotoApp();
    await waitForMapReady(page);
    await page.locator('.leaflet-container').focus();
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu', { name: 'Kartvalg' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Hva er her?' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });
});

const channel = (value: number) => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (color: string) => {
  const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test.describe('accessibility: non-text contrast in both schemes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the search focus ring and field edges clear 3:1 on their card (${scheme})`, async ({
      page,
      gotoApp
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await gotoApp();
      await waitForMapReady(page);

      const search = page.getByPlaceholder('Søk etter sted eller adresse…');
      await search.focus();
      await page.waitForTimeout(400);
      const ring = await search.evaluate((input) => {
        const card = input.closest('div.shadow-lg') as HTMLElement;
        const shadow = getComputedStyle(card).boxShadow;
        const match = shadow.match(/(rgba?\([^)]+\)) 0px 0px 0px 2px/);
        return { ring: match?.[1] ?? '', surface: getComputedStyle(card).backgroundColor };
      });
      expect(ring.ring, 'search card ring colour').not.toBe('');
      expect(contrast(ring.ring, ring.surface)).toBeGreaterThanOrEqual(3);

      await page.getByRole('button', { name: 'Veibeskrivelse', exact: true }).click();
      const destination = page.getByRole('combobox', { name: 'Destinasjon' });
      await expect(destination).toBeVisible();
      await page.waitForTimeout(400);
      const edge = await destination.evaluate((input) => ({
        border: getComputedStyle(input).borderTopColor,
        surface: getComputedStyle(input.closest('aside') as HTMLElement).backgroundColor
      }));
      expect(contrast(edge.border, edge.surface)).toBeGreaterThanOrEqual(3);
    });
  }
});

test.describe('toasts', () => {
  // Under a modal the stack is inert, out of the accessibility tree, and when
  // the dialog closes it comes back as regions created with their content,
  // which screen readers do not read: a warning raised under Kartlag was seen
  // dimmed behind the scrim but never heard (polish, critique run 14).
  test('a warning raised under the Kartlag dialog is heard, though the stack is out of reach', async ({
    page,
    gotoApp
  }) => {
    // The basemap's tiles fail only once the dialog is open.
    let openDialog!: () => void;
    const dialogOpen = new Promise<void>((resolve) => (openDialog = resolve));
    await page.route(/\.png(\?.*)?$/i, async (route) => {
      await dialogOpen;
      await route.fulfill({ status: 502, contentType: 'text/plain', body: '' }).catch(() => {});
    });
    await gotoApp();
    await waitForMapReady(page);
    await page.getByRole('button', { name: 'Kartlag', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Kartlag' })).toBeVisible();
    openDialog();

    const warning = 'er ikke tilgjengelig her';
    const stack = page.locator('.toast-stack');
    await expect(stack.getByText(warning)).toHaveCount(1, { timeout: 20_000 });
    await expect(stack).toHaveAttribute('inert', '');
    // Said beside the stack, in a polite region…
    await expect(page.locator('.toast-stack ~ [aria-live="polite"]')).toContainText(warning);
    // …that the accessibility tree still holds while the dialog is open.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
      nodes: { ignored: boolean; role?: { value?: string }; name?: { value?: string } }[];
    };
    await cdp.detach();
    const heard = nodes.filter(
      (node) => !node.ignored && node.role?.value === 'StaticText' && String(node.name?.value ?? '').includes(warning)
    );
    expect(heard).toHaveLength(1);
  });

  // The design-system Alert spaces its children as stacked blocks, 1em apart,
  // which in the one-row toast dropped "Angre" and the close button 16px below
  // the line of the message they act on (polish, critique run 14).
  test("a toast's buttons sit on the first line of its message", async ({ page, gotoApp }) => {
    // A basemap that never draws says so in a message long enough to wrap,
    // which is where the offset showed worst.
    await page.route(/\.png(\?.*)?$/i, (route) =>
      route.fulfill({ status: 502, contentType: 'text/plain', body: '' })
    );
    await gotoApp();
    await waitForMapReady(page);
    await page.getByPlaceholder('Søk etter sted eller adresse…').fill('Oslo');
    await page.getByRole('option', { name: /^Oslo, Norge/ }).click();
    await page.getByRole('button', { name: 'Lagre i Mine steder' }).click();

    const offsets = async (text: string) => {
      const toast = page.locator('[data-toast-id]').filter({ hasText: text });
      await expect(toast).toBeVisible();
      return toast.evaluate((el) => {
        const top = (node: Element | null) => node?.getBoundingClientRect().top ?? NaN;
        const line = top(el.querySelector('span[id]'));
        return {
          angre: top(el.querySelector('button:not([aria-label])')) - line,
          close: top(el.querySelector('button[aria-label="Lukk varsel"]')) - line
        };
      });
    };
    const saved = await offsets('Lagret i Mine steder');
    expect(Math.abs(saved.close)).toBeLessThanOrEqual(1);

    const wrapped = await offsets('er ikke tilgjengelig her');
    expect(Math.abs(wrapped.close)).toBeLessThanOrEqual(1);
  });
});
