import { expect, type Page, type Locator } from '@playwright/test';

/**
 * Map interaction helpers shared across specs.
 *
 * Leaflet animations and debounced state make raw coordinate interactions
 * flaky; these helpers centralize the "wait until the map is interactive"
 * and "draw a polygon" sequences with the right waits.
 */

/** The Leaflet map container (the div Leaflet upgrades with .leaflet-container). */
export function mapContainer(page: Page): Locator {
  return page.locator('.leaflet-container');
}

/**
 * Wait until the app has booted past config gating and Leaflet is interactive:
 * the loading spinner ("Laster kart…") is gone, the container exists, and at
 * least one tile pane has been laid out.
 */
export async function waitForMapReady(page: Page): Promise<void> {
  // Config gate: the "Laster kart…" loading screen must disappear.
  await expect(page.getByText('Laster kart…')).toHaveCount(0, { timeout: 30_000 });
  const container = mapContainer(page);
  await expect(container).toBeVisible({ timeout: 30_000 });
  // The map's own zoom pair renders once the map component has mounted.
  await expect(page.getByRole('button', { name: 'Zoom inn' })).toBeVisible({ timeout: 30_000 });
  // Give Leaflet a tick to settle its initial layout / size invalidation.
  await page.waitForTimeout(300);
}

/**
 * Open the "Verktøy" card (bottom-right control) if it is closed, so the
 * named tool rows are on the page. The control's name carries the armed tool
 * ("Verktøy (Mål avstand er på)"), hence the prefix match.
 */
export async function openTools(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /^Verktøy/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(page.getByRole('group', { name: 'Verktøy' })).toBeVisible();
}

/**
 * Click at a point relative to the map container's top-left corner.
 * `clickCount: 2` performs a double-click at the same spot.
 */
async function clickMapAt(
  page: Page,
  x: number,
  y: number,
  options: { clickCount?: number } = {}
): Promise<void> {
  const container = mapContainer(page);
  await container.click({ position: { x, y }, clickCount: options.clickCount ?? 1 });
}

/**
 * Draw a polygon on the map by clicking a sequence of points and finishing
 * with a double-click on the last point — mirroring the avoid-area /
 * measurement draw controls (click to add vertices, dblclick to commit).
 *
 * Points are container-relative pixel offsets. Requires >= 3 points to form a
 * valid ring (the control discards drafts with fewer than 3 vertices).
 */
export async function drawPolygon(
  page: Page,
  points: Array<{ x: number; y: number }>
): Promise<void> {
  if (points.length < 3) {
    throw new Error('drawPolygon needs at least 3 points to form a ring');
  }

  // Add the leading vertices with single clicks.
  for (let i = 0; i < points.length - 1; i++) {
    await clickMapAt(page, points[i].x, points[i].y);
    // Small settle so Leaflet registers each click as a distinct vertex.
    await page.waitForTimeout(120);
  }

  // Finish on the last vertex with a double-click to commit the polygon.
  const last = points[points.length - 1];
  await clickMapAt(page, last.x, last.y, { clickCount: 2 });
  await page.waitForTimeout(200);
}

/**
 * Pan the map by dragging from the center by (dx, dy) pixels, then wait for
 * Leaflet's moveend to fire and the debounced hash writer (400ms) to run.
 */
export async function panMap(page: Page, dx: number, dy: number): Promise<void> {
  const container = mapContainer(page);
  const box = await container.boundingBox();
  if (!box) throw new Error('map container has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - dx, cy - dy, { steps: 8 });
  await page.mouse.up();
  // moveend + debounced (400ms) hash writer.
  await page.waitForTimeout(700);
}
