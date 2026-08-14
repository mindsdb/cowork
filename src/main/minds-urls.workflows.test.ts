// Guards the build-time half of MindsHub host resolution.
//
// minds-urls.ts (main) and renderer/lib/mindsUrls.ts are each correct on their
// own, and each is unit-tested. What broke was the seam between them: both are
// fed from ONE build input, `minds_api_url`, and when a caller omitted it they
// fell back to DIFFERENT environments. Only main can see the build kind, so it
// fell back on that (preview -> staging) while the renderer, which cannot,
// fell back to production. The app then ran Keycloak against one environment
// and the session against the other, and login could never succeed. The dev/PR
// ring shipped that way; staging and prod were fine only because they happened
// to state the input.
//
// No unit test can catch that, because the defect lives in workflow YAML. So
// this asserts the two properties that make the seam safe: every caller states
// the input, and the value it states matches the ring it is building for.
//
// The shape changed when the installer builds were folded into the per-event
// pipelines (ENG-1053). There is now one hop: each ring's pipeline calls
// `build-installers.yml`, which calls the two platform builds. The invariant is
// unchanged and there are fewer places to state it, so this checks both halves:
// each ring states the right host, and the aggregator passes it through rather
// than substituting a value of its own.
//
// Deliberately hand-parsed: js-yaml is only present transitively (via
// electron-builder) and could disappear on any bump, which is not a dependency
// this guard should own.
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

/** Every `uses: ./.github/workflows/<target>.yml` in a file, with the `with:`
 *  inputs that follow it. Indentation-scoped: `with:` is a SIBLING of `uses:`
 *  (both under the job), and the inputs sit one level deeper, so the block runs
 *  until the line that dedents out of the job. */
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
      // `with:` / `secrets:` / `if:` are siblings of `uses:`, not inputs. A
      // second `uses:` at this level would be the next job's call.
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
    // Three rings, each reaching the installers exactly once. If this drops, the
    // parser stopped understanding the YAML and every assertion below went
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
    // Required rather than defaulted, on purpose. A default cannot be both
    // safe and honest here: the only safe value is production (it is what the
    // renderer falls back to anyway), but then a caller that forgets gets a
    // signed installer silently pointed at production instead of a red build.
    // Requiring it turns that into a run that refuses to start.
    const text = readFileSync(`${WORKFLOWS}/${workflow}`, 'utf-8');
    const block = /^ {6}minds_api_url:\s*\n([\s\S]*?)\n {6}[a-z_]+:/m.exec(text);
    expect(block, `${workflow} must declare a minds_api_url input`).not.toBeNull();
    // Anchored to the key's own indent: the prose above it mentions defaults,
    // and an unanchored /default:/ matches that instead of the YAML key.
    expect(block?.[1]).toMatch(/^ {8}required:\s*true$/m);
    expect(block?.[1]).not.toMatch(/^ {8}default:/m);
  });
});
