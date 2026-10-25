import '@testing-library/jest-dom/vitest';
import { afterAll, vi } from 'vitest';

// required for jsdom as it does not support matchMedia
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	enumerable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn()
	}))
});

// jsdom doesn't implement CSS.supports, which @mattilsynet/design (via
// @digdir/designsystemet-web) probes at module load. Provide a stub so design
// system components (Alert, Spinner, …) can be imported in component tests.
if (typeof globalThis.CSS === 'undefined') {
	// @ts-expect-error minimal CSS stub for jsdom
	globalThis.CSS = {};
}
if (typeof globalThis.CSS.supports !== 'function') {
	globalThis.CSS.supports = () => false;
}

// @digdir/designsystemet-web watches the whole document (its toggle group and
// tooltip): any DOM change queues an animation frame, which queues a
// setTimeout(0) that reads `document`. A test file whose last act changes the
// DOM — a search ending, its spinner going — can be torn down between the two,
// and the timeout then throws "document is not defined" as two unhandled
// errors that fail the run although every test passed (2 runs in 5 once the
// busy "Søk" started swapping its label, critique run 16). Let one frame and
// one timer turn go by before each file's environment goes.
afterAll(async () => {
	await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
});

// add more mocks here if you need them
