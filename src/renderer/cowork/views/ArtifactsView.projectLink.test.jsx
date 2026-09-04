// The artifact card's footer links to the project the artifact belongs to.
//
// Regression (ENG-1676 follow-up): ArtifactBubble declared
// `const projectLabel = projectNameOf(...)` — a string — which shadowed the
// module's imported `projectLabel(project)` function. The tooltip on that link
// calls `projectLabel(projectMatch)`, so as soon as a card resolved a project
// AND an onOpenProject handler was supplied, render threw
// "projectLabel is not a function" and React blanked the whole route with
// "Unexpected Application Error!". The path only fires when both hold, which is
// why it survived to staging.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn(),
  artifactServeUrl: vi.fn(() => ''),
  openArtifactFile: vi.fn(),
}));
vi.mock('../../platform/host', () => ({
  host: { isWeb: false, isMac: () => false, isElectron: false, openExternal: vi.fn() },
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({
  useToastManager: () => ({ add: vi.fn() }),
}));

import ArtifactsView from './ArtifactsView';

afterEach(() => localStorage.clear());

// display_name differs from the slug, so the two helpers can't be conflated:
// the button shows what projectNameOf resolved, the tooltip what projectLabel
// returns for the matched project.
const PROJECT = {
  id: 7,
  name: 'untitled-project-2',
  display_name: 'Мій тестовий проєкт',
  path: '/proj',
};

const ARTIFACT = {
  id: 'a1',
  path: '/proj/.anton/artifacts/forecast/index.html',
  title: 'Forecast',
  type: 'html-app',
  projectId: 7,
  updated: 'updated 2h ago',
  mtime: 1000,
};

describe('artifact card project link', () => {
  it('renders the project as a button without throwing when it can be opened', () => {
    expect(() =>
      render(
        <ArtifactsView
          artifacts={[ARTIFACT]}
          projects={[PROJECT]}
          onOpenProject={vi.fn()}
        />,
      ),
    ).not.toThrow();

    expect(
      screen.getByRole('button', { name: PROJECT.display_name }),
    ).toBeInTheDocument();
  });

  it('still renders the project name as plain text when there is no handler', () => {
    render(<ArtifactsView artifacts={[ARTIFACT]} projects={[PROJECT]} />);

    expect(screen.getByText(PROJECT.display_name)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: PROJECT.display_name }),
    ).toBeNull();
  });
});
