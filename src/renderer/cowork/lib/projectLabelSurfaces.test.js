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
];

describe.each(SURFACES)('%s', (_name, rel) => {
  const src = readFileSync(resolve(RENDERER, rel), 'utf-8');

  it('routes the project name through projectLabel', () => {
    expect(src).toContain('projectLabel');
  });

  it('never seeds a rename field from the raw slug', () => {
    /*
     * The trap in a half-done switch: the label shows the typed name while the
     * edit box prefills the slug, so saving unchanged silently overwrites the
     * user's name with `untitled-project-2`.
     */
    expect([...src.matchAll(/defaultValue=\{project\??\.name\}/g)].map((m) => m[0])).toEqual([]);
  });

  it('never renders the raw slug as visible text', () => {
    // `{project.name}` as a JSX child or inside a template literal that is
    // rendered. Key comparisons (`=== project.name`) are untouched by design.
    expect([...src.matchAll(/>\{project\??\.name\}</g)].map((m) => m[0])).toEqual([]);
  });
});
