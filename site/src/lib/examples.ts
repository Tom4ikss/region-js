// Example sources and their saved d8 output, read at build time from site/examples/{en,ru}.
//
// Every example ran in a real d8; `scripts/run-examples.mjs` re-runs them and rewrites the
// `.out.txt` files. The site never runs anything itself.

const files = import.meta.glob('../../examples/*/*.{js,txt}', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;

export type Lang = 'en' | 'ru';

function file(lang: Lang, name: string): string {
	const text = files[`../../examples/${lang}/${name}`];
	if (text === undefined) throw new Error(`examples/${lang}/${name} does not exist`);
	return text;
}

/** Names of all example sources of a language, sorted. */
export function exampleNames(lang: Lang): string[] {
	const prefix = `../../examples/${lang}/`;
	return Object.keys(files)
		.filter((k) => k.startsWith(prefix) && k.endsWith('.js'))
		.map((k) => k.slice(prefix.length))
		.sort();
}

/** Raw text of an example file (`.js` or `.out.txt`), for the raw-file routes. */
export function exampleFile(lang: Lang, name: string): string {
	return file(lang, name);
}

const HEADER = /^\/\/ d8-(flags|exit): (.*)$/;

/**
 * The first lines of an example can set how it runs: `// d8-flags: --module` adds d8 flags,
 * `// d8-exit: 1` says the example is expected to exit with this code (0 by default).
 */
export function exampleOptions(src: string): { flags: string[]; exitCode: number } {
	const flags: string[] = [];
	let exitCode = 0;
	for (const line of src.split('\n')) {
		const m = HEADER.exec(line);
		if (!m) break;
		if (m[1] === 'flags') flags.push(...m[2].split(/\s+/).filter(Boolean));
		else exitCode = Number.parseInt(m[2], 10);
	}
	return { flags, exitCode };
}

export function loadExample(lang: Lang, name: string) {
	const src = file(lang, name).replace(/\n+$/, '');
	const out = file(lang, name.replace(/\.js$/, '.out.txt'));
	return { src, out, ...exampleOptions(src) };
}
