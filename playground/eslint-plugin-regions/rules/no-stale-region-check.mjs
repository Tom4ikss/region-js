// `if (region.frozen) { await ...; use(region) }`: while the await waits,
// other code of this thread and other tasks run, and the region can be
// thawed, changed and frozen again. The check no longer says anything, and
// nothing reports it.

import { enclosingFunction, findVariable, regionSource } from './util.mjs';

const STATE = new Set(['frozen', 'frozenHere', 'sealed', 'readers', 'poisoned']);

// `region.frozen` and `Region.of(x).frozen` in the test: the checked
// expression and the variable it starts from.
function checks(test, sourceCode) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'MemberExpression' && !node.computed && STATE.has(node.property.name)) {
      let root = node.object;
      if (
        root.type === 'CallExpression' &&
        root.callee.type === 'MemberExpression' &&
        root.callee.object.type === 'Identifier' &&
        root.callee.object.name === 'Region' &&
        root.callee.property.name === 'of'
      ) {
        root = root.arguments[0];
      }
      while (root?.type === 'MemberExpression') root = root.object;
      if (root?.type === 'Identifier') {
        const variable = findVariable(sourceCode.getScope(node), root.name);
        if (variable) found.push({ text: sourceCode.getText(node), variable });
      }
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === 'string') visit(child);
    }
  };
  visit(test);
  return found;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow relying on a region or lock state checked before an await' },
    schema: [],
    messages: {
      stale:
        "'{{check}}' was checked on line {{line}}, but this await lets other code run first: the " +
        'region can be thawed, changed or frozen again, a lock poisoned or cleared, before the code ' +
        'below uses it. Check again after the await',
    },
  },

  create(context) {
    const { sourceCode } = context;
    const ifs = [];
    const awaits = [];

    return {
      IfStatement(node) {
        ifs.push(node);
      },
      AwaitExpression(node) {
        awaits.push(node);
      },

      'Program:exit'() {
        for (const statement of ifs) {
          const checked = checks(statement.test, sourceCode);
          if (!checked.length) continue;
          const fn = enclosingFunction(statement);
          for (const branch of [statement.consequent, statement.alternate]) {
            if (!branch) continue;
            const first = awaits.find(
              (node) =>
                node.range[0] > branch.range[0] && node.range[1] <= branch.range[1] && enclosingFunction(node) === fn,
            );
            if (!first) continue;
            const check = checked.find(({ variable }) => {
              // Used after the await in the branch, before it is checked
              // again: the checked variable, or an object created in it with
              // `checked.run(...)`.
              const recheck = ifs.find(
                (other) =>
                  other.range[0] > first.range[1] && other.range[1] <= branch.range[1] &&
                  checks(other.test, sourceCode).some((c) => c.variable === variable),
              );
              const end = recheck ? recheck.range[0] : branch.range[1];
              const after = (r) => r.identifier.range[0] > first.range[1] && r.identifier.range[1] <= end;
              if (variable.references.some(after)) return true;
              for (const scope of sourceCode.scopeManager.scopes) {
                for (const other of scope.variables) {
                  if (regionSource(other)?.name === variable.name && other.references.some(after)) return true;
                }
              }
              return false;
            });
            if (!check) continue;
            context.report({
              node: first,
              messageId: 'stale',
              data: { check: check.text, line: statement.loc.start.line },
            });
          }
        }
      },
    };
  },
};
