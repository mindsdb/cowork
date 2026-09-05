// Check the workflow seam: each ring must pass its intended MindsHub host through the installer
// aggregator.
// Main and renderer defaults differ, so omission can split authentication and API environments
// despite passing unit tests.
// Hand-parse YAML rather than rely on electron-builder's transitive js-yaml dependency.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const WORKFLOWS = `${REPO}/.github/workflows`;

/** The reusable workflows that bake an environment into a shipped installer. */
const PLATFORM_BUILDS = ['build-macos-pkg.yml', 'build-windows-installer.yml'];

/** The one workflow every ring goes through to reach them. */
const AGGREGATOR = 'build-installers.yml';

/** Which host each ring must be built against. `preview` is the dev/PR ring. */
const HOST_FOR_KIND: Record<string, string> = {
  prod: 'https://api.mindshub.ai',
  stable: 'https://api.staging.mindshub.ai',
  preview: 'https://api.staging.mindshub.ai',
};

/** The per-event pipelines, one per ring. */
const RINGS = ['prod-build-deploy.yml', 'staging-build-deploy.yml', 'dev-build-deploy.yml'];

interface CallSite {
  workflow: string;
  uses: string;
  inputs: Record<string, string>;
}

/** Read uses calls and sibling with blocks until job-level dedent; inputs sit one level deeper. */
function callSites(workflow: string, targets: string[]): CallSite[] {
  const text = readFileSync(`${WORKFLOWS}/${workflow}`, 'utf-8');
  const sites: CallSite[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const usesMatch = /^(\s*)uses:\s*\.\/\.github\/workflows\/([a-z-]+\.yml)\s*$/.exec(lines[i]);
    if (!usesMatch) continue;
    const [, indent, target] = usesMatch;
    if (!targets.includes(target)) continue;

    const inputs: Record<string, string> = {};
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const lineIndent = /^\s*/.exec(line)?.[0].length ?? 0;
      if (lineIndent < indent.length) break; // dedented out of the job
// with/secrets/if are siblings of uses, not inputs.
      if (lineIndent === indent.length) {
        if (/^\s*uses:/.test(line)) break;
        continue;
      }
      const kv = /^\s*([a-z_]+):\s*(\S.*?)\s*$/.exec(line);
      if (kv) inputs[kv[1]] = kv[2];
    }
    sites.push({ workflow, uses: target, inputs });
  }
  return sites;
}

describe('installer workflows bake an environment', () => {
  const ringSites = RINGS.flatMap((w) => callSites(w, [AGGREGATOR]));

  it('finds every ring call site (guards the parser itself)', () => {
    // Assert parser coverage before checking values so a parser regression cannot make these tests
    // vacuous.
    expect(ringSites).toHaveLength(3);
    for (const w of RINGS) {
      expect(ringSites.filter((s) => s.workflow === w)).toHaveLength(1);
    }
  });

  it.each(RINGS)('%s states minds_api_url when it builds installers', (workflow) => {
    // The actual defect: the dev ring omitted it entirely, which is silent at
    // build time and only shows up as a login that never completes.
    for (const site of callSites(workflow, [AGGREGATOR])) {
      expect(site.inputs.minds_api_url, `${workflow} -> ${site.uses} must state minds_api_url`).toBeTruthy();
    }
  });

  it('points each ring at the environment it is meant to test', () => {
    // A prod build must reach production, and a non-prod build must never
    // reach it: that is what makes a green staging run mean anything.
    for (const site of ringSites) {
      const kind = site.inputs.build_kind;
      expect(Object.keys(HOST_FOR_KIND), `unknown build_kind "${kind}"`).toContain(kind);
      expect(site.inputs.minds_api_url, `${site.workflow} -> ${site.uses} (${kind})`).toBe(HOST_FOR_KIND[kind]);
    }
  });

  it('builds prod against prod', () => {
    const prod = ringSites.filter((s) => s.inputs.build_kind === 'prod');
    expect(prod).toHaveLength(1);
    for (const site of prod) expect(site.inputs.minds_api_url).toBe('https://api.mindshub.ai');
  });

  it('the aggregator passes the host through rather than choosing one', () => {
    // The hop added by folding the installers into the pipelines is only safe if
    // it is transparent. A literal here would silently override every ring.
    const sites = callSites(AGGREGATOR, PLATFORM_BUILDS);
    expect(sites, 'build-installers.yml must call both platform builds').toHaveLength(2);
    for (const site of sites) {
      expect(site.inputs.minds_api_url, `${AGGREGATOR} -> ${site.uses}`).toBe('${{ inputs.minds_api_url }}');
      expect(site.inputs.build_kind, `${AGGREGATOR} -> ${site.uses}`).toBe('${{ inputs.build_kind }}');
    }
  });

  it.each([...PLATFORM_BUILDS, AGGREGATOR])('%s requires minds_api_url and gives it no default', (workflow) => {
    // Require an explicit host: a production default would silently send an omitted non-prod
    // configuration to production.
    const text = readFileSync(`${WORKFLOWS}/${workflow}`, 'utf-8');
    const block = /^ {6}minds_api_url:\s*\n([\s\S]*?)\n {6}[a-z_]+:/m.exec(text);
    expect(block, `${workflow} must declare a minds_api_url input`).not.toBeNull();
    // Anchored to the key's own indent: the prose above it mentions defaults,
    // and an unanchored /default:/ matches that instead of the YAML key.
    expect(block?.[1]).toMatch(/^ {8}required:\s*true$/m);
    expect(block?.[1]).not.toMatch(/^ {8}default:/m);
  });
});
