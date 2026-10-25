import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import license, { type Dependency } from 'rollup-plugin-license';
import { defineConfig } from 'vite';

const licenceSection = (text: string) => ['License Text:', '===', '', text.trim()].join('\n');

// The plugin reads LICENSE/LICENCE files only. These packages ship no licence file at all, so
// their upstream texts are kept in licenses/.
const LICENCE_FILES: Record<string, string> = {
	'leaflet-draw': 'leaflet-draw-MIT.txt',
	'@u-elements/u-combobox': 'u-elements-MIT.txt',
	'@u-elements/u-datalist': 'u-elements-MIT.txt',
	'@u-elements/u-details': 'u-elements-MIT.txt',
	'@u-elements/u-progress': 'u-elements-MIT.txt',
	'@u-elements/u-tabs': 'u-elements-MIT.txt'
};

// A package without a licence file gets its text from licenses/, or from its COPYING file
// (pannellum).
const fallbackLicence = (name: string | null): URL | null => {
	if (!name) return null;
	if (LICENCE_FILES[name]) return new URL(`./licenses/${LICENCE_FILES[name]}`, import.meta.url);
	const copying = new URL(`./node_modules/${name}/COPYING`, import.meta.url);
	return existsSync(copying) ? copying : null;
};

const dependencyNotice = (d: Dependency) => {
	const file = d.licenseText ? null : fallbackLicence(d.name);
	return file ? [d.text(), licenceSection(readFileSync(file, 'utf8'))].join('\n') : d.text();
};

// The font @mattilsynet/design embeds in its CSS is under the SIL Open Font License, not
// the package's MIT licence, and the plugin only sees the package's own LICENSE file.
const fontNotice = () =>
	[
		'Name: Mattilsynet Sans (font embedded in @mattilsynet/design)',
		'License: OFL-1.1',
		licenceSection(readFileSync(new URL('./licenses/font-OFL-1.1.txt', import.meta.url), 'utf8'))
	].join('\n');

export default defineConfig({
	build: {
		rollupOptions: {
			plugins: [
				// Every bundled package with its licence text, served at /third-party-notices.txt.
				license({
					thirdParty: {
						includePrivate: false,
						output: {
							file: 'dist/third-party-notices.txt',
							// The plugin's default format, plus the fallback licence texts and the font.
							template: (dependencies) =>
								[...dependencies.map(dependencyNotice), fontNotice()].join('\n\n---\n\n')
						}
					}
				})
			]
		}
	},
	server: {
		host: '0.0.0.0',
		port: 5173,
		proxy: {
			'/api': {
				target: 'http://localhost:8000',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api/, '')
			}
		}
	},
	publicDir: 'static',
	plugins: [tailwindcss(), react()],
	test: {
		environment: 'jsdom',
		setupFiles: ['./vitest-setup-client.ts'],
		clearMocks: true,
		include: ['src/**/*.{test,spec}.{ts,tsx}']
	}
});
