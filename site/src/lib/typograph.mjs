// Russian typography: a non-breaking space after one- and two-letter words and numbers, and
// before dashes, as in printed books. The same rules the old site applied to Russian pages.

const SHORT_WORD = /(?<![\p{L}\p{N}_-])([А-Яа-яЁё]{1,2}|[0-9]+) (?=\S)/gu;
const DASH = / (—|–) /g;

export function typograph(text) {
	return text.replace(SHORT_WORD, '$1\u00a0').replace(DASH, '\u00a0$1 ');
}

const RAW_TAGS = new Set(['pre', 'code', 'svg', 'script', 'style', 'title']);

/** The same for an HTML string: text inside code, pre, svg and similar tags is left alone. */
export function typographHtml(html) {
	let raw = 0;
	return html
		.split(/(<[^>]+>)/)
		.map((part) => {
			if (part.startsWith('<')) {
				const m = /^<(\/?)([a-zA-Z0-9]+)/.exec(part);
				if (m && RAW_TAGS.has(m[2].toLowerCase()) && !part.endsWith('/>')) raw += m[1] ? -1 : 1;
				return part;
			}
			return raw > 0 ? part : typograph(part);
		})
		.join('');
}
