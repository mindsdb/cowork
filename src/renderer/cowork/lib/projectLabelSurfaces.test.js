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
  // Round three. Found by running the rules below across the whole renderer
  // rather than by hand -- which is the only reason ChannelBindings and
  // ScheduleDetailView are here at all; no report named them.
  ['task list open-project tooltip', 'cowork/views/TasksView.jsx'],
  ['scheduled list', 'cowork/views/ScheduledView.jsx'],
  ['schedule card', 'cowork/components/schedule/ScheduleCard.jsx'],
  ['schedule detail hint', 'cowork/views/ScheduleDetailView.jsx'],
  ['channel bindings', 'cowork/views/ChannelBindings.jsx'],
  // Round five, and the first round prompted by the question "did we check
  // skills?" rather than by a rule. These hold a project as a NAME STRING --
  // `skill.projects` is an array of names, and these rows carry `projectName`
  // -- so there is no `.name` anywhere for the rules above to catch, and no
  // project object to hand `projectLabel`. `projectLabelByName` resolves them.
  ['skills scope picker + card + detail', 'cowork/views/SkillsView.jsx'],
  ['recents modal', 'cowork/components/RecentsModal.jsx'],
  ['rail context card heading', 'cowork/components/rail/ContextCard.jsx'],
  ['utilities / memory headings', 'cowork/views/UtilitiesView.jsx'],
  // Found only by running the rules across the whole renderer rather than
  // across the list itself.
  ['schedule task modal picker', 'cowork/components/schedule/ScheduleTaskModal.jsx'],
  //
  // DELIBERATELY NOT LISTED: `components/datavault/DataVaultFormPanel.jsx`.
  // Its `label: project.name` reads a **PostHog** project from
  // `discoverPostHogProjects()`, not a Cowork one -- a third-party API's
  // objects that have no `display_name` and never will. Round five briefly
  // "fixed" it because the rule matches `label: project.name` regardless of
  // what `project` means; reverted. The same trap as `code/`'s CodeProject.
  // If this file is ever added here, check what the object actually is first.
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

/*
 * Two shapes the attribute/child rules cannot see, both proven by real misses.
 *
 * BARE_INTERP: `return `New task · ${selectedProject.name}`` is neither an
 * attribute nor a JSX child, so MobileShell's title bar passed even while the
 * file was already in this list. The interpolation must CLOSE right after the
 * read, so a comparison -- `${project?.name === p.name ? …}` -- is not a
 * display use and is not flagged.
 *
 * LAUNDERED is the important one. `const projectName = projectMatch?.name`
 * followed by `{projectName}` defeats every regex aimed at the render site: by
 * then it is an ordinary string. Keyed on the LOCAL's name rather than the
 * source expression, so `projects.find(…)?.name` is caught too -- which is how
 * ScheduledView's search, ScheduleDetailView and ChannelBindings surfaced.
 */
const BARE_INTERP = new RegExp(`\\$\\{\\s*${PROJECT_VAR}\\??\\.name\\s*\\}`);
// The allowlist of local names is deliberate, and it is this rule's known
// weakness: renaming a local moves its file out of reach. That is not
// hypothetical -- collapsing ScheduleCard/ScheduledView/ScheduleDetailView onto
// `projectDisplay` un-protected all three, and the laundering mutation that was
// caught before the rename sailed through after it. `Display` is here because
// of that.
//
// Widening to `project\w*` does not work, and the two attempts are worth
// recording so nobody repeats them: it then flags
// `const projectMatch = projects.find((p) => p.name === projectName)`, where the
// `.name` is a lookup predicate. Excluding lines containing `=>`/`===` fixes
// that but re-breaks `projects.find((p) => p.id === task.projectId)?.name`,
// which launders on a line holding both; and attaching the exclusion to the
// `.name` token instead flags
// `(tasks || []).filter((t) => t.projectName === project.name || ...)`, where
// `.name` is a comparison's right-hand operand. Telling "inside a predicate"
// from "read as a value" needs a parser, not a regex -- so the allowlist stays,
// and a NEW local name for a slug needs adding here.
const LAUNDERED = /\bconst\s+project(?:Name|Label|Title|Display)\s*=\s*[^;\n]*\.name\b/;

/*
 * RENDERED_SLUG_LOCAL — the shape LAUNDERED cannot see, found in review.
 *
 * `LAUNDERED` keys on the local being assigned from `.name`. TasksView builds
 * its slug from a DIFFERENT attribute -- `task.projectName || task.project` --
 * so no `.name` appears, and the rendered `{projectName}` is by then a bare
 * identifier that `JSX_CHILD` cannot see either. The file still passed
 * `toContain('projectLabel')` because the *tooltip* used it: the row read
 * `untitled-project-2` while hovering it said "Open Мій тестовий проєкт".
 *
 * So this bans RENDERING a local by that name, rather than assigning one.
 * Both rows genuinely need the slug for `p.name === projectName` and for the
 * row's truthiness guard -- what they must not do is show it. A resolved
 * `projectDisplay` renders fine.
 */
const RENDERED_SLUG_LOCAL = new RegExp(
  '(?:>\\{\\s*projectName\\s*\\}'
  // Not adjacent to a `/`: `projects/${projectName}/files` is a URL or a
  // dedupe key, not something a person reads. Found by sweeping the whole
  // renderer with this rule rather than only the listed surfaces.
  + '|(?<![/])\\$\\{\\s*projectName\\s*\\}(?![/])'
  + '|\\)\\s*:\\s*projectName\\b'
  // The attribute form. Found in ScheduleCard, which has since dropped its
  // slug-valued local entirely (it resolves by id, so it never needed one) --
  // the rule stays because the shape is what matters, not that one site.
  + '|\\b(?:primary|secondary|label|title|content|placeholder|defaultValue)=\\{\\s*projectName\\s*\\})',
);

/*
 * Round five's two shapes, both invisible to everything above.
 *
 * SLUG_FIELD: these rows store the project as `.projectName`, not `.name`, so
 * every rule keyed on `.name` slid straight past them. Excluded on any line
 * carrying `key=`, because a React key built from the slug is correct.
 *
 * OBJECT_LABEL: `{ value: p.name, label: p.name }` in the skills scope picker.
 * An object property, not a JSX attribute, so DISPLAY_ATTR could not see it --
 * and `value` genuinely must stay the slug, since that is what gets persisted
 * into `skill.projects`. Only the label is for reading.
 *
 * STORED_SLUG_ARRAY: `{selected.projects?.[0]}` renders an element of that
 * array of names directly.
 */
const SLUG_FIELD = new RegExp(
  '(?:>\\{[^}\\n]*\\.projectName\\b[^}\\n]*\\}'
  + '|\\$\\{[^}\\n]*\\.projectName\\b[^}\\n]*\\}'
  + '|\\b(?:primary|secondary|label|title|content|heading|placeholder|defaultValue)=\\{[^}\\n]*\\.projectName\\b)',
);
const OBJECT_LABEL = new RegExp(`\\blabel:\\s*${PROJECT_VAR}\\??\\.name\\b`);
// Rendering an element of that array -- a standalone JSX expression line, or
// one opened right after a tag. NOT `setDraft({ project: initial.projects?.[0] })`,
// which stores the slug into form state and is exactly right: that value is
// what gets persisted back.
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
    /*
     * Rename seeds, visible text, and display attributes together -- they are
     * one defect class. Keys, comparisons, `draftKey` and the pinned set are
     * untouched by design: those address a project and must keep the slug.
     */
    const offenders = src
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => DISPLAY_ATTR.test(line) || JSX_CHILD.test(line)
        || BARE_INTERP.test(line) || LAUNDERED.test(line)
        || RENDERED_SLUG_LOCAL.test(line)
        // These three describe an UNRESOLVED display read. A line that already
        // calls the resolver is the fix, not the defect -- without this,
        // `{projectLabelByName(projects, row.projectName)}` flags itself. And a
        // slug used as a React key is correct, so `key=` is exempt too.
        || (!/\bkey=\{/.test(line) && !/projectLabel/.test(line)
            && (SLUG_FIELD.test(line) || OBJECT_LABEL.test(line) || STORED_SLUG_ARRAY.test(line))))
      .map(([n, line]) => `${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
