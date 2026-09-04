import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiffPatchView, parseDiffPatch } from './DiffPatchView';

const PATCH = [
  'diff --git a/demo.ts b/demo.ts',
  '--- a/demo.ts',
  '+++ b/demo.ts',
  '@@ -4,3 +4,4 @@',
  ' keep',
  '-old',
  '+new',
  '+extra',
].join('\n');

describe('DiffPatchView', () => {
  it('tracks old and new line numbers without making code unselectable', () => {
    const lines = parseDiffPatch(PATCH);
    expect(lines[4]).toMatchObject({ kind: 'context', oldLine: 4, newLine: 4 });
    expect(lines[5]).toMatchObject({ kind: 'deletion', oldLine: 5, newLine: null });
    expect(lines[6]).toMatchObject({ kind: 'addition', oldLine: null, newLine: 5 });
    expect(lines[7]).toMatchObject({ kind: 'addition', oldLine: null, newLine: 6 });
  });

  it('selects a line range from the line-number gutter', () => {
    const onSelectionChange = vi.fn();
    render(<DiffPatchView patch={PATCH} onSelectionChange={onSelectionChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select 6' }), { shiftKey: true });

    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'lines 5–6' }));
  });

  it('drops the selection when the patch changes underneath it', () => {
    const onSelectionChange = vi.fn();
    const view = render(<DiffPatchView patch={PATCH} onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select 5' }));
    expect(document.querySelectorAll('.is-selected')).toHaveLength(1);

    view.rerender(<DiffPatchView patch={`${PATCH}\n+another`} onSelectionChange={onSelectionChange} />);

    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    expect(document.querySelectorAll('.is-selected')).toHaveLength(0);
  });
});
