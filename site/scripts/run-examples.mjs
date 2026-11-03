#!/usr/bin/env node
// Reruns the site's examples in a real d8 and saves their output next to them as `*.out.txt`.
// The site never runs d8 itself: pages show these saved outputs.
//
//   node site/scripts/run-examples.mjs                    # every example, both languages
//   node site/scripts/run-examples.mjs --lang ru          # only site/examples/ru
//   node site/scripts/run-examples.mjs 43-orders.js       # only these examples
//   node site/scripts/run-examples.mjs --missing          # only examples without a saved output
//   node site/scripts/run-examples.mjs --check            # run, compare, write nothing
//
// d8 is taken from REGIONS_D8, or the release build that scripts/setup.sh makes
// (v8-src/v8/out/release/d8 at the repository root).
//
// The first lines of an example can set how it runs: `// d8-flags: --module` adds d8 flags,
// `// d8-exit: 1` says the example must exit with this code (0 by default). Output lines with
// d8's experimental-features warning are dropped, and the examples directory is removed from
// stack traces, so the saved output does not depend on where the repository lives.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(siteRoot, '..');
const D8 = process.env.REGIONS_D8 || join(repoRoot, 'v8-src', 'v8', 'out', 'release', 'd8');
const D8_FLAGS = ['--harmony-regions', '--max-serializer-memory=4000'];
const WARNING = 'V8 is running with experimental features enabled. Stability and security will suffer.';
const TIMEOUT_MS = 60_000;

function parseArgs(argv) {
	const opts = { langs: ['en', 'ru'], names: [], missing: false, check: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--lang') opts.langs = [argv[++i]];
		else if (a === '--missing') opts.missing = true;
		else if (a === '--check') opts.check = true;
		else if (a === '-h' || a === '--help') {
			console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).join('\n'));
			process.exit(0);
		} else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
		else opts.names.push(a);
	}
	for (const lang of opts.langs) if (lang !== 'en' && lang !== 'ru') throw new Error(`unknown language ${lang}`);
	return opts;
}

/** `// d8-flags: ...` and `// d8-exit: N` lines at the top of an example. */
export function exampleOptions(src) {
	const flags = [];
	let exitCode = 0;
	for (const line of src.split('\n')) {
		const m = /^\/\/ d8-(flags|exit): (.*)$/.exec(line);
		if (!m) break;
		if (m[1] === 'flags') flags.push(...m[2].split(/\s+/).filter(Boolean));
		else exitCode = Number.parseInt(m[2], 10);
	}
	return { flags, exitCode };
}

function runExample(dir, name) {
	const path = join(dir, name);
	const { flags, exitCode } = exampleOptions(readFileSync(path, 'utf8'));
	const proc = spawnSync(D8, [...D8_FLAGS, ...flags, path], { encoding: 'utf8', timeout: TIMEOUT_MS });
	if (proc.error) throw proc.error;
	// Stack traces name the file by its absolute path.
	const raw = (proc.stdout + proc.stderr).split(dir + sep).join('');
	const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== WARNING);
	const text = lines.join('\n').trimEnd() + '\n';
	if (proc.status !== exitCode) {
		const how = proc.signal ? `was killed by ${proc.signal}` : `exited with code ${proc.status}`;
		throw new Error(`example ${name} ${how}, expected ${exitCode}:\n${text}`);
	}
	return text;
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (!existsSync(D8)) {
		console.error(`d8 not found at ${D8}; build it with scripts/setup.sh or set REGIONS_D8`);
		process.exit(2);
	}
	let changed = 0;
	let ran = 0;
	for (const lang of opts.langs) {
		const dir = join(siteRoot, 'examples', lang);
		for (const name of readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) {
			if (opts.names.length && !opts.names.includes(name)) continue;
			const outPath = join(dir, name.replace(/\.js$/, '.out.txt'));
			const old = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
			if (opts.missing && old !== null) continue;
			const text = runExample(dir, name);
			ran++;
			const same = old === text;
			if (!same) changed++;
			if (!opts.check && !same) writeFileSync(outPath, text);
			console.log(`ran ${relative(repoRoot, join(dir, name)).padEnd(44)} ${same ? 'same' : opts.check ? 'differs' : 'updated'}`);
		}
	}
	console.log(`${ran} examples run, ${changed} ${opts.check ? 'differ from' : 'changed in'} the saved output`);
}

try {
	main();
} catch (e) {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
}
