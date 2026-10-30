import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

const api = vi.hoisted(() => ({ search: vi.fn(), byIds: vi.fn(), directory: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  searchHubPeople: api.search,
  fetchHubPeopleByIds: api.byIds,
  fetchHubDirectory: api.directory,
}));

import RecipientField from './RecipientField';
import { __resetOrgSharingForTests } from '../hooks/useOrgSharing';

const ANA = { id: 'u-ana', name: 'Ana Ruiz', email: 'ana@kinaxis.com' };
const ANDY = { id: 'u-andy', name: 'Andy Park', email: 'andy@kinaxis.com' };
const BO = { id: 'u-bo', name: 'Bo Chen', email: 'bo@kinaxis.com' };
const DIRECTORY = [ANA, ANDY, BO];
const directoryAnswer = (over = {}) => ({ reachable: true, people: DIRECTORY, truncated: false, ...over });

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
  __resetOrgSharingForTests();
  api.directory.mockReset();
  api.directory.mockImplementation(async () => directoryAnswer());
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
  it('opens on focus with everyone, grouped: teams (default left out) then people in the org', async () => {
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.click(input());

    await waitFor(() => expect(options()).toEqual([
      'Supply Planning12 people', 'Andes OpsTeam', 'FinanceTeam',
      'ARAna Ruizana@kinaxis.com', 'APAndy Parkandy@kinaxis.com', 'BCBo Chenbo@kinaxis.com',
    ]));
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveTextContent('Teams');
    expect(listbox).toHaveTextContent('People in Kinaxis');
    expect(listbox).not.toHaveTextContent('All members');
    expect(api.directory).toHaveBeenCalledTimes(1);
    expect(api.search).not.toHaveBeenCalled();
  });

  it('says so when nobody else is in the org, instead of dropping the people group', async () => {
    api.directory.mockImplementation(async () => directoryAnswer({ people: [] }));
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.click(input());

    const listbox = await screen.findByRole('listbox');
    await waitFor(() => expect(listbox).toHaveTextContent('No one else is in Kinaxis yet.'));
    expect(listbox).toHaveTextContent('People in Kinaxis');
    expect(within(listbox).getByRole('button', { name: /Invite people/ })).toBeTruthy();
    expect(screen.queryByText('Everyone you can add is already added.')).toBeNull();
  });

  it('says everyone is already added once every person is picked', async () => {
    const user = userEvent.setup();
    render(<Harness allowExternal initial={{ userIds: DIRECTORY.map((p) => p.id) }} />);
    await user.click(input());

    await waitFor(() => expect(screen.getByRole('listbox')).toHaveTextContent('Everyone in Kinaxis is already added.'));
  });

  it('floats the dropdown over the page, under the input, rather than inside the field', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness allowExternal />);
    await user.click(input());
    const menu = await screen.findByTestId('recipient-menu');
    expect(menu.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
    expect(menu.style.position).toBe('fixed');
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

  it('filters teams and people locally as you type, with no request per keystroke', async () => {
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.click(input());
    await waitFor(() => expect(options()).toHaveLength(6));
    await user.type(input(), 'an');

    expect(options()).toEqual([
      'Supply Planning12 people', 'Andes OpsTeam', 'FinanceTeam',
      'ARAna Ruizana@kinaxis.com', 'APAndy Parkandy@kinaxis.com',
    ]);
    await user.type(input(), 'dy');
    expect(options()).toEqual(['APAndy Parkandy@kinaxis.com']);
    await user.clear(input());
    await user.type(input(), 'BO@KIN');
    expect(options()).toEqual(['BCBo Chenbo@kinaxis.com']);
    expect(api.directory).toHaveBeenCalledTimes(1);
    expect(api.search).not.toHaveBeenCalled();
  });

  it('ignores case and accents', async () => {
    api.directory.mockResolvedValue(directoryAnswer({ people: [...DIRECTORY, { id: 'u-jose', name: 'José López', email: 'jose@kinaxis.com' }] }));
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.click(input());
    await waitFor(() => expect(options()).toHaveLength(7));
    await user.type(input(), 'lopez');
    expect(options()).toEqual(['JLJosé Lópezjose@kinaxis.com']);
    await user.clear(input());
    await user.type(input(), 'JOSÉ');
    expect(options()).toEqual(['JLJosé Lópezjose@kinaxis.com']);
  });

  it('reads the directory once for every field on the page', async () => {
    const user = userEvent.setup();
    render(<><Harness allowExternal /><Harness allowExternal /></>);
    const [first, second] = screen.getAllByRole('combobox');
    await user.click(first);
    await waitFor(() => expect(options()).toHaveLength(6));
    await user.click(second);
    await waitFor(() => expect(options()).toHaveLength(6));
    expect(api.directory).toHaveBeenCalledTimes(1);
  });

  it('moves across both groups with the arrows and adds with Enter, keeping the focus and the list open', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    await user.click(input());
    await waitFor(() => expect(options()).toHaveLength(6));
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Ana Ruiz/ }).id);
    await user.keyboard('{ArrowUp}');
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Finance/ }).id);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-ana'], emails: [] });
    expect(input()).toHaveFocus();
    expect(options()).not.toContain('ARAna Ruizana@kinaxis.com');
    expect(options()).toHaveLength(5);
  });

  it('shows placeholder rows while the directory loads', async () => {
    api.directory.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.click(input());
    expect(screen.getAllByTestId('recipient-skeleton').length).toBeGreaterThan(0);
    // The teams are already there.
    expect(options()).toEqual(['Supply Planning12 people', 'Andes OpsTeam', 'FinanceTeam']);
  });

  it("says when the directory couldn't be read, and Retry asks again", async () => {
    api.directory.mockResolvedValueOnce({ reachable: false, people: [], truncated: false });
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.click(input());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your organization's directory");
    expect(options()).toEqual(['Supply Planning12 people', 'Andes OpsTeam', 'FinanceTeam']);

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(options()).toHaveLength(6));
    expect(api.directory).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input()).toHaveFocus();
  });

  describe('a truncated directory', () => {
    beforeEach(() => {
      api.directory.mockResolvedValue(directoryAnswer({ people: [ANA, ANDY], truncated: true }));
    });

    it('says so under the list', async () => {
      const user = userEvent.setup();
      render(<Harness allowExternal />);
      await user.click(input());
      expect(await screen.findByText('Showing the first 2 people. Type to search everyone.')).toBeInTheDocument();
    });

    it('also searches the hub for two or more typed characters, merged into People', async () => {
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness allowExternal spy={spy} />);
      await user.click(input());
      await waitFor(() => expect(options()).toHaveLength(5));
      await user.type(input(), 'b');
      expect(api.search).not.toHaveBeenCalled();
      await user.type(input(), 'o');

      await waitFor(() => expect(options()).toEqual(['BCBo Chenbo@kinaxis.com']));
      expect(api.search).toHaveBeenLastCalledWith('bo', expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(screen.getByRole('listbox')).toHaveTextContent('People in Kinaxis');
      await user.keyboard('{Enter}');
      expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-bo'], emails: [] });
    });

    it('lists a person found both ways once', async () => {
      const user = userEvent.setup();
      render(<Harness allowExternal />);
      await user.click(input());
      await waitFor(() => expect(options()).toHaveLength(5));
      await user.type(input(), 'ana');
      await waitFor(() => expect(api.search).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByText(/Searching everyone/)).toBeNull());
      expect(options()).toEqual(['ARAna Ruizana@kinaxis.com']);
    });
  });

  it('adds a picked person and a picked team as rows, newest on top, and hides them from suggestions', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    await user.click(input());
    await screen.findByRole('option', { name: /Ana Ruiz/ });
    await user.type(input(), 'ana');
    await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
    expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-ana'], emails: [] });
    // A click closes the menu so the new row is in view.
    expect(screen.queryByRole('listbox')).toBeNull();

    await user.click(input());
    await user.click(await screen.findByRole('option', { name: /Finance/ }));
    expect(spy).toHaveBeenLastCalledWith({ teamIds: ['t-finance'], userIds: ['u-ana'], emails: [] });
    expect(rows()).toEqual([['Finance', 'Team'], ['Ana Ruiz', 'ana@kinaxis.com']]);
    await user.click(input());
    await screen.findByRole('listbox');
    expect(options()).not.toContain('FinanceTeam');
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
    await waitFor(() => expect(options()).toHaveLength(6));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Andes Ops/ }).id);
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
    await screen.findByRole('option', { name: /Ana Ruiz/ });
    fireEvent.paste(input(), { clipboardData: { getData: () => 'Ana@Kinaxis.com, zed@partner.io;\nnope bo@kinaxis.com' } });

    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({
      teamIds: [], userIds: ['u-ana', 'u-bo'], emails: ['zed@partner.io'],
    }));
    expect(screen.getByRole('alert')).toHaveTextContent('Not added: nope (not an email)');
    expect(summary()).toBe('2 people · 1 outside Kinaxis');
    // The directory knew both people: nobody was searched for.
    expect(api.search).not.toHaveBeenCalled();
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
      expect(api.directory).not.toHaveBeenCalled();
    });
  });
});
