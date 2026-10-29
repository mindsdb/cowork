import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';

const api = vi.hoisted(() => ({ searchHubPeople: vi.fn() }));
vi.mock('../api', () => api);

import PeoplePicker, { PEOPLE_SEARCH_DEBOUNCE_MS } from './PeoplePicker';

const ANA = { id: 'u-ana', name: 'Ana Ruiz', email: 'ana@kinaxis.com' };
const ANDY = { id: 'u-andy', name: 'Andy Park', email: 'andy@kinaxis.com' };

function Harness({ initial = [], onChangeSpy = () => {}, ...props }) {
  const [value, setValue] = useState(initial);
  return (
    <PeoplePicker
      value={value}
      onChange={(next) => { onChangeSpy(next); setValue(next); }}
      {...props}
    />
  );
}

const input = () => screen.getByRole('combobox', { name: 'Search people' });

function type(text) {
  fireEvent.focus(input());
  fireEvent.change(input(), { target: { value: text } });
}

async function settle() {
  await act(async () => { vi.advanceTimersByTime(PEOPLE_SEARCH_DEBOUNCE_MS); });
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  api.searchHubPeople.mockReset();
  api.searchHubPeople.mockResolvedValue({ reachable: true, people: [ANA, ANDY] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PeoplePicker', () => {
  it('waits for two characters and a pause before searching', async () => {
    render(<Harness />);

    type('a');
    await settle();
    expect(api.searchHubPeople).not.toHaveBeenCalled();

    type('an');
    await act(async () => { vi.advanceTimersByTime(PEOPLE_SEARCH_DEBOUNCE_MS - 50); });
    expect(api.searchHubPeople).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    type('ana');
    await settle();

    expect(api.searchHubPeople).toHaveBeenCalledTimes(1);
    expect(api.searchHubPeople).toHaveBeenCalledWith('ana', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Ana Ruiz');
    expect(options[0]).toHaveTextContent('ana@kinaxis.com');
  });

  it('aborts a stale search and ignores its answer', async () => {
    let resolveFirst;
    api.searchHubPeople
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce({ reachable: true, people: [ANDY] });
    render(<Harness />);

    type('an');
    await settle();
    const firstSignal = api.searchHubPeople.mock.calls[0][1].signal;
    type('and');
    expect(firstSignal.aborted).toBe(true);
    await settle();
    await act(async () => { resolveFirst({ reachable: true, people: [ANA] }); });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Andy Park');
  });

  it('moves through suggestions with the keyboard and adds one with Enter', async () => {
    const onChangeSpy = vi.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);
    type('an');
    await settle();

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const [first, second] = screen.getAllByRole('option');
    expect(input()).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).toHaveAttribute('aria-activedescendant', second.id);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).toHaveAttribute('aria-activedescendant', first.id);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input()).toHaveAttribute('aria-activedescendant', second.id);
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(onChangeSpy).toHaveBeenCalledWith([ANDY]);
    expect(screen.getByRole('list', { name: 'Picked people' })).toHaveTextContent('Andy Park (andy@kinaxis.com)');
    expect(input()).toHaveValue('');
  });

  it('closes the list with Escape', async () => {
    render(<Harness />);
    type('an');
    await settle();
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
  });

  it('adds a suggestion on click, leaves picked people out, and removes chips', async () => {
    const onChangeSpy = vi.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);
    type('an');
    await settle();

    fireEvent.mouseDown(screen.getByRole('option', { name: /Ana Ruiz/ }));
    expect(onChangeSpy).toHaveBeenLastCalledWith([ANA]);

    type('an');
    await settle();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Andy Parkandy@kinaxis.com']);

    fireEvent.click(screen.getByRole('button', { name: 'Remove ana@kinaxis.com' }));
    expect(onChangeSpy).toHaveBeenLastCalledWith([]);
  });

  it('leaves a picked person out of the suggestions by id', async () => {
    render(<Harness initial={[ANA]} />);
    type('an');
    await settle();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Andy Parkandy@kinaxis.com']);
  });

  it('labels each chip by what is known about the person', () => {
    render(<Harness initial={[
      ANA,
      { id: 'u-bo', name: null, email: 'bo@kinaxis.com' },
      { id: 'u-wait', name: null, email: null, pending: true },
      { id: 'u-gone', name: null, email: null },
    ]} />);
    const chips = within(screen.getByRole('list', { name: 'Picked people' })).getAllByRole('listitem');
    expect(chips.map((c) => c.textContent)).toEqual([
      'Ana Ruiz (ana@kinaxis.com)', 'bo@kinaxis.com', 'Loading…', 'Unknown person',
    ]);
  });

  it('removes an Unknown person chip by its id', () => {
    const onChangeSpy = vi.fn();
    render(<Harness initial={[ANA, { id: 'u-gone', name: null, email: null }]} onChangeSpy={onChangeSpy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Unknown person' }));
    expect(onChangeSpy).toHaveBeenLastCalledWith([ANA]);
  });

  it('says when nobody matches', async () => {
    api.searchHubPeople.mockResolvedValue({ reachable: true, people: [] });
    render(<Harness />);
    type('zz');
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent('No matches');
  });

  it('will not add a typed email nobody in the org matches', async () => {
    api.searchHubPeople.mockResolvedValue({ reachable: true, people: [] });
    const onChangeSpy = vi.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);
    type('zed@partner.io');
    await settle();

    expect(screen.queryByRole('option')).toBeNull();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Pick someone from your organization')).toBeInTheDocument();
  });

  it('says so and adds nobody when the org could not be searched', async () => {
    api.searchHubPeople.mockResolvedValue({ reachable: false, people: [] });
    const onChangeSpy = vi.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);
    type('zed@partner.io');
    await settle();

    expect(screen.getByRole('status')).toHaveTextContent("Couldn't load people from your organization.");
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});
