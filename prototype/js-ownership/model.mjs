import { defineStruct } from './struct.mjs';

export const TreeNode = defineStruct('TreeNode', { value: 'f64', left: 'ref', right: 'ref' });

export function buildTree(region, depth) {
    const node = TreeNode.create(region, { value: 1 });
    if (depth > 0) {
        node.left = buildTree(region, depth - 1);
        node.right = buildTree(region, depth - 1);
    }
    return node;
}

export function sumTree(node) {
    const { left, right } = node;
    return node.value + (left ? sumTree(left) : 0) + (right ? sumTree(right) : 0);
}

export function buildPlainTree(depth) {
    return depth > 0
        ? { value: 1, left: buildPlainTree(depth - 1), right: buildPlainTree(depth - 1) }
        : { value: 1, left: null, right: null };
}

export function sumPlainTree(node) {
    const { left, right } = node;
    return node.value + (left ? sumPlainTree(left) : 0) + (right ? sumPlainTree(right) : 0);
}
