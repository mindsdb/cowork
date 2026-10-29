import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
      orgName="Kinaxis"
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

    expect(onChangeSpy).toHaveBeenCalledWith(['andy@kinaxis.com']);
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
    expect(onChangeSpy).toHaveBeenLastCalledWith(['ana@kinaxis.com']);

    type('an');
    await settle();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Andy Parkandy@kinaxis.com']);

    fireEvent.click(screen.getByRole('button', { name: 'Remove ana@kinaxis.com' }));
    expect(onChangeSpy).toHaveBeenLastCalledWith([]);
  });

  it('shows an existing email without a name as the email', () => {
    render(<Harness initial={['bo@kinaxis.com']} />);
    expect(screen.getByRole('list', { name: 'Picked people' })).toHaveTextContent(/^bo@kinaxis\.com$/);
  });

  it('says when nobody matches', async () => {
    api.searchHubPeople.mockResolvedValue({ reachable: true, people: [] });
    render(<Harness />);
    type('zz');
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent('No matches');
  });

  describe('a typed email nobody in the org matches', () => {
    beforeEach(() => {
      api.searchHubPeople.mockResolvedValue({ reachable: true, people: [] });
    });

    it('can be added with allowExternal', async () => {
      const onChangeSpy = vi.fn();
      render(<Harness allowExternal onChangeSpy={onChangeSpy} />);
      type('Zed@Partner.io');
      await settle();

      const option = screen.getByRole('option', { name: 'Add zed@partner.io (outside Kinaxis)' });
      expect(option).toBeInTheDocument();
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChangeSpy).toHaveBeenCalledWith(['zed@partner.io']);
    });

    it('cannot be added without allowExternal', async () => {
      const onChangeSpy = vi.fn();
      render(<Harness onChangeSpy={onChangeSpy} />);
      type('zed@partner.io');
      await settle();

      expect(screen.queryByRole('option')).toBeNull();
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChangeSpy).not.toHaveBeenCalled();
      expect(screen.getByText('Pick someone from your organization')).toBeInTheDocument();
    });
  });

  describe('when the org could not be searched', () => {
    beforeEach(() => {
      api.searchHubPeople.mockResolvedValue({ reachable: false, people: [] });
    });

    it('says so and adds nobody without allowExternal', async () => {
      const onChangeSpy = vi.fn();
      render(<Harness onChangeSpy={onChangeSpy} />);
      type('zed@partner.io');
      await settle();

      expect(screen.getByRole('status')).toHaveTextContent("Couldn't load people from your organization.");
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChangeSpy).not.toHaveBeenCalled();
    });

    it('still offers a typed email with allowExternal', async () => {
      render(<Harness allowExternal />);
      type('zed@partner.io');
      await settle();

      expect(screen.getByRole('status')).toHaveTextContent("Couldn't search Kinaxis");
      expect(screen.getByRole('option', { name: 'Add zed@partner.io (outside Kinaxis)' })).toBeInTheDocument();
    });
  });

  it('names the org generically without a name', async () => {
    api.searchHubPeople.mockResolvedValue({ reachable: true, people: [] });
    render(<Harness allowExternal orgName={null} />);
    type('zed@partner.io');
    await settle();
    expect(screen.getByRole('option', { name: 'Add zed@partner.io (outside your organization)' })).toBeInTheDocument();
  });
});
