import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * How app.ts loads the main window. The folder check on the OTA cache runs in
 * resolveRendererLoad, which only loadMainRenderer calls, so a load that skips
 * loadMainRenderer (a webContents.reload(), a reload menu role, a renderer
 * self-reload let through, a loadFile of its own) reloads the cached page with
 * no check. Only an unpackaged run may load the main window from the Vite dev
 * server: that page gets the preload bridge, and the token listener adds the
 * bearer token and the window proof to its /api/ requests. In a packaged run,
 * the main window's requests to the local server pass the route check last,
 * after every other gate, and the window's first load waits on no proxy
 * lookup. Before the first
 * window, app.ts registers the file:// handler that reads the cache through
 * the verified manifest.
 *
 * Read from source rather than run: app.ts registers the whole app at import.
 * Parsing skips comments and strings, so a commented-out call counts as missing.
 * ui-updater.lifecycle.test.ts runs what the loads decide, and
 * ui-file-protocol.test.ts and server-token-listener.test.ts run the rest.
 */

const REPO = path.resolve(__dirname, '../..');
const file = ts.createSourceFile('app.ts', readFileSync(path.join(REPO, 'src/main/app.ts'), 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function descendants(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [node];
  node.forEachChild((child) => {
    found.push(...descendants(child));
  });
  return found;
}

const nodes = descendants(file);

function text(node: ts.Node): string {
  return node.getText(file);
}

/* Calls of a method with one of these names, such as `win.loadFile(...)`, in source order. */
function methodCalls(names: readonly string[]): ts.CallExpression[] {
  return nodes.filter((node): node is ts.CallExpression =>
    ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && names.includes(node.expression.name.text));
}

/* Whether `node` holds a call of the function with this name, such as `loadMainRenderer(win)`. */
function callsFunction(node: ts.Node, name: string): boolean {
  return descendants(node).some((child) =>
    ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === name);
}

function enclosingFunction(node: ts.Node): string | null {
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isFunctionDeclaration(at)) return at.name?.text ?? null;
  }
  return null;
}

/* Whether `node` sits in the else branch of an `if` that tests for the main
   window and loads it through loadMainRenderer in its then branch. */
function elseOfMainWindowBranch(node: ts.Node): boolean {
  for (let child = node, at = node.parent; at; child = at, at = at.parent) {
    if (
      ts.isIfStatement(at) &&
      at.elseStatement === child &&
      text(at.expression).includes('mainWindow') &&
      callsFunction(at.thenStatement, 'loadMainRenderer')
    ) {
      return true;
    }
  }
  return false;
}

function functionNamed(name: string): ts.FunctionDeclaration | undefined {
  return nodes.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
}

/* The initializer of the module-level `const` with this name. */
function moduleConst(name: string): ts.Expression | undefined {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    const declaration = statement.declarationList.declarations.find((candidate) => text(candidate.name) === name);
    if (declaration) return declaration.initializer;
  }
  return undefined;
}

/* Whether `node` sits in the then branch of an `if (!packagedRun)`. */
function insideUnpackagedBranch(node: ts.Node): boolean {
  for (let child = node, at = node.parent; at; child = at, at = at.parent) {
    if (ts.isIfStatement(at) && at.thenStatement === child && text(at.expression) === '!packagedRun') return true;
  }
  return false;
}

/* Whether `node` sits inside the module-level declaration of `name`. */
function insideModuleConst(node: ts.Node, name: string): boolean {
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isVariableDeclaration(at) && text(at.name) === name && ts.isSourceFile(at.parent.parent.parent)) return true;
  }
  return false;
}

function isCallStatement(node: ts.Node, name: string): node is ts.ExpressionStatement {
  return (
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === name
  );
}

/* The accelerator and click handler of the menu item with this label. */
function menuItem(label: string): { accelerator: string | null; click: string | null } | null {
  const item = nodes.find((node): node is ts.ObjectLiteralExpression =>
    ts.isObjectLiteralExpression(node) &&
    node.properties.some((property) =>
      ts.isPropertyAssignment(property) && text(property.name) === 'label' &&
      ts.isStringLiteral(property.initializer) && property.initializer.text === label));
  if (!item) return null;
  const property = (name: string) => {
    const found = item.properties.find((candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && text(candidate.name) === name);
    if (!found) return null;
    return ts.isStringLiteral(found.initializer) ? found.initializer.text : text(found.initializer);
  };
  return { accelerator: property('accelerator'), click: property('click') };
}

describe('main window loads in app.ts', () => {
  it('loads a page only in loadMainRenderer, apart from the self-heal that falls back to the recorded bundled load', () => {
    const loads = methodCalls(['loadFile', 'loadURL']).map((call) => ({ in: enclosingFunction(call), call: text(call) }));
    expect(loads).toEqual([
      { in: 'armOtaSelfHeal', call: 'win.loadFile(resolveBundledRendererLoad().path)' },
      { in: 'loadMainRenderer', call: 'win.loadURL(source.url)' },
      { in: 'loadMainRenderer', call: 'win.loadFile(renderer.path)' },
    ]);
  });

  it('decides every file load right before it, and arms the self-heal for an OTA load', () => {
    const load = functionNamed('loadMainRenderer');
    expect(load).toBeDefined();
    for (const name of ['resolveRendererLoad', 'resolveBundledRendererLoad', 'armOtaSelfHeal', 'disarmOtaSelfHeal']) {
      expect(callsFunction(load!, name)).toBe(true);
    }
  });

  it('makes the first load of a window through loadMainRenderer', () => {
    const create = functionNamed('createWindow');
    expect(create).toBeDefined();
    expect(callsFunction(create!, 'loadMainRenderer')).toBe(true);
  });

  it('reloads in place only a window that is not the main window', () => {
    const reloads = methodCalls(['reload', 'reloadIgnoringCache']);
    expect(reloads.map(text)).toEqual([
      'focused.webContents.reloadIgnoringCache()',
      'focused.webContents.reload()',
      'win.webContents.reload()',
    ]);
    for (const reload of reloads) {
      expect(elseOfMainWindowBranch(reload), text(reload)).toBe(true);
    }
  });

  it('has no reload role in the menu, and its Reload items keep the roles\' labels and accelerators', () => {
    const roles = nodes
      .filter((node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node) && text(node.name) === 'role' && ts.isStringLiteral(node.initializer))
      .map((property) => (property.initializer as ts.StringLiteral).text.toLowerCase());
    expect(roles).toContain('toggledevtools');
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('forcereload');

    expect(menuItem('Reload')).toEqual({ accelerator: 'CmdOrCtrl+R', click: '(_item, focused) => reloadFocusedWindow(focused, false)' });
    expect(menuItem('Force Reload')).toEqual({ accelerator: 'Shift+CmdOrCtrl+R', click: '(_item, focused) => reloadFocusedWindow(focused, true)' });
  });

  it('stops a self-reload the page starts and loads the window through loadMainRenderer instead', () => {
    const selfReload = nodes.find((node): node is ts.IfStatement =>
      ts.isIfStatement(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'isSelfReload');
    expect(selfReload).toBeDefined();
    const branch = selfReload!.thenStatement;
    expect(ts.isBlock(branch) ? text(branch.statements[0]) : '').toBe('event.preventDefault();');
    expect(callsFunction(branch, 'loadMainRenderer')).toBe(true);
  });

  it('reloads through loadMainRenderer after a sign-out and after a sign-in that changes the data root', () => {
    const signOut = nodes.find((node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node) && text(node.name) === 'reloadRenderer');
    expect(signOut).toBeDefined();
    expect(callsFunction(signOut!.initializer, 'loadMainRenderer')).toBe(true);

    const everyWindow = nodes.find((node): node is ts.ForOfStatement =>
      ts.isForOfStatement(node) && text(node.expression) === 'BrowserWindow.getAllWindows()' && descendants(node).some((child) => ts.isCallExpression(child) && text(child).endsWith('.reload()')));
    expect(everyWindow).toBeDefined();
    expect(callsFunction(everyWindow!, 'loadMainRenderer')).toBe(true);
  });
});

describe('before the first window', () => {
  const firstWindow = nodes.find((node): node is ts.ExpressionStatement => isCallStatement(node, 'createWindow'));
  const block = firstWindow && ts.isBlock(firstWindow.parent) ? firstWindow.parent : null;
  const statements = block?.statements ?? ts.factory.createNodeArray<ts.Statement>();
  const at = (predicate: (statement: ts.Statement) => boolean) => statements.findIndex(predicate);

  const portResolved = at((statement) => text(statement) === 'await resolveServerPort();');
  const fileHandler = at((statement) => text(statement) === 'registerUiFileProtocol(session.defaultSession);');
  const created = firstWindow ? statements.indexOf(firstWindow) : -1;

  it('resolves the port, registers the file:// handler, then creates the window', () => {
    expect(portResolved).toBeGreaterThan(-1);
    expect(fileHandler).toBeGreaterThan(portResolved);
    expect(created).toBeGreaterThan(fileHandler);
  });

  it('awaits no proxy lookup between the port and the window', () => {
    const between = statements.slice(portResolved + 1, created);
    expect(between.map(text)).toEqual(['registerUiFileProtocol(session.defaultSession);']);
  });
});

describe('the Vite dev server as the main window\'s source', () => {
  it('counts a run as packaged by both signals, once', () => {
    const packaged = moduleConst('packagedRun');
    expect(packaged && text(packaged)).toBe('isPackagedRun({ isPackaged: app.isPackaged, defaultApp: process.defaultApp })');
  });

  it('chooses the dev server only inside an `if (!packagedRun)` in chooseMainRendererSource', () => {
    /* Every 'dev-server' string that builds a source, leaving out the type and the `kind === 'dev-server'` tests. */
    const chosen = nodes.filter((node): node is ts.StringLiteral =>
      ts.isStringLiteral(node) && node.text === 'dev-server' &&
      !ts.isLiteralTypeNode(node.parent) &&
      !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken));
    expect(chosen).toHaveLength(2);
    for (const literal of chosen) {
      const where = `${enclosingFunction(literal)}: ${text(literal.parent.parent)}`;
      expect(enclosingFunction(literal), where).toBe('chooseMainRendererSource');
      expect(insideUnpackagedBranch(literal), where).toBe(true);
    }
  });

  it('reads VITE_DEV only inside an `if (!packagedRun)`', () => {
    const reads = nodes.filter((node) => ts.isPropertyAccessExpression(node) && text(node) === 'process.env.VITE_DEV');
    expect(reads).toHaveLength(1);
    expect(insideUnpackagedBranch(reads[0])).toBe(true);
  });

  it('reads DEV_MODE=live as unset in a packaged run', () => {
    const read = functionNamed('getDevMode');
    expect(read).toBeDefined();
    const ignored = descendants(read!).find((node): node is ts.IfStatement =>
      ts.isIfStatement(node) && text(node.expression) === "val === 'live' && packagedRun");
    expect(ignored).toBeDefined();
    const branch = ignored!.thenStatement;
    const last = ts.isBlock(branch) ? branch.statements[branch.statements.length - 1] : undefined;
    expect(last && text(last)).toBe('return null;');
  });

  it("derives the window's source and Vite's port from one decision in createWindow", () => {
    const create = functionNamed('createWindow');
    expect(create).toBeDefined();
    const top = create!.body?.statements.map(text) ?? [];
    expect(top).toEqual(expect.arrayContaining([
      'const source = chooseMainRendererSource();',
      'mainRendererSource = source;',
      "const viteDevPort = source.kind === 'dev-server' ? source.port : null;",
    ]));
    const assignments = nodes.filter((node) =>
      ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && text(node.left) === 'mainRendererSource');
    expect(assignments.map((node) => ({ in: enclosingFunction(node), assignment: text(node) }))).toEqual([
      { in: 'createWindow', assignment: 'mainRendererSource = source' },
    ]);
  });

  it('lets the window reload from the dev server only in an unpackaged run', () => {
    const checks = nodes.filter((node): node is ts.CallExpression =>
      ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'isDevServerNavigation');
    expect(checks.map((check) => text(check.parent))).toEqual(['!packagedRun && isDevServerNavigation(url, viteDevPort)']);
  });
});

describe("the route check on the main window's requests to the local server", () => {
  it('runs in a packaged run without an active Node inspector, asks the default session, and logs a refusal', () => {
    const gate = moduleConst('loopbackRouteGate');
    expect(gate && ts.isConditionalExpression(gate)).toBe(true);
    const { condition, whenTrue, whenFalse } = gate as ts.ConditionalExpression;
    expect(text(condition)).toBe('packagedRun && inspector.url() === undefined');
    expect(text(whenFalse)).toBe('null');
    expect(ts.isCallExpression(whenTrue) && text(whenTrue.expression)).toBe('requireDirectRoute');
    expect((whenTrue as ts.CallExpression).arguments.map(text)).toEqual([
      'getServerPort',
      '(url) => session.defaultSession.resolveProxy(url)',
      "() => diagnostic('main.launch-guard', 'ERROR', 'launch_guard_refused_loopback_proxied')",
    ]);
  });

  it('asks how a request is routed nowhere else, so nothing waits on a lookup before the window', () => {
    const lookups = methodCalls(['resolveProxy']);
    expect(lookups).toHaveLength(1);
    expect(insideModuleConst(lookups[0], 'loopbackRouteGate')).toBe(true);
  });

  it('puts the route check last among the gates of the token listener, after the start hold and the Minds gate', () => {
    const wrapper = functionNamed('beforeLoopbackRouteCheck');
    expect(wrapper).toBeDefined();
    expect(wrapper!.body?.statements.map(text)).toEqual(['return loopbackRouteGate ? gatesInOrder(gate, loopbackRouteGate) : gate;']);

    const gates = nodes.filter((node): node is ts.PropertyAssignment =>
      ts.isPropertyAssignment(node) && text(node.name) === 'gate' &&
      ts.isObjectLiteralExpression(node.parent) && ts.isCallExpression(node.parent.parent) && text(node.parent.parent.expression) === 'serverTokenListener');
    expect(gates).toHaveLength(1);
    const wrapped = gates[0].initializer;
    expect(ts.isCallExpression(wrapped) && text(wrapped.expression)).toBe('beforeLoopbackRouteCheck');
    const [chain] = (wrapped as ts.CallExpression).arguments;
    expect(ts.isCallExpression(chain) && text(chain.expression)).toBe('gatesInOrder');
    const [startHold, mindsGate] = (chain as ts.CallExpression).arguments;
    expect(text(startHold)).toBe('holdWhileServerStarts(getServerPort, untilServerStartSettles)');
    expect(callsFunction(mindsGate, 'gateMindsResponseCreationRequest')).toBe(true);
  });

  it('uses the route check only in beforeLoopbackRouteCheck, so no other chain puts it ahead of a gate', () => {
    const uses = nodes.filter((node) =>
      ts.isIdentifier(node) && node.text === 'loopbackRouteGate' && !ts.isVariableDeclaration(node.parent));
    expect(uses.map(enclosingFunction)).toEqual(['beforeLoopbackRouteCheck', 'beforeLoopbackRouteCheck']);
  });
});
