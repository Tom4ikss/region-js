// rehype transforms for the documentation pages:
//
// - Russian typography (Russian pages only): a non-breaking space after short words and numbers
//   and before dashes. Code, SVG and titles are left alone.
// - d8 flags in inline code do not break after a hyphen: `--max-serializer-memory=4000` wraps only
//   at spaces. Each flag is wrapped in `<span class="nw">`.
import { visit, SKIP } from 'unist-util-visit';
import { typograph } from '../lib/typograph.mjs';
import { fileLang } from './remark-region-docs.mjs';

const RAW_TAGS = new Set(['pre', 'code', 'svg', 'script', 'style', 'title']);
const FLAG = /(?<![\w-])(--?\w[^\s<]*)/g;

const nameOf = (node) => (node.type === 'element' ? node.tagName : node.type?.startsWith('mdxJsx') ? node.name : undefined);

function typographTree(tree) {
	visit(tree, (node) => {
		const name = nameOf(node);
		if (name && RAW_TAGS.has(name.toLowerCase())) return SKIP;
		if (node.type === 'text') node.value = typograph(node.value);
	});
}

function glueFlags(tree) {
	visit(tree, (node) => {
		const name = nameOf(node);
		if (name === 'pre') return SKIP;
		if (name !== 'code' || node.children.length !== 1 || node.children[0].type !== 'text') return;
		const text = node.children[0].value;
		const parts = text.split(FLAG);
		if (parts.length === 1) return SKIP;
		node.children = parts
			.map((part, i) =>
				i % 2 === 1
					? { type: 'element', tagName: 'span', properties: { className: ['nw'] }, children: [{ type: 'text', value: part }] }
					: { type: 'text', value: part },
			)
			.filter((n) => n.type !== 'text' || n.value !== '');
		return SKIP;
	});
}

export default function rehypeRegionDocs() {
	return (tree, file) => {
		if (fileLang(file) === 'ru') typographTree(tree);
		glueFlags(tree);
	};
}
