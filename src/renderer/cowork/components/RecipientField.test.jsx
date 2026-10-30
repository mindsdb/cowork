import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

const api = vi.hoisted(() => ({ search: vi.fn(), byIds: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  searchHubPeople: api.search,
  fetchHubPeopleByIds: api.byIds,
}));

import RecipientField from './RecipientField';

const ANA = { id: 'u-ana', name: 'Ana Ruiz', email: 'ana@kinaxis.com' };
const ANDY = { id: 'u-andy', name: 'Andy Park', email: 'andy@kinaxis.com' };
const BO = { id: 'u-bo', name: 'Bo Chen', email: 'bo@kinaxis.com' };
const DIRECTORY = [ANA, ANDY, BO];

const TEAMS = {
  status: 'ready',
  reachable: true,
  teams: [
    { id: 't-all', display_name: 'All members', is_default: true },
    { id: 't-supply', display_name: 'Supply Planning', member_count: 12 },
    { id: 't-andes', display_name: 'Andes Ops' },
    { id: 't-finance', display_name: 'Finance' },
  ],
};

beforeEach(() => {
  api.search.mockReset();
  api.search.mockImplementation(async (q) => ({
    reachable: true,
    people: DIRECTORY.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase())),
  }));
  api.byIds.mockReset();
  api.byIds.mockImplementation(async (ids) => ({ reachable: true, people: DIRECTORY.filter((p) => ids.includes(p.id)) }));
});

function Harness({ initial = {}, spy = () => {}, ...props }) {
  const [value, setValue] = useState({ teamIds: [], userIds: [], emails: [], ...initial });
  return (
    <RecipientField
      value={value}
      onChange={(next) => { spy(next); setValue(next); }}
      orgName="Kinaxis"
      teamsState={TEAMS}
      {...props}
    />
  );
}

const input = () => screen.getByRole('combobox');
const options = () => within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
const summary = () => screen.getByTestId('recipient-summary').textContent;
const list = () => screen.getByRole('list', { name: 'Recipients' });
// Each row as [primary, secondary], top to bottom.
const rows = () => within(list()).getAllByRole('listitem').map((row) => {
  const texts = [...row.querySelectorAll('span.truncate')].map((el) => el.textContent);
  return texts;
});

describe('<RecipientField>', () => {
  it('lists your teams on focus, the default team left out, with member counts', async () => {
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.click(input());

    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveTextContent('Teams');
    expect(options()).toEqual(['Supply Planning12 members', 'Andes Ops', 'Finance']);
    expect(listbox).not.toHaveTextContent('All members');
    expect(listbox).not.toHaveTextContent('People in');
    expect(api.search).not.toHaveBeenCalled();
  });

  it('puts a full-width search input on top, and no list while nobody is picked', () => {
    render(<Harness allowExternal />);
    expect(input()).toHaveAttribute('placeholder', 'Add teams, people or emails…');
    expect(screen.queryByRole('list', { name: 'Recipients' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it('says only teams or people in the placeholder when outside emails are not allowed', () => {
    render(<Harness />);
    expect(input()).toHaveAttribute('placeholder', 'Add teams or people…');
  });

  it('groups typed matches into Teams and People in the org', async () => {
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.type(input(), 'an');

    await waitFor(() => expect(options()).toEqual([
      'Supply Planning12 members', 'Andes Ops', 'Finance',
      'ARAna Ruizana@kinaxis.com', 'APAndy Parkandy@kinaxis.com',
    ]));
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveTextContent('Teams');
    expect(listbox).toHaveTextContent('People in Kinaxis');
    expect(api.search).toHaveBeenLastCalledWith('an', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('adds a picked person and a picked team as rows, newest on top, and hides them from suggestions', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    await user.type(input(), 'ana');
    await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
    expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-ana'], emails: [] });

    await user.click(screen.getByRole('option', { name: /Finance/ }));
    expect(spy).toHaveBeenLastCalledWith({ teamIds: ['t-finance'], userIds: ['u-ana'], emails: [] });
    expect(rows()).toEqual([['Finance', 'Team'], ['Ana Ruiz', 'ana@kinaxis.com']]);
    // The suggestions sit under the input, above the list.
    expect(screen.getByRole('listbox').compareDocumentPosition(list()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(options()).not.toContain('Finance');
    expect(summary()).toBe('1 team · 1 person');
  });

  it('invites an outside email when allowed', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    await user.type(input(), 'zed@partner.io');

    const invite = await screen.findByRole('option', { name: 'Invite zed@partner.io (outside Kinaxis)' });
    expect(invite).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: [], emails: ['zed@partner.io'] });
    expect(summary()).toBe('1 outside Kinaxis');
    expect(rows()).toEqual([['zed@partner.io', 'Outside Kinaxis']]);
    expect(screen.getByRole('button', { name: 'Remove zed@partner.io' })).toBeInTheDocument();
  });

  it('adds a typed email someone in the org has as that person', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    await user.type(input(), 'bo@kinaxis.com');
    await screen.findByRole('option', { name: /Bo Chen/ });
    expect(screen.queryByRole('option', { name: /Invite/ })).toBeNull();
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-bo'], emails: [] });
  });

  it('will not add an outside email when only the org is allowed', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await user.type(input(), 'zed@partner.io');

    expect(await screen.findByText('Only people in Kinaxis')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Invite/ })).toBeNull();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not added: zed@partner.io (not in Kinaxis)');
    expect(spy).not.toHaveBeenCalled();
    expect(summary()).toBe('Add at least one team or person.');
  });

  it('moves with the arrows, adds with Enter, Tab or comma, and closes with Escape', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    await user.click(input());
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Andes Ops' }).id);
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenLastCalledWith({ teamIds: ['t-andes'], userIds: [], emails: [] });

    // Typing highlights the top row; Tab adds it.
    await user.type(input(), 'fin');
    await user.keyboard('{Tab}');
    expect(spy).toHaveBeenLastCalledWith({ teamIds: ['t-andes', 't-finance'], userIds: [], emails: [] });
    expect(input()).toHaveFocus();

    await user.type(input(), 'supp,');
    expect(spy).toHaveBeenLastCalledWith({ teamIds: ['t-andes', 't-finance', 't-supply'], userIds: [], emails: [] });

    await user.type(input(), 'zz');
    expect(screen.getByRole('status')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('removes a row with its labelled ×, by click or keyboard, and Backspace leaves rows alone', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} initial={{ teamIds: ['t-finance'], userIds: ['u-ana'], emails: ['zed@partner.io'] }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Ana Ruiz' })).toBeInTheDocument());
    await user.click(input());
    await user.keyboard('{Backspace}');
    expect(spy).not.toHaveBeenCalled();

    // The × is reachable with Tab and works with Enter.
    await user.keyboard('{Escape}');
    screen.getByRole('button', { name: 'Remove Finance' }).focus();
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-ana'], emails: ['zed@partner.io'] });
    // The focus goes back to the input without opening the suggestions.
    expect(input()).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Remove zed@partner.io' }));
    expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-ana'], emails: [] });
    expect(rows()).toEqual([['Ana Ruiz', 'ana@kinaxis.com']]);
  });

  it('lists stored recipients as rows with their second line', async () => {
    const teams = { ...TEAMS, teams: [...TEAMS.teams, { id: 't-one', display_name: 'Solo', member_count: 1 }] };
    render(<Harness allowExternal teamsState={teams} initial={{ teamIds: ['t-supply', 't-one', 't-andes'], userIds: ['u-ana'], emails: ['zed@partner.io'] }} />);
    await waitFor(() => expect(list()).toHaveTextContent('Ana Ruiz'));
    expect(rows()).toEqual([
      ['Supply Planning', 'Team · 12 people'],
      ['Solo', 'Team · 1 person'],
      ['Andes Ops', 'Team'],
      ['Ana Ruiz', 'ana@kinaxis.com'],
      ['zed@partner.io', 'Outside Kinaxis'],
    ]);
    const kinds = within(list()).getAllByRole('listitem').map((row) => row.getAttribute('data-recipient-row'));
    expect(kinds).toEqual(['team', 'team', 'team', 'person', 'outside']);
    // A person's tile is their initials.
    expect(within(list()).getAllByRole('listitem')[3]).toHaveTextContent(/^AR/);
  });

  it('adds each address of a paste: org people as people, the rest as outside emails', async () => {
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    fireEvent.focus(input());
    fireEvent.paste(input(), { clipboardData: { getData: () => 'Ana@Kinaxis.com, zed@partner.io;\nnope bo@kinaxis.com' } });

    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({
      teamIds: [], userIds: ['u-ana', 'u-bo'], emails: ['zed@partner.io'],
    }));
    expect(screen.getByRole('alert')).toHaveTextContent('Not added: nope (not an email)');
    expect(summary()).toBe('2 people · 1 outside Kinaxis');
    await waitFor(() => expect(rows().map((r) => r[0])).toEqual(['Ana Ruiz', 'Bo Chen', 'zed@partner.io']));
  });

  it('reports pasted outside addresses as not added when only the org is allowed', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.paste(input(), { clipboardData: { getData: () => 'ana@kinaxis.com zed@partner.io' } });

    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-ana'], emails: [] }));
    expect(screen.getByRole('alert')).toHaveTextContent('Not added: zed@partner.io (not in Kinaxis)');
  });

  it('names stored people and teams, showing ones nobody knows as Unknown', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} initial={{ teamIds: ['t-supply', 't-gone'], userIds: ['u-bo', 'u-gone'] }} />);
    await waitFor(() => expect(list()).toHaveTextContent('Bo Chen'));
    expect(rows()).toEqual([
      ['Supply Planning', 'Team · 12 people'],
      ['Unknown team', 'Team'],
      ['Bo Chen', 'bo@kinaxis.com'],
      ['Unknown person'],
    ]);
    expect(api.byIds).toHaveBeenCalledWith(['u-bo', 'u-gone']);
    expect(summary()).toBe('2 teams · 2 people');

    await user.click(screen.getByRole('button', { name: 'Remove Unknown person' }));
    await user.click(screen.getByRole('button', { name: 'Remove Unknown team' }));
    expect(spy).toHaveBeenLastCalledWith({ teamIds: ['t-supply'], userIds: ['u-bo'], emails: [] });
  });

  it('marks outside emails apart from people in the org', () => {
    render(<Harness allowExternal initial={{ emails: ['zed@partner.io'] }} />);
    const row = screen.getByRole('button', { name: 'Remove zed@partner.io' }).closest('[data-recipient-row]');
    expect(row).toHaveAttribute('data-recipient-row', 'outside');
    expect(row.querySelector('.bg-warning-bg')).not.toBeNull();
  });

  it('summarises an empty field', () => {
    render(<Harness allowExternal />);
    expect(summary()).toBe('Add at least one team, person or email.');
  });

  describe('emails only (no org)', () => {
    it('takes addresses without teams or search', async () => {
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness emailsOnly allowExternal orgName={null} teamsState={null} spy={spy} />);
      await user.click(input());
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(summary()).toBe('Add at least one email.');

      await user.type(input(), 'Zed@Partner.io{Enter}');
      expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: [], emails: ['zed@partner.io'] });
      const row = screen.getByRole('button', { name: 'Remove zed@partner.io' }).closest('[data-recipient-row]');
      expect(row).toHaveAttribute('data-recipient-row', 'email');
      expect(row.querySelector('.bg-warning-bg')).toBeNull();
      expect(rows()).toEqual([['zed@partner.io']]);
      expect(summary()).toBe('1 person');

      fireEvent.paste(input(), { clipboardData: { getData: () => 'a@x.io, b@x.io\nbad' } });
      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: [], emails: ['zed@partner.io', 'a@x.io', 'b@x.io'] }));
      expect(screen.getByRole('alert')).toHaveTextContent('Not added: bad (not an email)');
      expect(api.search).not.toHaveBeenCalled();
      expect(api.byIds).not.toHaveBeenCalled();
    });
  });
});
