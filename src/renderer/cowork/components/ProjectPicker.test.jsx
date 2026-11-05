import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../platform/host', async (importOriginal) => ({ ...(await importOriginal()) }));

import ProjectPicker from './ProjectPicker';

const projects = [
  { id: 'p1', name: 'reports', display_name: 'Reports' },
  { id: 'p2', name: 'sales-q3', display_name: 'Sales Q3' },
];

// The composer's own tests cover the controlled mode Home uses; these cover
// what the Compare screen relies on: standalone open state and "no project".
describe('ProjectPicker, uncontrolled', () => {
  it('opens, filters, picks and closes on its own', () => {
    const onChange = vi.fn();
    render(<ProjectPicker projects={projects} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Choose project' }).textContent).toMatch(/Work in a project/);
    fireEvent.click(screen.getByRole('button', { name: 'Choose project' }));
    fireEvent.change(screen.getByPlaceholderText('Search projects…'), { target: { value: 'sales' } });
    expect(screen.queryByRole('button', { name: /Reports/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Sales Q3/ }));
    expect(onChange).toHaveBeenCalledWith(projects[1]);
    expect(screen.queryByPlaceholderText('Search projects…')).toBeNull();
  });

  it('offers "no project" only when asked, and clears with it', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ProjectPicker projects={projects} project={projects[0]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose project' }));
    expect(screen.queryByRole('button', { name: /No project/ })).toBeNull();
    rerender(<ProjectPicker projects={projects} project={projects[0]} onChange={onChange} noneLabel="No project" />);
    fireEvent.click(screen.getByRole('button', { name: /No project/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('closes on a press outside it', () => {
    render(<div><ProjectPicker projects={projects} onChange={vi.fn()} /><p>elsewhere</p></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Choose project' }));
    expect(screen.getByPlaceholderText('Search projects…')).toBeTruthy();
    fireEvent.mouseDown(screen.getByText('elsewhere'));
    expect(screen.queryByPlaceholderText('Search projects…')).toBeNull();
  });
});
