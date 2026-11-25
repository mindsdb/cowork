import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LiveEditControls, LiveEditPanel } from './LiveEditPanel';

// The editor fills the panel through its slot, as ArtifactViewerBody wires it.
function Panel({ onToggle }) {
  const [slot, setSlot] = useState(null);
  return (
    <>
      <LiveEditPanel slotRef={setSlot} onClose={vi.fn()} />
      <LiveEditControls
        target={slot}
        heading="Editing artifact"
        guidance="Click any text to edit it."
        advanced={{ on: false, onToggle }}
      />
    </>
  );
}

describe('LiveEditPanel', () => {
  it('puts Source code in the header beside the close, not in the body', () => {
    const onToggle = vi.fn();
    render(<Panel onToggle={onToggle} />);

    const header = screen.getByRole('button', { name: 'Close Live edit panel' }).parentElement.parentElement;
    const source = within(header).getByRole('button', { name: 'Source code' });
    expect(within(screen.getByTestId('live-edit-slot')).queryByRole('button', { name: 'Source code' })).toBeNull();

    fireEvent.click(source);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('keeps Source code with the status card in a bare slot', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    render(<LiveEditControls target={slot} heading="Editing artifact" advanced={{ on: false, onToggle: vi.fn() }} />);

    expect(within(slot).getByRole('button', { name: 'Source code' })).toBeInTheDocument();
    slot.remove();
  });
});
