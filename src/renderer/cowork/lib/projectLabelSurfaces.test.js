// Guard display-label call sites; project.name must still serve addressing, matching, draft keys
// and reserved-name checks.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RENDERER = resolve(import.meta.dirname, '../../');

const SURFACES = [
  ['projects list + detail', 'cowork/views/ProjectsView.jsx'],
  ['project card', 'cowork/components/project/ProjectCard.jsx'],
  ['chat breadcrumb', 'cowork/views/ChatView.jsx'],
  ['artifact card label', 'cowork/lib/artifactProject.js'],
  ['composer project picker', 'cowork/components/Composer.jsx'],
  ['move-to-project dialog', 'cowork/components/MoveToProjectModal.jsx'],
  ['mobile drawer (the sidebar below 640px)', 'cowork/components/MobileShell.jsx'],
  ['artifacts view open-project tooltip', 'cowork/views/ArtifactsView.jsx'],
  ['task list open-project tooltip', 'cowork/views/TasksView.jsx'],
  ['scheduled list', 'cowork/views/ScheduledView.jsx'],
  ['schedule card', 'cowork/components/schedule/ScheduleCard.jsx'],
  ['schedule detail hint', 'cowork/views/ScheduleDetailView.jsx'],
  ['channel bindings', 'cowork/views/ChannelBindings.jsx'],
  // These surfaces hold slug strings rather than project objects and need projectLabelByName.
  ['skills scope picker + card + detail', 'cowork/views/SkillsView.jsx'],
  ['recents modal', 'cowork/components/RecentsModal.jsx'],
  ['rail context card heading', 'cowork/components/rail/ContextCard.jsx'],
  ['utilities / memory headings', 'cowork/views/UtilitiesView.jsx'],
  // Found only by running the rules across the whole renderer rather than
  // across the list itself.
  ['schedule task modal picker', 'cowork/components/schedule/ScheduleTaskModal.jsx'],
  // Exclude DataVaultFormPanel: its PostHog project objects are third-party records, not Cowork
  // projects with display_name.
  // Check domain identity before adding a similarly named field to this guard.
];

/*
 * Match display attributes regardless of project variable spelling.
 * Keep matching line-scoped so nested template braces cannot prematurely end the expression.
 */
// Restrict identifiers to project-like names; attachments, connections, models and schedules also
// legitimately use name.
const PROJECT_VAR = '(?:project|proj|p|activeProject|projectMatch|selectedProject|detailProject)';
const DISPLAY_ATTR = new RegExp(
  `\\b(?:primary|secondary|label|title|content|placeholder|defaultValue)=\\{[^\\n]*?\\b${PROJECT_VAR}\\??\\.name\\b`,
);
const JSX_CHILD = new RegExp(`>\\{\\s*${PROJECT_VAR}\\??\\.name\\b[^\\n]*?\\}\\s*<`);

/*
 * BARE_INTERP catches standalone label interpolation but excludes comparisons.
 * LAUNDERED catches slug assignment to display locals before JSX hides the original field read.
 */
const BARE_INTERP = new RegExp(`\\$\\{\\s*${PROJECT_VAR}\\??\\.name\\s*\\}`);
// Known limitation: new slug-local names need adding to the allowlist.
// A broad project-prefix regex cannot distinguish value reads from lookup predicates without a
// parser.
const LAUNDERED = /\bconst\s+project(?:Name|Label|Title|Display)\s*=\s*[^;\n]*\.name\b/;

/*
 * RENDERED_SLUG_LOCAL catches display of locals derived from task.projectName/project, which .name
 * rules miss.
 * Those locals remain valid for lookup/truthiness; render the separately resolved label.
 */
const RENDERED_SLUG_LOCAL = new RegExp(
  '(?:>\\{\\s*projectName\\s*\\}'
  // Exclude interpolation adjacent to slash because it addresses a URL or dedupe key rather than a
  // label.
  + '|(?<![/])\\$\\{\\s*projectName\\s*\\}(?![/])'
  + '|\\)\\s*:\\s*projectName\\b'
  + '|\\b(?:primary|secondary|label|title|content|placeholder|defaultValue)=\\{\\s*projectName\\s*\\})',
);

/*
 * SLUG_FIELD covers projectName display while exempting React keys.
 * OBJECT_LABEL distinguishes readable label from persisted value; STORED_SLUG_ARRAY catches direct
 * skill-project array rendering.
 */
const SLUG_FIELD = new RegExp(
  '(?:>\\{[^}\\n]*\\.projectName\\b[^}\\n]*\\}'
  + '|\\$\\{[^}\\n]*\\.projectName\\b[^}\\n]*\\}'
  + '|\\b(?:primary|secondary|label|title|content|heading|placeholder|defaultValue)=\\{[^}\\n]*\\.projectName\\b)',
);
const OBJECT_LABEL = new RegExp(`\\blabel:\\s*${PROJECT_VAR}\\??\\.name\\b`);
// Catch rendered array elements without banning correct slug storage in draft state.
const STORED_SLUG_ARRAY = new RegExp(
  '(?:^\\s*|>\\s*)\\{[^}\\n]*\\.projects\\?\\.\\[0\\]'
  + '|\\b(?:primary|secondary|label|title|content|heading)=\\{[^}\\n]*\\.projects\\?\\.\\[0\\]',
);

describe.each(SURFACES)('%s', (_name, rel) => {
  const src = readFileSync(resolve(RENDERER, rel), 'utf-8');

  it('routes the project name through projectLabel', () => {
    expect(src).toContain('projectLabel');
  });

  it('never reads a project name for a human to see', () => {
    /* Guard rename seeds and display uses; addressing keys and comparisons must retain slugs. */
    const offenders = src
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => DISPLAY_ATTR.test(line) || JSX_CHILD.test(line)
        || BARE_INTERP.test(line) || LAUNDERED.test(line)
        || RENDERED_SLUG_LOCAL.test(line)
        // Exclude already-resolved labels and React keys so the guard does not reject its own fix.
        || (!/\bkey=\{/.test(line) && !/projectLabel/.test(line)
            && (SLUG_FIELD.test(line) || OBJECT_LABEL.test(line) || STORED_SLUG_ARRAY.test(line))))
      .map(([n, line]) => `${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
