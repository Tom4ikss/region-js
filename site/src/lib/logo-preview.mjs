// Temporary: logo candidates side by side on the real landing page. After the build, the landing
// page is copied to /0/ … /7/ with the header logo and the favicon swapped for one candidate
// (files in public/logo-preview/). The root page keeps the current logo. The copies are noindex.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const VARIANTS = [
	{ name: '0', dark: '0.svg', light: '0.svg', favicon: '0.svg' },
	{ name: '1', dark: '1-dark.svg', light: '1-light.svg', favicon: '1-dark.svg' },
	{ name: '2', dark: '2-dark.svg', light: '2-light.svg', favicon: '2-dark.svg' },
	{ name: '3', dark: '3-dark.svg', light: '3-light.svg', favicon: '3-favicon.svg' },
	{ name: '4', dark: '4.svg', light: '4.svg', favicon: '4-favicon.svg' },
	{ name: '5', dark: '5-dark.svg', light: '5-light.svg', favicon: '5-favicon.svg' },
	{ name: '6', dark: '6-dark.svg', light: '6-light.svg', favicon: '6-favicon.svg' },
	{ name: '7', dark: '7-dark.svg', light: '7-light.svg', favicon: '7-favicon.svg' },
];

// Starlight renders the dark and the light logo as two <img>s; only their src changes.
const LOGO_DARK = /(<img class="light:sl-hidden[^"]*" alt src=")[^"]*\/_astro\/logo-dark\.[\w-]+\.svg"/;
const LOGO_LIGHT = /(<img class="dark:sl-hidden[^"]*" alt src=")[^"]*\/_astro\/logo-light\.[\w-]+\.svg"/;
const FAVICON = /<link rel="shortcut icon" href="[^"]*" type="image\/svg\+xml"\/?>/;

export default function logoPreview(base) {
	return {
		name: 'logo-preview',
		hooks: {
			'astro:build:done': async ({ dir, logger }) => {
				const root = fileURLToPath(dir);
				const index = await readFile(`${root}index.html`, 'utf8');
				if (!LOGO_DARK.test(index) || !LOGO_LIGHT.test(index) || !FAVICON.test(index)) {
					logger.warn('logo or favicon markup not found; preview pages not written');
					return;
				}
				for (const v of VARIANTS) {
					const src = (file) => `${base}/logo-preview/${file}`;
					const page = index
						.replace(LOGO_DARK, (_, head) => `${head}${src(v.dark)}"`)
						.replace(LOGO_LIGHT, (_, head) => `${head}${src(v.light)}"`)
						.replace(FAVICON, `<link rel="icon" href="${src(v.favicon)}" type="image/svg+xml">`)
						.replace('<head>', '<head><meta name="robots" content="noindex">');
					await mkdir(`${root}${v.name}`, { recursive: true });
					await writeFile(`${root}${v.name}/index.html`, page);
				}
				logger.info(`logo previews: ${VARIANTS.map((v) => `/${v.name}/`).join(' ')}`);
			},
		},
	};
}
