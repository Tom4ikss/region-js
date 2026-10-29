// A spawn() whose handle is thrown away: nobody can get its result or error.

const isFunction = (node) =>
  node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';

// The `return` statements of `fn` itself, not of nested functions.
function ownReturns(fn) {
  const returns = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'ReturnStatement') returns.push(node);
    if (node !== fn && isFunction(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(fn.body);
  return returns;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require the handle returned by spawn() to be awaited, joined or kept' },
    schema: [],
    messages: {
      floating:
        'The result of spawn() is neither awaited nor joined, so its value and errors are lost. ' +
        'Use `await spawn(...)`, `.join()`, or return the handle, e.g. to Promise.all().',
      returnsOther:
        'This callback returns `{{value}}`, not the handle of this spawn(), so whoever waits for the ' +
        'callback (e.g. Promise.all over map()) does not wait for the task. Return the handle: ' +
        '`return spawn(...)`, or `return spawn(...).then(() => {{value}})` to keep the value.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      'ExpressionStatement > CallExpression.expression[callee.type="Identifier"][callee.name="spawn"]'(node) {
        let fn = node.parent;
        while (fn && !isFunction(fn)) fn = fn.parent;
        const other = fn && fn.parent.type === 'CallExpression' && fn.parent.arguments.includes(fn)
          ? ownReturns(fn).find((ret) => ret.argument)
          : null;
        if (other) {
          context.report({ node, messageId: 'returnsOther', data: { value: sourceCode.getText(other.argument) } });
        } else {
          context.report({ node, messageId: 'floating' });
        }
      },
    };
  },
};
