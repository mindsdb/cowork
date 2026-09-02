import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SkillLibraryItem } from './api';
import { CodeCommandPalette, type CodePaletteItem } from './CodeCommandPalette';

const skill: SkillLibraryItem = {
  id: 'built-in:review',
  kind: 'skill',
  name: 'Review',
  description: 'Review completed work.',
  origin: 'built_in',
  source_name: 'MindsHub',
  path: 'review',
  enabled: true,
  enabled_project_ids: [],
};

const item: CodePaletteItem = {
  id: 'mindshub-skill:built-in:review',
  kind: 'skill',
  section: 'skills',
  invocation: '$review',
  label: 'Review',
  description: 'Review completed work.',
  scope: 'MindsHub',
  skill,
};

describe('CodeCommandPalette', () => {
  it('offers a separate skill preview without invoking the skill', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onViewSkill = vi.fn();
    render(
      <CodeCommandPalette
        items={[item]}
        query=""
        selectedIndex={0}
        agentLabel="Codex"
        onQueryChange={vi.fn()}
        onSelectedIndexChange={vi.fn()}
        onChoose={onChoose}
        onViewSkill={onViewSkill}
        onDismiss={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'View Review' }));

    expect(onViewSkill).toHaveBeenCalledWith(skill);
    expect(onChoose).not.toHaveBeenCalled();
  });
});
