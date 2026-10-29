import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TeamPicker, filterTeams } from './TeamPicker';

const teams = [
  { id: 't1', display_name: 'Supply Planning' },
  { id: 't2', display_name: 'Finance' },
  { id: 't3', display_name: 'Supply Chain Ops' },
];
const ready = { status: 'ready', reachable: true, teams };

describe('filterTeams', () => {
  it('returns every team for an empty query', () => {
    expect(filterTeams(teams, '  ')).toEqual(teams);
  });
  it('matches names case-insensitively', () => {
    expect(filterTeams(teams, 'supply').map((t) => t.id)).toEqual(['t1', 't3']);
  });
  it('keeps picked teams visible', () => {
    expect(filterTeams(teams, 'supply', ['t2']).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });
});

describe('<TeamPicker>', () => {
  it('filters the caller\'s teams as they type', () => {
    render(<TeamPicker teamsState={ready} teamIds={[]} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search your teams'), { target: { value: 'fin' } });
    expect(screen.getByText('Finance')).toBeTruthy();
    expect(screen.queryByText('Supply Planning')).toBeNull();
  });
  it('says when nothing matches', () => {
    render(<TeamPicker teamsState={ready} teamIds={[]} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search your teams'), { target: { value: 'zzz' } });
    expect(screen.getByText('None of your teams match.')).toBeTruthy();
  });
});
