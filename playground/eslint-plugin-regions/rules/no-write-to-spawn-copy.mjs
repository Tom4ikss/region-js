// Plain objects and arrays given to a spawn() task, as arguments or captured,
// are copied into the worker. Changing them in the task changes the copy:
// the caller never sees it, and nothing reports it. The same goes for
// assigning a captured variable: the task has its own copy of it.

import { findVariable, isChangedThrough, isFunction, isSpawnCall } from './util.mjs';

const hasUseRegion = (node) =>
  (node.type === 'Program' ? node.body : node.body?.type === 'BlockStatement' ? node.body.body : [])
    .some((statement) => statement.directive === 'use region');

// Whether every value the variable can hold is a plain {} or [] literal: a
// const or a never reassigned let, outside 'use region' functions.
function isPlainData(variable) {
  if (variable.defs.length !== 1) return false;
  const def = variable.defs[0];
  if (def.type !== 'Variable' || def.node.id.type !== 'Identifier') return false;
  const init = def.node.init;
  if (init?.type !== 'ObjectExpression' && init?.type !== 'ArrayExpression') return false;
  if (variable.references.some((r) => r.isWrite() && !r.init)) return false;
  for (let node = def.node; node; node = node.parent) {
    if ((isFunction(node) || node.type === 'Program') && hasUseRegion(node)) return false;
  }
  return true;
}

// Whether the callback gives the object back: `return name` or `(x) => x`.
function returnsVariable(callback, name) {
  if (callback.body.type === 'Identifier') return callback.body.name === name;
  let found = false;
  const visit = (node) => {
    if (found || !node || typeof node.type !== 'string') return;
    if (node !== callback && isFunction(node)) return;
    if (node.type === 'ReturnStatement' && node.argument?.type === 'Identifier' && node.argument.name === name) {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === 'string') visit(child);
    }
  };
  visit(callback.body);
  return found;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow changing plain data that a spawn() task got as a copy' },
    schema: [],
    messages: {
      copy:
        "'{{name}}' is plain data, so the spawn() task works on its own copy: this change never " +
        'reaches the caller. Return the result from the task, or create the object in a region ' +
        '(region.run(() => ...)) so that the task gets the object itself',
      assign:
        "'{{name}}' is a variable of the caller, and the spawn() task has its own copy of it: this " +
        'assignment never reaches the caller. Return the value from the task instead',
    },
  },

  create(context) {
    const { sourceCode } = context;

    return {
      CallExpression(call) {
        if (!isSpawnCall(call)) return;
        const [callback, ...args] = call.arguments;
        if (!callback || !isFunction(callback)) return;
        const callbackScope = sourceCode.getScope(callback);
        const inCallback = (node) => node.range[0] >= callback.range[0] && node.range[1] <= callback.range[1];

        // References in the task to each plain variable of the caller.
        const targets = [];
        callback.params.forEach((param, i) => {
          const arg = args[i];
          if (param.type !== 'Identifier' || arg?.type !== 'Identifier') return;
          const outer = findVariable(sourceCode.getScope(call), arg.name);
          const inner = callbackScope.set.get(param.name);
          if (outer && inner && isPlainData(outer)) targets.push({ name: param.name, variable: inner });
        });
        for (const reference of callbackScope.through) {
          const variable = reference.resolved;
          if (variable?.defs.length && reference.isWrite()) {
            context.report({ node: reference.identifier, messageId: 'assign', data: { name: variable.name } });
          }
          if (variable && isPlainData(variable) && !targets.some((t) => t.variable === variable)) {
            targets.push({ name: variable.name, variable });
          }
        }

        for (const { name, variable } of targets) {
          if (returnsVariable(callback, name)) continue;
          for (const reference of variable.references) {
            if (!inCallback(reference.identifier) || !isChangedThrough(reference.identifier)) continue;
            context.report({ node: reference.identifier, messageId: 'copy', data: { name } });
          }
        }
      },
    };
  },
};
