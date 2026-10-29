// A region captured by spawn() (or passed to it) is moved into the task and
// comes back when the task finishes. Touching it in between throws
// OwnershipError at run time; this rule reports it while you type.

const isFunction = (node) =>
  node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';

const isSpawnCall = (node) =>
  node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'spawn';

const isStatementOrFunction = (node) =>
  node.type.endsWith('Statement') || node.type.endsWith('Declaration') || isFunction(node) ||
  node.type === 'Program';

const methodCallOn = (call, name) =>
  call.type === 'CallExpression' &&
  call.callee.type === 'MemberExpression' &&
  !call.callee.computed &&
  call.callee.property.name === name;

// Whether `identifier` is the root of a write: `x.a = 1`, `x.a.b++`, `delete x[k]`.
function isWriteThrough(identifier) {
  let node = identifier;
  while (node.parent.type === 'MemberExpression' && node.parent.object === node) node = node.parent;
  if (node === identifier) return false;
  const parent = node.parent;
  return (
    (parent.type === 'AssignmentExpression' && parent.left === node) ||
    (parent.type === 'UpdateExpression' && parent.argument === node) ||
    (parent.type === 'UnaryExpression' && parent.operator === 'delete' && parent.argument === node)
  );
}

function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow using a region captured by spawn() before the task has finished',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Report every captured variable, not only the ones created with region.run().
          checkAllCaptures: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      usedWhileSpawned:
        "'{{name}}' was moved into the spawn() task on line {{line}} and comes back only when it finishes: " +
        'using it here throws OwnershipError. Wait for the task first (await it or call join()).',
      writeToFrozen:
        "'{{name}}' is in a frozen region: tasks can read it but writing throws OwnershipError. " +
        'Thaw it first, or let one task own it instead of freezing.',
      spawnedInLoop:
        "This spawn() runs repeatedly and every task wants to move '{{name}}': only the first one gets it, " +
        'the next ones throw OwnershipError. Await each task, freeze the region to share it read-only, ' +
        'or give every task its own data.',
    },
  },

  create(context) {
    const checkAllCaptures = context.options[0]?.checkAllCaptures ?? false;
    const { sourceCode } = context;
    const spawnCalls = [];
    const freezeCalls = [];

    // The expression a variable's region was created from: `x` in `const v = x.run(...)`.
    function regionSource(variable) {
      for (const def of variable.defs) {
        let init = def.type === 'Variable' ? def.node.init : null;
        if (init?.type === 'AwaitExpression') init = init.argument;
        if (init && methodCallOn(init, 'run')) return init.callee.object;
      }
      return null;
    }

    // Whether the region of `variable` is frozen at `position`, judging by the
    // last freeze()/thaw() before it on `region` or `Region.of(variable)`.
    function isFrozenAt(variable, region, position) {
      let frozen = false;
      for (const { node, frozen: freezes } of freezeCalls) {
        if (node.range[0] > position) break;
        const target = node.callee.object;
        const onRegion =
          region?.type === 'Identifier' && target.type === 'Identifier' && target.name === region.name;
        const onRegionOf =
          methodCallOn(target, 'of') &&
          target.callee.object.type === 'Identifier' &&
          target.callee.object.name === 'Region' &&
          target.arguments[0]?.type === 'Identifier' &&
          target.arguments[0].name === variable.name;
        if (onRegion || onRegionOf) frozen = freezes;
      }
      return frozen;
    }

    function capturedVariables(call) {
      const captured = new Set();
      const [callback, ...args] = call.arguments;
      if (callback && isFunction(callback)) {
        for (const reference of sourceCode.getScope(callback).through) {
          if (reference.resolved?.defs.length) captured.add(reference.resolved);
        }
      }
      for (const arg of args) {
        if (arg.type !== 'Identifier') continue;
        const variable = findVariable(sourceCode.getScope(call), arg.name);
        if (variable?.defs.length) captured.add(variable);
      }
      return captured;
    }

    // Where the task is known to be finished: the end of an `await` or `join()`
    // around the call, or the first later use of the handle it was stored in.
    function taskEnd(call) {
      for (let node = call; node.parent && !isStatementOrFunction(node.parent); node = node.parent) {
        const parent = node.parent;
        if (parent.type === 'AwaitExpression') return parent.range[1];
        if (
          parent.type === 'MemberExpression' &&
          parent.object === node &&
          parent.parent.type === 'CallExpression' &&
          parent.parent.callee === parent &&
          methodCallOn(parent.parent, 'join')
        ) {
          return parent.parent.range[1];
        }
        if (parent.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'Identifier') {
          const handle = findVariable(sourceCode.getScope(parent), parent.id.name);
          const later = handle.references
            .map((reference) => reference.identifier.range[0])
            .filter((start) => start > call.range[1]);
          return later.length ? Math.min(...later) : Number.POSITIVE_INFINITY;
        }
      }
      return Number.POSITIVE_INFINITY;
    }

    // The reference runs in the caller's function, or in a spawn() callback
    // started from it, which needs the region at once.
    function runsBeforeTaskEnds(reference, callerScope) {
      for (let scope = reference.from.variableScope; scope; scope = scope.upper) {
        if (scope === callerScope) return true;
        const block = scope.block;
        if (
          isFunction(block) &&
          isSpawnCall(block.parent) &&
          block.parent.arguments[0] === block &&
          sourceCode.getScope(block.parent).variableScope === callerScope
        ) {
          return true;
        }
        if (scope.type === 'function') return false;
      }
      return false;
    }

    const ITERATING_METHODS = new Set([
      'map', 'forEach', 'flatMap', 'filter', 'some', 'every', 'reduce', 'reduceRight', 'find', 'findIndex',
    ]);

    // Whether `call` can run several times before its tasks finish: inside a
    // loop or an array-iteration callback that does not await between runs.
    function runsRepeatedly(call) {
      for (let node = call.parent; node && node.type !== 'Program'; node = node.parent) {
        if (node.type === 'AwaitExpression') return false;
        if (/^(For|ForIn|ForOf|While|DoWhile)Statement$/.test(node.type)) return true;
        if (isFunction(node)) {
          const caller = node.parent;
          return (
            caller?.type === 'CallExpression' &&
            caller.arguments.includes(node) &&
            caller.callee.type === 'MemberExpression' &&
            ITERATING_METHODS.has(caller.callee.property.name)
          );
        }
      }
      return false;
    }

    return {
      CallExpression(node) {
        if (isSpawnCall(node)) spawnCalls.push(node);
        if (methodCallOn(node, 'freeze')) freezeCalls.push({ node, frozen: true });
        if (methodCallOn(node, 'thaw')) freezeCalls.push({ node, frozen: false });
      },

      'Program:exit'() {
        freezeCalls.sort((a, b) => a.node.range[0] - b.node.range[0]);
        for (const call of spawnCalls) {
          const end = taskEnd(call);
          const awaitedAtOnce = end <= call.range[1];
          const callerScope = sourceCode.getScope(call).variableScope;
          for (const variable of capturedVariables(call)) {
            const region = regionSource(variable);
            if (!region && !checkAllCaptures) continue;
            if (isFrozenAt(variable, region, call.range[0])) {
              for (const reference of variable.references) {
                const start = reference.identifier.range[0];
                if (start > call.range[0] && start < call.range[1] && isWriteThrough(reference.identifier)) {
                  context.report({ node: reference.identifier, messageId: 'writeToFrozen', data: { name: variable.name } });
                }
              }
              continue;
            }
            if (awaitedAtOnce) continue;
            if (runsRepeatedly(call)) {
              context.report({ node: call, messageId: 'spawnedInLoop', data: { name: variable.name } });
            }
            for (const reference of variable.references) {
              const start = reference.identifier.range[0];
              // Code in other functions may run after the task; only report uses
              // that run straight after spawn() in the same function, or in
              // another spawn() callback started there.
              if (start <= call.range[1] || start >= end) continue;
              if (!runsBeforeTaskEnds(reference, callerScope)) continue;
              context.report({
                node: reference.identifier,
                messageId: 'usedWhileSpawned',
                data: { name: variable.name, line: call.loc.start.line },
              });
            }
          }
        }
      },
    };
  },
};
