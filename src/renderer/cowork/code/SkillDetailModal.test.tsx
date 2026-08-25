import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const skillDocument = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({ codingApi: { skillDocument } }));

import type { SkillLibraryItem } from './api';
import { SkillDetailModal } from './SkillDetailModal';

const item: SkillLibraryItem = {
  id: 'built-in:thermo',
  kind: 'skill',
  name: 'Thermo-Nuclear Code Quality Review',
  description: 'Run an extremely strict maintainability review.',
  origin: 'built_in',
  source_name: 'MindsHub',
  path: 'thermo-nuclear-code-quality-review',
  version: '2',
  enabled: true,
  enabled_project_ids: [],
};

describe('SkillDetailModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    skillDocument.mockImplementation(async (_itemId: string, path?: string) => ({
      item,
      files: ['SKILL.md', 'references/checklist.md'],
      selected_path: path || 'SKILL.md',
      content: path === 'references/checklist.md'
        ? '# Review checklist\n\nInspect the complete diff.'
        : '---\nname: thermo-nuclear-code-quality-review\ndisable-model-invocation: true\n---\n\n# Thermo-Nuclear Code Quality Review\n\nSearch for code judo moves.',
    }));
  });

  it('renders skill metadata and documentation, with the full source available', async () => {
    const user = userEvent.setup();
    render(<SkillDetailModal item={item} onClose={vi.fn()} />);

    expect(await screen.findByText('Search for code judo moves.')).toBeInTheDocument();
    expect(screen.getByText('disable model invocation')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View source' }));
    expect(screen.getByText(/disable-model-invocation: true/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rendered' })).toBeInTheDocument();
  });

  it('navigates supporting files without leaving the viewer', async () => {
    const user = userEvent.setup();
    render(<SkillDetailModal item={item} onClose={vi.fn()} />);
    await screen.findByText('Search for code judo moves.');

    await user.click(screen.getByRole('combobox', { name: 'Skill file' }));
    await user.click(screen.getByRole('option', { name: 'references/checklist.md' }));

    await waitFor(() => expect(skillDocument).toHaveBeenLastCalledWith(item.id, 'references/checklist.md'));
    expect(await screen.findByText('Inspect the complete diff.')).toBeInTheDocument();
  });
});
