#!/usr/bin/env node
// Checks the built site in dist/ (run `pnpm build` first). No dependencies.
//
//   node scripts/check-site.mjs [dist]
//
// - every internal href/src resolves to a file in dist/, and every #anchor exists on its page;
// - every id and example of the old build.py site (snapshot in scripts/legacy-site.json) is
//   still on the page with the same slug, examples in the same order, charts too;
// - every old URL (<slug>.html, ru/<slug>.html) is a redirect to the new page;
// - every example file has a raw copy at examples/<file>, and every example is on some page;
// - English pages have no Cyrillic outside program output (a missed translation).
//
// Exits with 1 if anything is wrong.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE } from '../src/lib/site.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.argv[2] ?? join(here, '..', 'dist'));
const examplesDir = join(here, '..', 'examples');
const legacy = JSON.parse(readFileSync(join(here, 'legacy-site.json'), 'utf8'));

let problems = 0;
const problem = (...msg) => {
	problems++;
	console.log(...msg);
};

if (!existsSync(join(dist, 'index.html'))) {
	console.error(`${dist} has no index.html; run \`pnpm build\` first`);
	process.exit(2);
}

// ---------------------------------------------------------------- pages and their ids

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});
}

const htmlFiles = walk(dist).filter((p) => p.endsWith('.html'));
const html = new Map(htmlFiles.map((p) => [p, readFileSync(p, 'utf8')]));
const idCache = new Map();

function idsOf(file) {
	if (!idCache.has(file)) {
		const ids = new Set();
		for (const m of html.get(file).matchAll(/\sid=(?:"([^"]*)"|'([^']*)')/g)) ids.add(decodeEntities(m[1] ?? m[2]));
		idCache.set(file, ids);
	}
	return idCache.get(file);
}

function decodeEntities(s) {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

/** The file in dist/ a URL path points to, or null. */
function fileFor(urlPath) {
	let p = decodeURIComponent(urlPath);
	if (!p.startsWith(`${BASE}/`) && p !== BASE) return null;
	p = p.slice(BASE.length) || '/';
	const candidates = p.endsWith('/') ? [join(dist, p, 'index.html')] : [join(dist, p), join(dist, p, 'index.html')];
	return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/** The URL path of a file in dist/: dist/ru/spawn/index.html → /region-js/ru/spawn/. */
function urlOf(file) {
	return `${BASE}/${relative(dist, file).split('\\').join('/')}`.replace(/index\.html$/, '');
}

// ---------------------------------------------------------------- links and anchors

let links = 0;
for (const [file, text] of html) {
	const pageUrl = new URL(urlOf(file), 'https://site.invalid');
	// Inline scripts and styles are not markup; the redirect pages build their target in a script.
	const markup = text.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '');
	for (const m of markup.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
		const raw = decodeEntities(m[1]);
		if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue;
		links++;
		const url = new URL(raw, pageUrl);
		const target = url.pathname === pageUrl.pathname ? file : fileFor(url.pathname);
		const where = relative(dist, file);
		if (!target) {
			problem(`missing    ${where} → ${raw}`);
			continue;
		}
		const hash = decodeURIComponent(url.hash.slice(1));
		if (hash && target.endsWith('.html') && !idsOf(target).has(hash)) problem(`no anchor  ${where} → ${raw}`);
	}
}

// ---------------------------------------------------------------- the old site

const pageFile = (lang, slug) => fileFor(`${BASE}/${lang === 'ru' ? 'ru/' : ''}${slug === 'index' ? '' : `${slug}/`}`);

for (const lang of ['en', 'ru']) {
	for (const [slug, old] of Object.entries(legacy[lang])) {
		const file = pageFile(lang, slug);
		const name = `${lang}/${slug}`;
		if (!file) {
			problem(`no page    ${name}`);
			continue;
		}
		const ids = idsOf(file);
		for (const id of old.ids) if (!ids.has(id)) problem(`old id     ${name}#${id} is gone`);

		const text = html.get(file);
		const examples = [...text.matchAll(/data-example="([^"]+)"/g)].map((m) => m[1]);
		if (examples.join() !== old.examples.join())
			problem(`examples   ${name}: expected ${old.examples.join(' ')}\n           got      ${examples.join(' ')}`);
		const charts = [...text.matchAll(/data-chart="([^"]+)"/g)].map((m) => m[1]);
		for (const c of old.charts) if (!charts.includes(c)) problem(`chart      ${name}: ${c} is missing`);

		// The old URL of the page must redirect to it.
		if (slug === 'index') continue;
		const oldFile = join(dist, lang === 'ru' ? 'ru' : '', `${slug}.html`);
		const target = `${BASE}/${lang === 'ru' ? 'ru/' : ''}${slug}/`;
		if (!existsSync(oldFile)) problem(`old url    ${relative(dist, oldFile)} does not exist`);
		else if (!readFileSync(oldFile, 'utf8').includes(`url=${target}"`)) problem(`old url    ${relative(dist, oldFile)} does not redirect to ${target}`);
	}
}

// ---------------------------------------------------------------- examples

for (const lang of ['en', 'ru']) {
	const sources = readdirSync(join(examplesDir, lang)).filter((n) => n.endsWith('.js'));
	const used = new Set(Object.values(legacy[lang]).flatMap((p) => p.examples));
	for (const name of sources) {
		if (!used.has(name)) problem(`unused     examples/${lang}/${name} is not on any page`);
		for (const f of [name, name.replace(/\.js$/, '.out.txt')]) {
			const raw = join(dist, lang === 'ru' ? 'ru' : '', 'examples', f);
			if (!existsSync(raw)) problem(`raw file   ${relative(dist, raw)} is missing`);
			else if (readFileSync(raw, 'utf8') !== readFileSync(join(examplesDir, lang, f), 'utf8'))
				problem(`raw file   ${relative(dist, raw)} differs from examples/${lang}/${f}`);
		}
	}
}

// ---------------------------------------------------------------- Cyrillic on English pages

for (const [file, text] of html) {
	const rel = relative(dist, file);
	if (rel.startsWith('ru/') || rel === '404.html') continue; // the 404 page is bilingual on purpose
	const visible = text
		.replace(/<script\b[\s\S]*?<\/script>/g, '')
		.replace(/<style\b[\s\S]*?<\/style>/g, '')
		.replace(/<pre class="out[^"]*">[\s\S]*?<\/pre>/g, '')
		// The language switch names the other version in its own language.
		.replace(/<[^>]*\slang="ru"[^>]*>/g, '');
	for (const m of visible.matchAll(/[А-Яа-яЁё]+/g)) {
		const at = m.index ?? 0;
		problem(`cyrillic   ${rel}: …${visible.slice(Math.max(0, at - 50), at + 30).replace(/\s+/g, ' ')}…`);
	}
}

const pages = htmlFiles.length;
console.log(`${pages} HTML files, ${links} internal links checked; problems: ${problems}`);
process.exit(problems ? 1 : 0);
