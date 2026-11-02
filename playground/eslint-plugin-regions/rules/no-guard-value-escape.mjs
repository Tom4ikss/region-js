// Objects of an RwLock can be used only while a guard is held. A reference
// taken from guard.value and used after the guard is released throws
// OwnershipError: "region N is in an RwLock".

import { heldGuards, methodCallOn } from './util.mjs';

// Whether the reference uses the value as an object: `x.a`, `x[i]`, `x.f()`,
// `for (... of x)` or `...x`.
function usesAsObject(identifier) {
  const parent = identifier.parent;
  return (
    (parent.type === 'MemberExpression' && parent.object === identifier) ||
    (parent.type === 'ForOfStatement' && parent.right === identifier) ||
    parent.type === 'SpreadElement'
  );
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow using a reference from guard.value after the guard is released' },
    schema: [],
    messages: {
      escaped:
        "'{{name}}' was taken from '{{guard}}.value' on line {{line}}, and the guard is released before " +
        'this use: it throws OwnershipError. Copy the data you need while the guard is held, or do ' +
        'this work under the guard',
      returned:
        "This returns the RwLock's object from under '{{guard}}', which is released on return: " +
        'any use of the result throws OwnershipError. Return a copy of the data instead',
    },
  },

  create(context) {
    const { sourceCode } = context;
    const declarators = [];
    const releaseCalls = [];

    return {
      VariableDeclarator(node) {
        declarators.push(node);
      },
      CallExpression(node) {
        if (methodCallOn(node, 'release')) releaseCalls.push(node);
      },

      'Program:exit'() {
        for (const guard of heldGuards(sourceCode, declarators, releaseCalls)) {
          if (guard.kind !== 'lock' || !guard.variable) continue;
          for (const reference of guard.variable.references) {
            const value = reference.identifier.parent;
            if (value.type !== 'MemberExpression' || value.object !== reference.identifier) continue;
            if (value.computed || value.property.name !== 'value') continue;
            // `guard.value.a.b`, unless a method is called on it: that makes a new value.
            let top = value;
            while (top.parent.type === 'MemberExpression' && top.parent.object === top) top = top.parent;
            const parent = top.parent;
            if (parent.type === 'CallExpression' && parent.callee === top) continue;

            if (parent.type === 'ReturnStatement' && top === value) {
              context.report({ node: parent, messageId: 'returned', data: { guard: guard.name } });
              continue;
            }
            let target = null;
            if (parent.type === 'AssignmentExpression' && parent.operator === '=' && parent.right === top) {
              target = parent.left;
            } else if (parent.type === 'VariableDeclarator' && parent.init === top) {
              target = parent.id;
            }
            if (target?.type !== 'Identifier') continue;
            const variable = sourceCode
              .getScope(target)
              .references.find((r) => r.identifier === target)?.resolved;
            if (!variable) continue;
            const use = variable.references.find(
              (r) => r.identifier.range[0] >= guard.end && !r.isWrite() && usesAsObject(r.identifier),
            );
            if (!use) continue;
            // Assigned something else in between.
            const reassigned = variable.references.some(
              (r) =>
                r.isWrite() && r.identifier !== target &&
                r.identifier.range[0] > top.range[1] && r.identifier.range[0] < use.identifier.range[0],
            );
            if (reassigned) continue;
            context.report({
              node: use.identifier,
              messageId: 'escaped',
              data: { name: variable.name, guard: guard.name, line: top.loc.start.line },
            });
          }
        }
      },
    };
  },
};
