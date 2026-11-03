// A small JavaScript highlighter for the examples and the "bad"/"good" snippets.
//
// It is a port of the one the old site used. It knows the region syntax by construction: `#{...}`
// and `#[...]` are a `#` followed by ordinary braces, and `'use region'` is a string. Region APIs
// (`Region`, `spawn`, `Channel`, `.freeze()`, `.borrow()`...) get their own colour.
//
// `highlight(src)` returns HTML; `highlightHast(src)` returns hast nodes for remark/rehype plugins.

const KEYWORDS = new Set(
	`const let var function return if else for of in while do try catch finally
throw new class async await break continue typeof instanceof using this arguments null
undefined true false switch case default delete void yield static extends super`.split(/\s+/),
);
const API_GLOBALS = new Set(['Region', 'spawn', 'Channel', 'Worker', 'SharedArrayBuffer', 'Atomics', 'postMessage', 'onmessage']);
const API_METHODS = new Set([
	'run', 'freeze', 'thaw', 'borrow', 'release', 'join', 'of', 'postMessage', 'getMessage', 'terminate',
	'frozen', 'readers', 'owner', 'id', 'poolSize', 'frozenHere', 'borrowWhile', 'idle', 'send', 'recv',
	'sendSync', 'recvSync', 'select', 'selectSync', 'close', 'free', 'freed', 'byteSize', 'stats', 'enter',
	'object', 'array',
]);

const TOKEN = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<template>`)|(?<string>'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|(?<number>\b\d[\d_]*(?:\.\d+)?n?\b)|(?<ident>[A-Za-z_$][\p{L}\p{N}_$]*)/uy;

/** Tokens as [class | null, text] pairs; class is one of comment, string, number, keyword, api, fn. */
export function tokenize(src) {
	const out = [];
	const push = (cls, text) => {
		const last = out[out.length - 1];
		if (cls === null && last && last[0] === null) last[1] += text;
		else out.push([cls, text]);
	};

	function code(pos, stop) {
		let depth = 0;
		while (pos < src.length) {
			const ch = src[pos];
			if (stop === '}') {
				if (ch === '{') depth++;
				else if (ch === '}') {
					if (depth === 0) return pos;
					depth--;
				}
			}
			TOKEN.lastIndex = pos;
			const m = TOKEN.exec(src);
			if (!m) {
				push(null, ch);
				pos++;
				continue;
			}
			const kind = Object.keys(m.groups).find((k) => m.groups[k] !== undefined);
			const text = m[0];
			if (kind === 'template') {
				pos = template(pos + 1);
				continue;
			}
			if (kind === 'ident') {
				const before = src.slice(0, pos).trimEnd();
				const after = src.slice(pos + text.length).trimStart();
				if (KEYWORDS.has(text)) push('keyword', text);
				else if (before.endsWith('.') && API_METHODS.has(text)) push('api', text);
				else if (API_GLOBALS.has(text) && !before.endsWith('.')) push('api', text);
				else if (after.startsWith('(')) push('fn', text);
				else push(null, text);
			} else {
				push(kind, text);
			}
			pos += text.length;
		}
		return pos;
	}

	function template(pos) {
		let buf = '`';
		while (pos < src.length) {
			const ch = src[pos];
			if (ch === '\\') {
				buf += src.slice(pos, pos + 2);
				pos += 2;
				continue;
			}
			if (ch === '`') {
				push('string', buf + '`');
				return pos + 1;
			}
			if (src.startsWith('${', pos)) {
				push('string', buf + '${');
				buf = '';
				pos = code(pos + 2, '}');
				buf = '}';
				pos += 1;
				continue;
			}
			buf += ch;
			pos++;
		}
		push('string', buf);
		return pos;
	}

	code(0, null);
	return out;
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(src) {
	return tokenize(src)
		.map(([cls, text]) => (cls ? `<span class="tok-${cls}">${escapeHtml(text)}</span>` : escapeHtml(text)))
		.join('');
}

export function highlightHast(src) {
	return tokenize(src).map(([cls, text]) =>
		cls
			? { type: 'element', tagName: 'span', properties: { className: [`tok-${cls}`] }, children: [{ type: 'text', value: text }] }
			: { type: 'text', value: text },
	);
}
