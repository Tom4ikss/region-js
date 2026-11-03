// remark transforms for the documentation pages:
//
// - Explicit heading ids. MDX has no `{#id}` syntax, so a heading ends with an MDX comment that
//   names its id: `## Versus tokio {/* #tokio */}`. The comment is removed and the id is set on the
//   heading. Both languages use the same ids, which the old site's links (`numbers.html#real`)
//   point to.
// - "Bad" and "good" snippets: a fenced block ```` ```js bad ```` or ```` ```js good ```` becomes a
//   titled figure highlighted with the site's own highlighter (it knows `#{...}` and
//   `'use region'`), instead of a regular Expressive Code block.
import { visit, SKIP } from 'unist-util-visit';
import { highlightHast } from '../lib/highlight.mjs';

const ID_COMMENT = /^\s*\/\*\s*#([\w-]+)\s*\*\/\s*$/;
const TITLES = { en: { bad: 'Bad', good: 'Good' }, ru: { bad: 'Плохо', good: 'Хорошо' } };

/** `.../content/docs/ru/spawn.mdx` → `ru`. */
export function fileLang(file) {
	const path = (file.path ?? file.history?.[0] ?? '').split('\\').join('/');
	return /\/content\/docs\/ru\//.test(path) ? 'ru' : 'en';
}

function headingId(node) {
	const last = node.children[node.children.length - 1];
	if (last?.type !== 'mdxTextExpression') return;
	const m = ID_COMMENT.exec(last.value);
	if (!m) return;
	node.children.pop();
	const text = node.children[node.children.length - 1];
	if (text?.type === 'text') text.value = text.value.replace(/\s+$/, '');
	node.data ??= {};
	node.data.hProperties = { ...(node.data.hProperties ?? {}), id: m[1] };
}

function snippet(node, lang) {
	const kind = node.meta?.trim();
	const title = TITLES[lang][kind];
	return {
		type: 'regionSnippet',
		data: {
			hName: 'figure',
			hProperties: { className: ['snippet', kind] },
			hChildren: [
				{
					type: 'element',
					tagName: 'div',
					properties: { className: ['snippet-head'] },
					children: [
						{ type: 'element', tagName: 'span', properties: { className: ['mark'], ariaHidden: 'true' }, children: [] },
						{ type: 'text', value: title },
					],
				},
				{
					type: 'element',
					tagName: 'pre',
					properties: { className: ['code'] },
					// The span wrapper keeps Expressive Code from treating this as one of its blocks.
					children: [
						{
							type: 'element',
							tagName: 'code',
							properties: {},
							children: [{ type: 'element', tagName: 'span', properties: {}, children: highlightHast(node.value) }],
						},
					],
				},
			],
		},
	};
}

export default function remarkRegionDocs() {
	return (tree, file) => {
		const lang = fileLang(file);
		visit(tree, (node, index, parent) => {
			if (node.type === 'heading') {
				headingId(node);
				return;
			}
			if (node.type === 'code' && node.lang === 'js' && /^(bad|good)$/.test(node.meta?.trim() ?? '') && parent) {
				parent.children[index] = snippet(node, lang);
				return [SKIP, index];
			}
		});
	};
}
