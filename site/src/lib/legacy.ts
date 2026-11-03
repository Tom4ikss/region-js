// The old site was flat HTML files: /region-js/spawn.html and /region-js/ru/spawn.html. The new
// site serves /region-js/spawn/ and /region-js/ru/spawn/, so every old file name is kept as a
// small redirect page. With JavaScript the redirect keeps the #anchor (the heading ids did not
// change); without it, the meta refresh opens the top of the page.

import { PAGES, SITE, pageHref } from './site.mjs';
import type { Lang } from './examples';

/** Old page slugs that need a redirect (`index.html` is still served by the landing page). */
export function legacyPaths() {
	return PAGES.filter((p) => p.slug !== 'index').map((p) => ({ params: { slug: p.slug } }));
}

export function redirectPage(lang: Lang, slug: string): Response {
	const target = pageHref(lang, slug);
	const moved = lang === 'ru' ? 'Страница переехала:' : 'This page has moved to';
	const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${target}</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${SITE}${target}">
<script>location.replace(${JSON.stringify(target)} + location.search + location.hash)</script>
<meta http-equiv="refresh" content="0; url=${target}">
</head>
<body>
<p>${moved} <a href="${target}">${SITE}${target}</a></p>
</body>
</html>
`;
	return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
