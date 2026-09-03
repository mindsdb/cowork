// Every surface that names a project must route through `projectLabel`.
//
// The helper's unit tests pass whether or not a caller uses it, and each new
// surface is a new caller — the same failure that let the onboarding screen
// carry ENG-2109's bug unreported. So this asserts the wiring.
//
// It deliberately does NOT ban `project.name` outright: most reads of it are
// correct. Task and schedule matching, the pinned set, draft keys, the
// reserved-project check and the rename-in-progress selector are all keys and
// must keep using the slug. What this pins is that each surface consults the
// resolver at all, and that the specific spots which render or seed text do
// not read the raw field.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RENDERER = resolve(import.meta.dirname, '../../');

const SURFACES = [
  ['projects list + detail', 'cowork/views/ProjectsView.jsx'],
  ['project card', 'cowork/components/project/ProjectCard.jsx'],
  ['chat breadcrumb', 'cowork/views/ChatView.jsx'],
  ['artifact card label', 'cowork/lib/artifactProject.js'],
  // The next three were each found by sweeping rather than by a report, and
  // the first two were already fixed in this PR while this list still omitted
  // them -- so reverting the Composer picker to `{p.name}` passed the whole
  // suite. A guard whose argument is "each new surface is a new caller" has to
  // enumerate the callers it just found.
  ['composer project picker', 'cowork/components/Composer.jsx'],
  ['move-to-project dialog', 'cowork/components/MoveToProjectModal.jsx'],
  ['mobile drawer (the sidebar below 640px)', 'cowork/components/MobileShell.jsx'],
  ['artifacts view open-project tooltip', 'cowork/views/ArtifactsView.jsx'],
];

/*
 * Where a project name is READ FOR A HUMAN. Keyed on the attribute, not on the
 * variable: the first version required the variable to be literally `project`,
 * so every one of these files -- which all iterate `p` -- slipped through, and
 * `primary={p.name || p.path}` in the mobile drawer was invisible to it twice.
 *
 * Matched per line so a template literal's own `}` cannot end the match early
 * (`content={`Open ${x.name}`}` is exactly that shape).
 */
//
// Scoped to project-ish identifiers. Fully variable-agnostic was tried and is
// too blunt: these same files render `attachment.name`, `c.name` (a
// connection), `model.name` and `s.name` (a schedule), none of which this rule
// has any business policing. The names below are what a project is actually
// called in this codebase; a future file that calls one `p` and means
// something else gets a false positive, which is the safe direction to fail.
const PROJECT_VAR = '(?:project|proj|p|activeProject|projectMatch|selectedProject|detailProject)';
const DISPLAY_ATTR = new RegExp(
  `\\b(?:primary|secondary|label|title|content|placeholder|defaultValue)=\\{[^\\n]*?\\b${PROJECT_VAR}\\??\\.name\\b`,
);
const JSX_CHILD = new RegExp(`>\\{\\s*${PROJECT_VAR}\\??\\.name\\b[^\\n]*?\\}\\s*<`);

describe.each(SURFACES)('%s', (_name, rel) => {
  const src = readFileSync(resolve(RENDERER, rel), 'utf-8');

  it('routes the project name through projectLabel', () => {
    expect(src).toContain('projectLabel');
  });

  it('never reads a project name for a human to see', () => {
    /*
     * Rename seeds, visible text, and display attributes together -- they are
     * one defect class. Keys, comparisons, `draftKey` and the pinned set are
     * untouched by design: those address a project and must keep the slug.
     */
    const offenders = src
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => DISPLAY_ATTR.test(line) || JSX_CHILD.test(line))
      .map(([n, line]) => `${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
