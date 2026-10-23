/*
 * Checks the slide preview's code and the repository's dependencies against
 * code-checks.yaml. The bundle half builds render.ts into one IIFE, the way
 * the preview bundle generator builds each type, minified and not, and checks
 * it is one chunk that holds the renderer; generatedBundles.test.ts checks the
 * bundle that ships against the shared ban list. The source
 * half reads each renderer file. The package half reads package.json and
 * package-lock.json.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

import { PREVIEW_LABEL } from './styles';

interface CodeCheck {
  name: string;
  pattern: string;
  flags?: string;
  /* Code the pattern must match. */
  catches?: string[];
}

interface CodeChecks {
  source: CodeCheck[];
  packages: CodeCheck[];
}

/* The parts of package.json and package-lock.json that name packages. */
interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageLock {
  /* Keyed by install path, such as node_modules/a/node_modules/b; '' is the root. */
  packages: Record<string, unknown>;
}

interface Bundle {
  chunks: string[];
  assets: string[];
}

const REPO_ROOT = join(__dirname, '../../../../../..');
const CHECKS = load(readFileSync(join(__dirname, 'code-checks.yaml'), 'utf8')) as CodeChecks;
const SOURCE_FILES = readdirSync(__dirname).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
const NODE_MODULES = 'node_modules/';

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, file), 'utf8')) as T;
}

/* Every package the manifest names or the lock installs. */
function packageNames(): string[] {
  const manifest = readJson<PackageManifest>('package.json');
  const lock = readJson<PackageLock>('package-lock.json');
  const installed = Object.keys(lock.packages)
    .filter((path) => path.includes(NODE_MODULES))
    .map((path) => path.slice(path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length));
  return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {}), ...installed];
}

async function bundle(minify: boolean): Promise<Bundle> {
  const result = await build({
    configFile: false,
    envDir: false,
    logLevel: 'silent',
    root: REPO_ROOT,
    build: {
      write: false,
      minify,
      lib: { entry: join(__dirname, 'render.ts'), formats: ['iife'], name: 'pptxPreview' },
    },
  });
  const files = (Array.isArray(result) ? result : [result]).flatMap((output) => ('output' in output ? output.output : []));
  return {
    chunks: files.flatMap((file) => (file.type === 'chunk' ? [file.code] : [])),
    assets: files.flatMap((file) => (file.type === 'asset' ? [file.fileName] : [])),
  };
}

describe.each([true, false])('the pptx preview bundle (minify: %s)', (minify) => {
  let output: Bundle;

  beforeAll(async () => {
    output = await bundle(minify);
  });

  it('is one chunk with no other file, holding the renderer', () => {
    expect(output.chunks).toHaveLength(1);
    expect(output.assets).toEqual([]);
    expect(output.chunks[0]).toContain(PREVIEW_LABEL);
  });
});

describe('the pptx renderer source', () => {
  it('has files to check', () => {
    expect(SOURCE_FILES).toContain('render.ts');
  });

  it.each(CHECKS.source.filter((check) => check.catches))('check for $name catches each spelling it lists', ({ pattern, flags, catches }) => {
    for (const code of catches ?? []) expect(code).toMatch(new RegExp(pattern, flags));
  });

  describe.each(SOURCE_FILES)('%s', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');

    it.each(CHECKS.source)('holds no $name', ({ pattern, flags }) => {
      expect(source).not.toMatch(new RegExp(pattern, flags));
    });
  });
});

describe('the dependencies', () => {
  const names = packageNames();

  it('are read from the manifest and the lock, jszip among them', () => {
    expect(names).toContain('jszip');
  });

  it.each(CHECKS.packages)('hold no $name', ({ pattern, flags }) => {
    const banned = new RegExp(pattern, flags);
    expect(names.filter((name) => banned.test(name))).toEqual([]);
  });
});
