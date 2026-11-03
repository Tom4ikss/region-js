// Site-wide constants and URL helpers, shared by the Astro config, components and scripts.

/** The site is served from https://tom4ikss.github.io/region-js/ (a GitHub Pages project site). */
export const SITE = 'https://tom4ikss.github.io';
export const BASE = '/region-js';
export const GITHUB = 'https://github.com/Tom4ikss/region-js';

/** Locales: English at the root, Russian under /ru/. */
export const LANGS = ['en', 'ru'];

/**
 * Pages in reading order. The slugs are the old file names (`spawn.html` became `/spawn/`), and
 * the groups are the old sidebar groups.
 */
export const PAGES = [
	{ slug: 'index', group: 0 },
	{ slug: 'problem', group: 0 },
	{ slug: 'ideas', group: 0 },
	{ slug: 'spawn', group: 1 },
	{ slug: 'guide', group: 1 },
	{ slug: 'channels', group: 1 },
	{ slug: 'practices', group: 1 },
	{ slug: 'tooling', group: 1 },
	{ slug: 'inside', group: 2 },
	{ slug: 'numbers', group: 2 },
	{ slug: 'limits', group: 2 },
];

export const GROUPS = [
	{ en: 'Introduction', ru: 'Введение' },
	{ en: 'Guide', ru: 'Руководство' },
	{ en: 'Details', ru: 'Подробности' },
];

/** `/region-js/ru/spawn/` → `ru`, anything else → `en`. */
export function langOf(pathname) {
	return pathname.startsWith(`${BASE}/ru/`) || pathname === `${BASE}/ru` ? 'ru' : 'en';
}

/** The URL of a page: `pageHref('en', 'spawn')` → `/region-js/spawn/`. */
export function pageHref(lang, slug, hash = '') {
	const prefix = lang === 'ru' ? `${BASE}/ru/` : `${BASE}/`;
	return prefix + (slug === 'index' ? '' : `${slug}/`) + hash;
}

/** The same page in the other language. */
export function otherLangHref(pathname) {
	if (langOf(pathname) === 'ru') return pathname.replace(`${BASE}/ru`, BASE) || `${BASE}/`;
	return pathname.replace(BASE, `${BASE}/ru`);
}
