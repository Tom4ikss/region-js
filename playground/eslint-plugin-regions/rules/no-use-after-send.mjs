// channel.send(x) moves the region of x to the receiver. Touching x after it
// throws OwnershipError at run time; this rule reports it while you type.

import { findVariable, isFrozenAt, methodCallOn, regionSource } from './util.mjs';

const inside = (node, outer) => outer && node.range[0] >= outer.range[0] && node.range[1] <= outer.range[1];

// Whether `a` and `b` are in different branches of one if, ?: or switch.
function inOtherBranch(a, b) {
  for (let node = a.parent; node; node = node.parent) {
    if (node.type === 'IfStatement' || node.type === 'ConditionalExpression') {
      const branches = [node.consequent, node.alternate];
      const ia = branches.findIndex((branch) => inside(a, branch));
      const ib = branches.findIndex((branch) => inside(b, branch));
      if (ia !== -1 && ib !== -1 && ia !== ib) return true;
    }
    if (node.type === 'SwitchStatement') {
      const ia = node.cases.findIndex((c) => inside(a, c));
      const ib = node.cases.findIndex((c) => inside(b, c));
      if (ia !== -1 && ib !== -1 && ia !== ib) return true;
    }
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow using a region after sending it through a channel' },
    schema: [],
    messages: {
      usedAfterSend:
        "'{{name}}' was sent on line {{line}}, and its region moved to the receiver: using it here " +
        'throws OwnershipError. Use it before sending, or freeze the region to share it read-only',
    },
  },

  create(context) {
    const { sourceCode } = context;
    const sends = [];
    const freezeCalls = [];

    return {
      CallExpression(node) {
        if ((methodCallOn(node, 'send') || methodCallOn(node, 'sendSync')) && node.arguments.length === 1) {
          sends.push(node);
        }
        if (methodCallOn(node, 'freeze')) freezeCalls.push({ node, frozen: true });
        if (methodCallOn(node, 'thaw')) freezeCalls.push({ node, frozen: false });
      },

      'Program:exit'() {
        freezeCalls.sort((a, b) => a.node.range[0] - b.node.range[0]);
        for (const call of sends) {
          const [arg] = call.arguments;
          if (arg.type !== 'Identifier') continue;
          const callScope = sourceCode.getScope(call);
          const variable = findVariable(callScope, arg.name);
          if (!variable) continue;
          const region = regionSource(variable);
          if (!region || isFrozenAt(freezeCalls, variable, region, call.range[0])) continue;
          const references = variable.references
            .filter((r) => r.identifier.range[0] > call.range[1])
            .sort((a, b) => a.identifier.range[0] - b.identifier.range[0]);
          for (const reference of references) {
            // A new value from here on: `x = (await ch.recv()).value`.
            if (reference.isWrite()) break;
            // Only code that runs straight after the send, in the same function.
            if (reference.from.variableScope !== callScope.variableScope) continue;
            if (inOtherBranch(call, reference.identifier)) continue;
            context.report({
              node: reference.identifier,
              messageId: 'usedAfterSend',
              data: { name: variable.name, line: call.loc.start.line },
            });
            // The first use already throws.
            break;
          }
        }
      },
    };
  },
};
