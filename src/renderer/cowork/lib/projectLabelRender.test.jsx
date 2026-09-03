/**
 * ENG-1676 — render coverage for the six components the display-name change
 * touched that no existing test file imports.
 *
 * `projectLabelSurfaces.test.js` is a source-inspection guard: it proves the
 * right *lines* exist. It cannot prove the component still mounts, that
 * `projects` actually reaches the JSX, or that the slug stopped being painted.
 * A typo'd import or an unbound identifier passes the surface guard and fails
 * here, which is exactly the gap these tests exist to close.
 *
 * Every test asserts BOTH directions:
 *   1. the display name is on screen  (the fix works)
 *   2. the slug is NOT on screen      (the fix replaced it, rather than
 *                                      rendering both and looking right)
 * Direction 2 is the one that catches a half-applied change.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '../components/ui/Toast';

// A slug that a Cyrillic name really does collapse to (the ticket's bug), plus
// the label the user typed. Using the real pair keeps the fixture honest.
const SLUG = 'untitled-project-2';
const LABEL = 'Мій тестовий проєкт';
const PROJECTS = [{ id: 'p1', name: SLUG, display_name: LABEL, path: '/tmp/p1' }];

/** The slug must be absent from rendered TEXT (attributes/keys may keep it). */
function expectLabelNotSlug() {
  expect(screen.getAllByText((_, el) => el?.textContent?.trim() === LABEL).length).toBeGreaterThan(0);
  expect(screen.queryByText(SLUG)).toBeNull();
}

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchProjects: vi.fn(async () => PROJECTS),
  fetchChannelBindings: vi.fn(async () => ([
    { id: 'b1', channel_type: 'slack', external_group_id: 'C1', display_name: 'eng',
      trigger_rule: 'always', anton_project_id: 'p1' },
  ])),
  fetchMemory: vi.fn(async () => ({
    sections: [{ scope: 'Project', files: [
      { path: 'p/lessons.md', name: 'lessons.md', category: 'lessons',
        scope: 'Project', projectName: SLUG, projectId: 'p1', content: 'x' },
    ] }],
  })),
  fetchAttachments: vi.fn(async () => []),
  listProjectFiles: vi.fn(async () => ({ files: [] })),
  fetchProjectFile: vi.fn(async () => ''),
}));


// Partial: the rail tree also pulls `useSkillNames` from this module, and a
// total mock unmounts it mid-test with only a console.error to show for it.
vi.mock('./skillsStore', async (importOriginal) => ({
  ...(await importOriginal()),
  useSkills: () => ({ skills: [{ label: 'demo', description: 'd', projects: [SLUG] }], reload: vi.fn() }),
}));

// (no clearAllMocks: these mocks are read-only fixtures, and clearing them
// mid-file would strip the implementations the async render paths depend on.)

describe('ENG-1676 render coverage — components no other test mounts', () => {
  it('RecentsModal shows the display name for a task grouped by slug', async () => {
    const { default: RecentsModal } = await import('../components/RecentsModal');
    render(
      <RecentsModal
        open
        onClose={() => {}}
        onSelect={() => {}}
        projects={PROJECTS}
        tasks={[{ id: 't1', title: 'A task', projectName: SLUG, updatedAt: Date.now() }]}
      />
    );
    expectLabelNotSlug();
  });

  it('TasksView shows the display name on a task row', async () => {
    const { default: TasksView } = await import('../views/TasksView');
    render(
      <TasksView
        projects={PROJECTS}
        tasks={[{ id: 't1', title: 'A task', projectName: SLUG, updatedAt: Date.now() }]}
        onOpenTask={() => {}}
        onOpenProject={() => {}}
      />
    );
    expectLabelNotSlug();
  });

  it('ProjectsView shows the display name on the project card', async () => {
    const { default: ProjectsView } = await import('../views/ProjectsView');
    render(<ProjectsView projects={PROJECTS} onSelectProject={() => {}} />);
    expectLabelNotSlug();
  });

  it('SkillsView shows the display name on a skill scoped to the project', async () => {
    const { default: SkillsView } = await import('../views/SkillsView');
    render(<ToastProvider><SkillsView onCreateWithCowork={() => {}} onTryInChat={() => {}} /></ToastProvider>);
    await waitFor(() => expectLabelNotSlug());
  });

  it('ChannelBindings shows the display name for the pinned project', async () => {
    const { default: ChannelBindings } = await import('../views/ChannelBindings');
    render(<ChannelBindings plugins={[{ channel_type: 'slack', display_name: 'Slack' }]} />);
    await waitFor(() => expectLabelNotSlug());
  });

  it('ContextBox shows the display name in the opened memory entry', async () => {
    const { ContextBox } = await import('../components/rail/ContextBox');
    render(
      <ContextBox
        projects={PROJECTS}
        project={PROJECTS[0]}
        conversationId="c1"
      />
    );
    const row = await screen.findByRole('button', { name: /Lessons/i });
    const fs = await import('fs');
    fs.writeFileSync('/tmp/pre.html', document.body.innerHTML);
    const errs=[]; const oe=console.error; console.error=(...a)=>{errs.push(String(a[0]));};
    fireEvent.click(row);
    await new Promise((r)=>setTimeout(r,300));
    console.error=oe;
    fs.writeFileSync('/tmp/post.html', document.body.innerHTML);
    fs.writeFileSync('/tmp/errs.txt', errs.join('\n---\n'));
    // The modal subtitle is "Project · <label>", so match on the container.
    await waitFor(() => {
      expect(screen.getByText(`Project · ${LABEL}`)).toBeTruthy();
      expect(screen.queryByText(`Project · ${SLUG}`)).toBeNull();
    });
  });
});
