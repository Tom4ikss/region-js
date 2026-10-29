// region.borrowWhile(async () => ...) keeps the borrow until the returned
// promise settles. If nobody waits for that promise, a spawn() task ends
// first and its borrow is released early.

const isAsyncFunction = (node) =>
  (node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression') && node.async;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require the promise returned by borrowWhile() to be awaited or returned' },
    schema: [],
    messages: {
      floating:
        'borrowWhile() returns a promise here and nobody waits for it: a spawn() task ends without ' +
        'waiting, and its borrow is released before this work is done. Return or await it.',
    },
  },
  create(context) {
    return {
      'ExpressionStatement > CallExpression.expression[callee.type="MemberExpression"][callee.property.name="borrowWhile"]'(
        node,
      ) {
        if (isAsyncFunction(node.arguments[0])) context.report({ node, messageId: 'floating' });
      },
    };
  },
};
