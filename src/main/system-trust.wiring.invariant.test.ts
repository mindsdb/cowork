import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * trustSystemCertificates (system-trust.ts) adds the operating system's roots to
 * main's Node TLS clients, and only app.ts calls it. Nothing at run time notices
 * a missing call: main's requests keep working on Node's bundled roots until a
 * network that inspects TLS refuses them. A call made before the window exists
 * delays the window instead. This parses app.ts and checks that it imports the
 * function from './system-trust' and uses it once, as a statement of its own,
 * setImmediate(trustSystemCertificates), after createWindow() in the same block.
 * Parsing skips comments and strings, so a commented-out call counts as missing.
 */

const REPO = path.resolve(__dirname, '../..');
const APP = 'src/main/app.ts';
const NAME = 'trustSystemCertificates';

/* One use of trustSystemCertificates outside its import. */
interface TrustUse {
  /* The use is the only argument of setImmediate(...), and that call is a statement of its own. */
  scheduled: boolean;
  /* A createWindow() statement comes earlier in the block that holds the use. */
  afterCreateWindow: boolean;
}

/* How a source file wires trustSystemCertificates. */
interface TrustWiring {
  /* The file imports trustSystemCertificates from './system-trust' under its own name. */
  importedFromSystemTrust: boolean;
  uses: TrustUse[];
}

function isCreateWindowCall(statement: ts.Statement): boolean {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    ts.isIdentifier(statement.expression.expression) &&
    statement.expression.expression.text === 'createWindow'
  );
}

function importsTrust(file: ts.SourceFile): boolean {
  return file.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
    if (statement.moduleSpecifier.text !== './system-trust') return false;
    const bindings = statement.importClause?.namedBindings;
    return (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.name.text === NAME && element.propertyName === undefined)
    );
  });
}

/* Every identifier with this name outside import declarations. */
function identifiersNamed(node: ts.Node, name: string): ts.Identifier[] {
  if (ts.isImportDeclaration(node)) return [];
  if (ts.isIdentifier(node)) return node.text === name ? [node] : [];
  const found: ts.Identifier[] = [];
  node.forEachChild((child) => {
    found.push(...identifiersNamed(child, name));
  });
  return found;
}

/* The statement that holds this node, and the statements of the block or file around it. */
function enclosingStatement(node: ts.Node): { statement: ts.Node; siblings: readonly ts.Statement[] } {
  const holder = node.parent;
  if (ts.isBlock(holder) || ts.isSourceFile(holder)) return { statement: node, siblings: holder.statements };
  return enclosingStatement(holder);
}

function useOf(identifier: ts.Identifier): TrustUse {
  const call = identifier.parent;
  const scheduled =
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'setImmediate' &&
    call.arguments.length === 1 &&
    call.arguments[0] === identifier &&
    ts.isExpressionStatement(call.parent);
  const { statement, siblings } = enclosingStatement(identifier);
  const earlier = siblings.slice(0, siblings.findIndex((sibling) => sibling === statement));
  return { scheduled, afterCreateWindow: earlier.some(isCreateWindowCall) };
}

function trustWiring(source: string): TrustWiring {
  const file = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return { importedFromSystemTrust: importsTrust(file), uses: identifiersNamed(file, NAME).map(useOf) };
}

describe('system trust wiring', () => {
  it('schedules trustSystemCertificates once, with setImmediate, after app.ts creates the window', () => {
    expect(trustWiring(readFileSync(path.join(REPO, APP), 'utf-8'))).toEqual({
      importedFromSystemTrust: true,
      uses: [{ scheduled: true, afterCreateWindow: true }],
    });
  });

  it('counts a commented-out call as missing', () => {
    const sample = [
      "import { trustSystemCertificates } from './system-trust';",
      'createWindow();',
      '// setImmediate(trustSystemCertificates);',
      '/* setImmediate(trustSystemCertificates); */',
    ].join('\n');

    expect(trustWiring(sample)).toEqual({ importedFromSystemTrust: true, uses: [] });
  });

  it('tells a direct call, an early call and a call inside a callback from the scheduled one', () => {
    const sample = [
      "import { trustSystemCertificates } from './system-trust';",
      'async function boot() {',
      '  trustSystemCertificates();',
      '  setImmediate(trustSystemCertificates);',
      '  createWindow();',
      "  app.on('ready', () => setImmediate(trustSystemCertificates));",
      '}',
    ].join('\n');

    expect(trustWiring(sample).uses).toEqual([
      { scheduled: false, afterCreateWindow: false },
      { scheduled: true, afterCreateWindow: false },
      { scheduled: false, afterCreateWindow: true },
    ]);
  });

  it('needs the import from ./system-trust under its own name', () => {
    expect(trustWiring("import { trustSystemCertificates } from './trust';").importedFromSystemTrust).toBe(false);
    expect(trustWiring("import { trustSystemCertificates as trust } from './system-trust';").importedFromSystemTrust).toBe(false);
  });
});
