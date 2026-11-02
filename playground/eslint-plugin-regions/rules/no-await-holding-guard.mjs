// An RwLock guard or a borrow kept across an `await` is held for as long as
// the awaited work takes: writers, or every other task, wait for the lock,
// and thaw() of the borrowed region fails. Like await_holding_lock in clippy.

import { enclosingFunction, heldGuards, methodCallOn } from './util.mjs';

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow await while an RwLock guard or a borrow is held' },
    schema: [],
    messages: {
      lockHeld:
        "'{{name}}' holds the lock across this await: every task that wants the lock waits until " +
        'the awaited work is done. Do the waiting before taking the lock or after releasing it ' +
        '(end the block of the guard or call release())',
      borrowHeld:
        "'{{name}}' keeps the region borrowed across this await: until the awaited work is done " +
        'thaw() fails and thawWhenFree() waits. Read what you need, release the borrow, then wait',
    },
  },

  create(context) {
    const { sourceCode } = context;
    const declarators = [];
    const releaseCalls = [];
    const awaits = [];

    return {
      VariableDeclarator(node) {
        declarators.push(node);
      },
      CallExpression(node) {
        if (methodCallOn(node, 'release')) releaseCalls.push(node);
      },
      AwaitExpression(node) {
        awaits.push(node);
      },
      'ForOfStatement[await=true]'(node) {
        awaits.push(node);
      },

      'Program:exit'() {
        for (const guard of heldGuards(sourceCode, declarators, releaseCalls)) {
          const first = awaits.find(
            (node) =>
              node.range[0] >= guard.start && node.range[0] < guard.end && enclosingFunction(node) === guard.fn,
          );
          if (!first) continue;
          context.report({
            node: first,
            messageId: guard.kind === 'lock' ? 'lockHeld' : 'borrowHeld',
            data: { name: guard.name },
          });
        }
      },
    };
  },
};
