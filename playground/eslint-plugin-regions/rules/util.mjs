// Helpers shared by the rules.

export const isFunction = (node) =>
  node?.type === 'ArrowFunctionExpression' ||
  node?.type === 'FunctionExpression' ||
  node?.type === 'FunctionDeclaration';

// spawn(), and s.spawn() of spawn.scope() or set.spawn() of JoinSet.
export const isSpawnCall = (node) =>
  node?.type === 'CallExpression' &&
  ((node.callee.type === 'Identifier' && node.callee.name === 'spawn') ||
    (node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.object.type === 'Identifier' &&
      node.callee.property.name === 'spawn'));

export const methodCallOn = (call, name) =>
  call?.type === 'CallExpression' &&
  call.callee.type === 'MemberExpression' &&
  !call.callee.computed &&
  call.callee.property.name === name;

// The function `node` runs in, or the Program.
export function enclosingFunction(node) {
  let current = node.parent;
  while (current && !isFunction(current) && current.type !== 'Program') current = current.parent;
  return current;
}

// The outermost member expression `identifier` is the object of: `x.a.b` for `x`.
export function memberChainTop(identifier) {
  let node = identifier;
  while (node.parent.type === 'MemberExpression' && node.parent.object === node) node = node.parent;
  return node;
}

// Whether `identifier` is the root of a write: `x.a = 1`, `x.a.b++`, `delete x[k]`.
export function isWriteThrough(identifier) {
  const node = memberChainTop(identifier);
  if (node === identifier) return false;
  const parent = node.parent;
  return (
    (parent.type === 'AssignmentExpression' && parent.left === node) ||
    (parent.type === 'UpdateExpression' && parent.argument === node) ||
    (parent.type === 'UnaryExpression' && parent.operator === 'delete' && parent.argument === node)
  );
}

const MUTATING_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
]);

// Whether `identifier` is changed through: a write as above, `x.list.push(1)`
// or `Object.assign(x, ...)`.
export function isChangedThrough(identifier) {
  if (isWriteThrough(identifier)) return true;
  const top = memberChainTop(identifier);
  if (
    top !== identifier &&
    !top.computed &&
    MUTATING_METHODS.has(top.property.name) &&
    top.parent.type === 'CallExpression' &&
    top.parent.callee === top
  ) {
    return true;
  }
  const parent = identifier.parent;
  return (
    parent.type === 'CallExpression' &&
    parent.arguments[0] === identifier &&
    parent.callee.type === 'MemberExpression' &&
    parent.callee.object.type === 'Identifier' &&
    parent.callee.object.name === 'Object' &&
    parent.callee.property.name === 'assign'
  );
}

export function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return null;
}

// The expression a variable's region was created from: `x` in `const v = x.run(...)`.
export function regionSource(variable) {
  for (const def of variable.defs) {
    let init = def.type === 'Variable' ? def.node.init : null;
    if (init?.type === 'AwaitExpression') init = init.argument;
    if (init && methodCallOn(init, 'run')) return init.callee.object;
  }
  return null;
}

// Whether the region of `variable` is frozen at `position`, judging by the
// last freeze()/thaw() before it on `region` or `Region.of(variable)`.
// `freezeCalls` are `{ node, frozen }` sorted by position.
export function isFrozenAt(freezeCalls, variable, region, position) {
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

const LOCK_METHODS = new Set(['read', 'write', 'readSync', 'writeSync', 'tryRead', 'tryWrite']);

// Guards of RwLock and borrows of a frozen region, with the part of the code
// where they are held: to the end of the block for `using`, or to the first
// release() after the declaration. Other declarations are not followed.
export function heldGuards(sourceCode, declarators, releaseCalls) {
  const guards = [];
  for (const declarator of declarators) {
    if (declarator.id.type !== 'Identifier' || !declarator.init) continue;
    let init = declarator.init;
    if (init.type === 'AwaitExpression') init = init.argument;
    if (init.type !== 'CallExpression' || init.callee.type !== 'MemberExpression' || init.callee.computed) continue;
    const method = init.callee.property.name;
    const kind = LOCK_METHODS.has(method) ? 'lock' : method === 'borrow' ? 'borrow' : null;
    if (!kind) continue;
    const declaration = declarator.parent;
    const fn = enclosingFunction(declaration);
    const start = declarator.range[1];
    let end = null;
    if (declaration.kind === 'using' || declaration.kind === 'await using') {
      const block = declaration.parent;
      if (block.type === 'BlockStatement' || block.type === 'Program' || block.type === 'StaticBlock') {
        end = block.range[1];
      } else if (block.type === 'SwitchCase') {
        end = block.parent.range[1];
      }
    } else {
      const release = releaseCalls.find(
        (call) =>
          call.callee.object.type === 'Identifier' &&
          call.callee.object.name === declarator.id.name &&
          call.range[0] > start &&
          enclosingFunction(call) === fn,
      );
      if (release) end = release.range[0];
    }
    if (end === null) continue;
    const variable = sourceCode.getDeclaredVariables(declarator)[0];
    guards.push({ declarator, variable, name: declarator.id.name, kind, fn, start, end });
  }
  return guards;
}
