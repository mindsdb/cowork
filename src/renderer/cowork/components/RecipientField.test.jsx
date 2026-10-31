import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

const api = vi.hoisted(() => ({ byIds: vi.fn(), byEmails: vi.fn(), directory: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHubPeopleByIds: api.byIds,
  fetchHubPeopleByEmails: api.byEmails,
  fetchHubDirectory: api.directory,
}));
// The person signed in. The directory leaves them out, as the auth service's
// member list does.
const account = vi.hoisted(() => ({ user: null }));
vi.mock('../hooks/useAccountUser', () => ({ useAccountUser: () => account.user }));

import RecipientField from './RecipientField';
import { __resetOrgSharingForTests } from '../hooks/useOrgSharing';

const ANA = { id: 'u-ana', name: 'Ana Ruiz', email: 'ana@acme.com' };
const ANDY = { id: 'u-andy', name: 'Andy Park', email: 'andy@acme.com' };
const BO = { id: 'u-bo', name: 'Bo Chen', email: 'bo@acme.com' };
const DIRECTORY = [ANA, ANDY, BO];
const directoryAnswer = (over = {}) => ({ reachable: true, people: DIRECTORY, truncated: false, ...over });

const TEAMS = {
  status: 'ready',
  reachable: true,
  teams: [
    { id: 't-all', display_name: 'All members', is_default: true },
    { id: 't-platform', display_name: 'Platform' },
    { id: 't-andes', display_name: 'Andes Ops' },
    { id: 't-finance', display_name: 'Finance' },
  ],
};

beforeEach(() => {
  __resetOrgSharingForTests();
  account.user = { name: 'Mia Lane', email: 'Mia@Acme.com', sub: 'u-mia' };
  api.directory.mockReset();
  api.directory.mockImplementation(async () => directoryAnswer());
  api.byIds.mockReset();
  api.byIds.mockImplementation(async (ids) => ({ reachable: true, people: DIRECTORY.filter((p) => ids.includes(p.id)) }));
  // The whole org is DIRECTORY, whatever part of it the directory read sends.
  api.byEmails.mockReset();
  api.byEmails.mockImplementation(async (emails) => ({
    reachable: true, people: DIRECTORY.filter((p) => emails.includes(p.email)), unanswered: [],
  }));
});

function Harness({ initial = {}, spy = () => {}, ...props }) {
  const [value, setValue] = useState({ teamIds: [], userIds: [], emails: [], ...initial });
  return (
    <RecipientField
      value={value}
      onChange={(next) => { spy(next); setValue(next); }}
      orgName="Acme"
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
      'PlatformTeam', 'Andes OpsTeam', 'FinanceTeam',
      'ARAna Ruizana@acme.com', 'APAndy Parkandy@acme.com', 'BCBo Chenbo@acme.com',
    ]));
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveTextContent('Teams');
    expect(listbox).toHaveTextContent('People in Acme');
    expect(listbox).not.toHaveTextContent('All members');
    expect(api.directory).toHaveBeenCalledTimes(1);
  });

  it('says so when nobody else is in the org, instead of dropping the people group', async () => {
    api.directory.mockImplementation(async () => directoryAnswer({ people: [] }));
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.click(input());

    const listbox = await screen.findByRole('listbox');
    await waitFor(() => expect(listbox).toHaveTextContent('No one else is in Acme yet.'));
    expect(listbox).toHaveTextContent('People in Acme');
    expect(within(listbox).getByRole('button', { name: /Invite people/ })).toBeTruthy();
    expect(screen.queryByText('Everyone you can add is already added.')).toBeNull();
  });

  it('says everyone is already added once every person is picked', async () => {
    const user = userEvent.setup();
    render(<Harness allowExternal initial={{ userIds: DIRECTORY.map((p) => p.id) }} />);
    await user.click(input());

    await waitFor(() => expect(screen.getByRole('listbox')).toHaveTextContent('Everyone in Acme is already added.'));
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
      'Andes OpsTeam', 'FinanceTeam',
      'ARAna Ruizana@acme.com', 'APAndy Parkandy@acme.com',
    ]);
    await user.type(input(), 'dy');
    expect(options()).toEqual(['APAndy Parkandy@acme.com']);
    await user.clear(input());
    await user.type(input(), 'BO@AC');
    expect(options()).toEqual(['BCBo Chenbo@acme.com']);
    expect(api.directory).toHaveBeenCalledTimes(1);
  });

  it('ignores case and accents', async () => {
    api.directory.mockResolvedValue(directoryAnswer({ people: [...DIRECTORY, { id: 'u-jose', name: 'José López', email: 'jose@acme.com' }] }));
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.click(input());
    await waitFor(() => expect(options()).toHaveLength(7));
    await user.type(input(), 'lopez');
    expect(options()).toEqual(['JLJosé Lópezjose@acme.com']);
    await user.clear(input());
    await user.type(input(), 'JOSÉ');
    expect(options()).toEqual(['JLJosé Lópezjose@acme.com']);
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
    expect(options()).not.toContain('ARAna Ruizana@acme.com');
    expect(options()).toHaveLength(5);
  });

  it('shows placeholder rows while the directory loads', async () => {
    api.directory.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.click(input());
    expect(screen.getAllByTestId('recipient-skeleton').length).toBeGreaterThan(0);
    // The teams are already there.
    expect(options()).toEqual(['PlatformTeam', 'Andes OpsTeam', 'FinanceTeam']);
  });

  it("says when the directory couldn't be read, and Retry asks again", async () => {
    api.directory.mockResolvedValueOnce({ reachable: false, people: [], truncated: false });
    const user = userEvent.setup();
    render(<Harness allowExternal />);
    await user.click(input());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your organization's directory");
    expect(options()).toEqual(['PlatformTeam', 'Andes OpsTeam', 'FinanceTeam']);

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(options()).toHaveLength(6));
    expect(api.directory).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input()).toHaveFocus();
  });

  it('holds a paste made while the directory loads, says Checking…, and resolves it once loaded', async () => {
    let answer;
    api.directory.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    fireEvent.focus(input());
    fireEvent.paste(input(), { clipboardData: { getData: () => 'bo@acme.com, zed@partner.io' } });

    expect(summary()).toBe('Checking…');
    expect(input()).toHaveValue('bo@acme.com zed@partner.io');
    expect(spy).not.toHaveBeenCalled();

    answer(directoryAnswer());
    // The member is added as the person, never as an outside address.
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({
      teamIds: [], userIds: ['u-bo'], emails: ['zed@partner.io'],
    }));
    expect(input()).toHaveValue('');
    expect(summary()).toBe('1 person · 1 outside Acme');
  });

  it('holds a typed email entered while the directory loads', async () => {
    let answer;
    api.directory.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    await user.type(input(), 'ana@acme.com{Enter}');
    expect(summary()).toBe('Checking…');
    expect(spy).not.toHaveBeenCalled();

    answer(directoryAnswer());
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-ana'], emails: [] }));
  });

  it('keeps a paste in the input and adds nothing when the directory failed, until Retry', async () => {
    api.directory.mockResolvedValueOnce({ reachable: false, people: [], truncated: false });
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    await user.click(input());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your organization's directory");
    fireEvent.paste(input(), { clipboardData: { getData: () => 'bo@acme.com zed@partner.io' } });

    expect(input()).toHaveValue('bo@acme.com zed@partner.io');
    expect(spy).not.toHaveBeenCalled();
    expect(summary()).not.toBe('Checking…');
    await user.keyboard('{Enter}');
    expect(spy).not.toHaveBeenCalled();
    expect(input()).toHaveValue('bo@acme.com zed@partner.io');

    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await user.click(input());
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-bo'], emails: ['zed@partner.io'] });
  });

  it('holds a paste made before a failed load, then leaves it in the input', async () => {
    let answer;
    api.directory.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    fireEvent.focus(input());
    fireEvent.paste(input(), { clipboardData: { getData: () => 'bo@acme.com zed@partner.io' } });
    expect(summary()).toBe('Checking…');

    answer({ reachable: false, people: [], truncated: false });
    await screen.findByRole('alert');
    await waitFor(() => expect(summary()).not.toBe('Checking…'));
    expect(input()).toHaveValue('bo@acme.com zed@partner.io');
    expect(spy).not.toHaveBeenCalled();
  });

  describe('a truncated directory', () => {
    // Bo is in the org, past the end of what the directory read sends.
    beforeEach(() => {
      api.directory.mockResolvedValue(directoryAnswer({ people: [ANA, ANDY], truncated: true }));
    });

    it('says how many it shows under the list', async () => {
      const user = userEvent.setup();
      render(<Harness allowExternal />);
      await user.click(input());
      expect(await screen.findByText('Showing the first 2 people.')).toBeInTheDocument();
      expect(screen.queryByText(/Type to search/)).toBeNull();
    });

    it('filters only what it loaded', async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());
      await waitFor(() => expect(options()).toHaveLength(5));
      await user.type(input(), 'bo');
      expect(screen.queryByRole('option', { name: /Bo Chen/ })).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent('No matches');
    });

    it('adds a typed email of a member past its end as that person, never as an outside email', async () => {
      let answer;
      api.byEmails.mockImplementationOnce((emails) => new Promise((resolve) => {
        answer = () => resolve({ reachable: true, people: DIRECTORY.filter((p) => emails.includes(p.email)), unanswered: [] });
      }));
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness allowExternal spy={spy} />);
      await user.click(input());
      await waitFor(() => expect(options()).toHaveLength(5));
      await user.type(input(), 'bo@acme.com');
      await screen.findByRole('option', { name: 'Invite bo@acme.com (outside Acme)' });
      await user.keyboard('{Enter}');

      expect(summary()).toBe('Checking…');
      expect(api.byEmails).toHaveBeenCalledWith(['bo@acme.com']);
      expect(spy).not.toHaveBeenCalled();
      answer();

      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-bo'], emails: [] }));
      expect(spy.mock.calls.every(([value]) => value.emails.length === 0)).toBe(true);
      await waitFor(() => expect(rows()).toEqual([['Bo Chen', 'bo@acme.com']]));
    });

    it('adds a member past its end as that person when Invite is picked', async () => {
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness allowExternal spy={spy} />);
      await user.click(input());
      await waitFor(() => expect(options()).toHaveLength(5));
      await user.type(input(), 'bo@acme.com');
      await user.click(await screen.findByRole('option', { name: 'Invite bo@acme.com (outside Acme)' }));

      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-bo'], emails: [] }));
      expect(spy.mock.calls.every(([value]) => value.emails.length === 0)).toBe(true);
    });

    it('takes a typed email no member holds as an outside one when allowed', async () => {
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness allowExternal spy={spy} />);
      await user.click(input());
      await waitFor(() => expect(options()).toHaveLength(5));
      await user.type(input(), 'zed@partner.io{Enter}');

      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: [], emails: ['zed@partner.io'] }));
      expect(api.byEmails).toHaveBeenCalledTimes(1);
    });

    it('finds pasted members past its end and reports the rest as not in the org when only the org is allowed', async () => {
      const spy = vi.fn();
      render(<Harness spy={spy} />);
      fireEvent.focus(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });
      fireEvent.paste(input(), { clipboardData: { getData: () => 'ana@acme.com Bo@acme.com zed@acme.com' } });

      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-ana', 'u-bo'], emails: [] }));
      expect(screen.getByRole('alert')).toHaveTextContent('Not added: zed@acme.com (not in Acme)');
      // Only the addresses the directory doesn't have are asked about, once.
      expect(api.byEmails.mock.calls).toEqual([[['bo@acme.com', 'zed@acme.com']]]);
    });

    it('offers a member it found past its end when their address is typed again', async () => {
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness allowExternal spy={spy} />);
      await user.click(input());
      await waitFor(() => expect(options()).toHaveLength(5));
      await user.type(input(), 'bo@acme.com{Enter}');
      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-bo'], emails: [] }));
      await user.click(await screen.findByRole('button', { name: 'Remove Bo Chen' }));

      await user.type(input(), 'bo@acme.com');

      expect(await screen.findByRole('option', { name: /Bo Chen/ })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /Invite/ })).toBeNull();
      await user.keyboard('{Enter}');
      expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-bo'], emails: [] });
      expect(api.byEmails).toHaveBeenCalledTimes(1);
    });

    it("keeps an address in the input, never as an outside email, when the hub can't be asked about it", async () => {
      api.byEmails.mockResolvedValueOnce({ reachable: false, people: [], unanswered: ['bo@acme.com'] });
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness allowExternal spy={spy} />);
      await user.click(input());
      await waitFor(() => expect(options()).toHaveLength(5));

      await user.type(input(), 'bo@acme.com{Enter}');

      expect(await screen.findByRole('alert')).toHaveTextContent("Not added: bo@acme.com (couldn't check who is in Acme, try again)");
      expect(input()).toHaveValue('bo@acme.com');
      expect(spy).not.toHaveBeenCalled();

      // Enter asks again.
      await user.keyboard('{Enter}');
      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-bo'], emails: [] }));
      expect(api.byEmails).toHaveBeenCalledTimes(2);
    });
  });

  describe('an address the loaded directory does not have', () => {
    const realNow = Date.now.bind(Date);
    // The directory answers without Bo first, and with him once read again.
    const loadWithoutBo = (over = {}) => {
      api.directory
        .mockResolvedValueOnce(directoryAnswer({ people: [ANA, ANDY], ...over }))
        .mockResolvedValue(directoryAnswer({ people: [ANA, ANDY, BO], ...over }));
    };
    let clock = null;
    const ageDirectory = () => { clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 61 * 1000); };
    afterEach(() => { clock?.mockRestore(); clock = null; });

    it('reads a directory over a minute old again, once, and finds them there', async () => {
      loadWithoutBo();
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness spy={spy} />);
      await user.click(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });
      ageDirectory();

      await user.type(input(), 'bo@acme.com{Enter}');

      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-bo'], emails: [] }));
      expect(api.directory).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('adds them as a person, not an outside email, when Invite is picked on an old directory', async () => {
      loadWithoutBo();
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness allowExternal spy={spy} />);
      await user.click(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });
      ageDirectory();

      await user.type(input(), 'bo@acme.com');
      await user.click(await screen.findByRole('option', { name: 'Invite bo@acme.com (outside Acme)' }));

      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-bo'], emails: [] }));
      expect(api.directory).toHaveBeenCalledTimes(2);
    });

    it('keeps the address in the input, never as an outside email, when the directory could not be read again', async () => {
      api.directory
        .mockResolvedValueOnce(directoryAnswer({ people: [ANA, ANDY] }))
        .mockResolvedValueOnce({ reachable: false, people: [], truncated: false })
        .mockResolvedValue(directoryAnswer({ people: [ANA, ANDY, BO] }));
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness allowExternal spy={spy} />);
      await user.click(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });
      ageDirectory();

      await user.type(input(), 'bo@acme.com{Enter}');

      expect(await screen.findByRole('alert')).toHaveTextContent("Not added: bo@acme.com (couldn't check who is in Acme, try again)");
      expect(input()).toHaveValue('bo@acme.com');
      expect(spy).not.toHaveBeenCalled();
      expect(api.directory).toHaveBeenCalledTimes(2);

      // Enter asks again, and the fresh copy has him.
      await user.keyboard('{Enter}');
      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-bo'], emails: [] }));
      expect(spy.mock.calls.every(([value]) => value.emails.length === 0)).toBe(true);
    });

    it('does not read a fresh directory again', async () => {
      loadWithoutBo();
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });

      await user.type(input(), 'bo@acme.com{Enter}');

      expect(await screen.findByRole('alert')).toHaveTextContent('Not added: bo@acme.com (not in Acme)');
      expect(api.directory).toHaveBeenCalledTimes(1);
    });

    it('asks the hub about them once a truncated directory is read again, and says not in the org, for org-only sharing', async () => {
      api.directory.mockResolvedValue(directoryAnswer({ people: [ANA, ANDY], truncated: true }));
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });
      ageDirectory();

      await user.type(input(), 'zed@acme.com{Enter}');

      expect(await screen.findByRole('alert')).toHaveTextContent('Not added: zed@acme.com (not in Acme)');
      expect(api.directory).toHaveBeenCalledTimes(2);
      expect(api.byEmails.mock.calls).toEqual([[['zed@acme.com']]]);
    });

    it('asks the hub again about an address it said no member holds once the directory is read again', async () => {
      const ZED = { id: 'u-zed', name: 'Zed Ito', email: 'zed@acme.com' };
      api.directory.mockResolvedValue(directoryAnswer({ people: [ANA, ANDY], truncated: true }));
      api.byEmails
        .mockResolvedValueOnce({ reachable: true, people: [], unanswered: [] })
        .mockResolvedValue({ reachable: true, people: [ZED], unanswered: [] });
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness spy={spy} />);
      await user.click(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });
      await user.type(input(), 'zed@acme.com{Enter}');
      expect(await screen.findByRole('alert')).toHaveTextContent('Not added: zed@acme.com (not in Acme)');

      // A minute on, Zed has joined.
      ageDirectory();
      await user.type(input(), 'zed@acme.com{Enter}');

      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-zed'], emails: [] }));
      expect(api.directory).toHaveBeenCalledTimes(2);
      expect(api.byEmails).toHaveBeenCalledTimes(2);
    });

    it('asks the hub again when the directory goes old while it answers, since the new read drops the answer', async () => {
      const ZED = { id: 'u-zed', name: 'Zed Ito', email: 'zed@acme.com' };
      api.directory.mockResolvedValue(directoryAnswer({ people: [ANA, ANDY], truncated: true }));
      let answer;
      api.byEmails
        .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }))
        .mockResolvedValue({ reachable: true, people: [ZED], unanswered: [] });
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness spy={spy} />);
      await user.click(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });
      await user.type(input(), 'zed@acme.com{Enter}');
      expect(summary()).toBe('Checking…');

      ageDirectory();
      answer({ reachable: true, people: [], unanswered: [] });

      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-zed'], emails: [] }));
      expect(api.directory).toHaveBeenCalledTimes(2);
      expect(api.byEmails).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('adds them as outside when a truncated directory still does not have them and outside emails are allowed', async () => {
      api.directory.mockResolvedValue(directoryAnswer({ people: [ANA, ANDY], truncated: true }));
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness allowExternal spy={spy} />);
      await user.click(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });
      ageDirectory();

      await user.type(input(), 'zed@acme.com{Enter}');

      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: [], emails: ['zed@acme.com'] }));
      expect(api.directory).toHaveBeenCalledTimes(2);
      expect(api.byEmails.mock.calls).toEqual([[['zed@acme.com']]]);
      await waitFor(() => expect(rows()).toEqual([['zed@acme.com', 'Outside Acme']]));
    });
  });

  describe('the address of the person signed in', () => {
    it('is refused as "that\'s you", never invited as an outside email', async () => {
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Harness allowExternal spy={spy} />);
      await user.click(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });

      await user.type(input(), 'mia@acme.com');
      expect(screen.getByRole('status')).toHaveTextContent("That's you");
      expect(screen.queryByRole('option', { name: /Invite/ })).toBeNull();
      await user.keyboard('{Enter}');

      expect(await screen.findByRole('alert')).toHaveTextContent("Not added: mia@acme.com (that's you)");
      expect(spy).not.toHaveBeenCalled();
    });

    it('is refused from a paste while the rest is added', async () => {
      const spy = vi.fn();
      render(<Harness allowExternal spy={spy} />);
      fireEvent.focus(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });
      fireEvent.paste(input(), { clipboardData: { getData: () => 'ana@acme.com MIA@acme.com zed@partner.io' } });

      await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-ana'], emails: ['zed@partner.io'] }));
      expect(screen.getByRole('alert')).toHaveTextContent("Not added: mia@acme.com (that's you)");
    });

    it('does not send an old directory to be read again', async () => {
      const realNow = Date.now.bind(Date);
      const user = userEvent.setup();
      render(<Harness allowExternal />);
      await user.click(input());
      await screen.findByRole('option', { name: /Ana Ruiz/ });
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 61 * 1000);
      try {
        await user.type(input(), 'mia@acme.com{Enter}');
        expect(await screen.findByRole('alert')).toHaveTextContent("Not added: mia@acme.com (that's you)");
        expect(api.directory).toHaveBeenCalledTimes(1);
      } finally {
        clock.mockRestore();
      }
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
    expect(rows()).toEqual([['Finance', 'Team'], ['Ana Ruiz', 'ana@acme.com']]);
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

    const invite = await screen.findByRole('option', { name: 'Invite zed@partner.io (outside Acme)' });
    expect(invite).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: [], emails: ['zed@partner.io'] });
    expect(summary()).toBe('1 outside Acme');
    expect(rows()).toEqual([['zed@partner.io', 'Outside Acme']]);
    expect(screen.getByRole('button', { name: 'Remove zed@partner.io' })).toBeInTheDocument();
  });

  it('adds a typed email someone in the org has as that person', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    await user.type(input(), 'bo@acme.com');
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

    expect(await screen.findByText('Only people in Acme')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Invite/ })).toBeNull();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not added: zed@partner.io (not in Acme)');
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

    await user.type(input(), 'plat,');
    expect(spy).toHaveBeenLastCalledWith({ teamIds: ['t-andes', 't-finance', 't-platform'], userIds: [], emails: [] });

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
    expect(rows()).toEqual([['Ana Ruiz', 'ana@acme.com']]);
  });

  it('lists stored recipients as rows with their second line', async () => {
    render(<Harness allowExternal initial={{ teamIds: ['t-platform', 't-andes'], userIds: ['u-ana'], emails: ['zed@partner.io'] }} />);
    await waitFor(() => expect(list()).toHaveTextContent('Ana Ruiz'));
    expect(rows()).toEqual([
      ['Platform', 'Team'],
      ['Andes Ops', 'Team'],
      ['Ana Ruiz', 'ana@acme.com'],
      ['zed@partner.io', 'Outside Acme'],
    ]);
    const kinds = within(list()).getAllByRole('listitem').map((row) => row.getAttribute('data-recipient-row'));
    expect(kinds).toEqual(['team', 'team', 'person', 'outside']);
    // A person's tile is their initials.
    expect(within(list()).getAllByRole('listitem')[2]).toHaveTextContent(/^AR/);
  });

  it('adds each address of a paste: org people as people, the rest as outside emails', async () => {
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} />);
    fireEvent.focus(input());
    await screen.findByRole('option', { name: /Ana Ruiz/ });
    fireEvent.paste(input(), { clipboardData: { getData: () => 'Ana@Acme.com, zed@partner.io;\nnope bo@acme.com' } });

    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({
      teamIds: [], userIds: ['u-ana', 'u-bo'], emails: ['zed@partner.io'],
    }));
    expect(screen.getByRole('alert')).toHaveTextContent('Not added: nope (not an email)');
    expect(summary()).toBe('2 people · 1 outside Acme');
    await waitFor(() => expect(rows().map((r) => r[0])).toEqual(['Ana Ruiz', 'Bo Chen', 'zed@partner.io']));
  });

  it('reports pasted outside addresses as not added when only the org is allowed', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.focus(input());
    await screen.findByRole('option', { name: /Ana Ruiz/ });
    fireEvent.paste(input(), { clipboardData: { getData: () => 'ana@acme.com zed@partner.io' } });

    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ teamIds: [], userIds: ['u-ana'], emails: [] }));
    expect(screen.getByRole('alert')).toHaveTextContent('Not added: zed@partner.io (not in Acme)');
  });

  it('names stored people and teams, showing ones nobody knows as Unknown', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness allowExternal spy={spy} initial={{ teamIds: ['t-platform', 't-gone'], userIds: ['u-bo', 'u-gone'] }} />);
    await waitFor(() => expect(list()).toHaveTextContent('Bo Chen'));
    expect(rows()).toEqual([
      ['Platform', 'Team'],
      ['Unknown team', 'Team'],
      ['Bo Chen', 'bo@acme.com'],
      ['Unknown person'],
    ]);
    expect(api.byIds).toHaveBeenCalledWith(['u-bo', 'u-gone']);
    expect(summary()).toBe('2 teams · 2 people');

    await user.click(screen.getByRole('button', { name: 'Remove Unknown person' }));
    await user.click(screen.getByRole('button', { name: 'Remove Unknown team' }));
    expect(spy).toHaveBeenLastCalledWith({ teamIds: ['t-platform'], userIds: ['u-bo'], emails: [] });
  });

  it('never takes people the hub could not be asked about for unknown, and asks again on Retry', async () => {
    api.byIds.mockImplementationOnce(async () => ({ reachable: false, people: [], unanswered: ['u-bo'] }));
    const user = userEvent.setup();
    render(<Harness allowExternal initial={{ userIds: ['u-bo', 'u-gone'] }} />);

    await waitFor(() => expect(rows()).toEqual([["Couldn't load name"], ['Unknown person']]));
    expect(screen.getByRole('button', { name: 'Remove Unknown person' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove person' })).toBeInTheDocument();
    expect(screen.getByText(/Couldn't load some names/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(rows()).toEqual([['Bo Chen', 'bo@acme.com'], ['Unknown person']]));
    expect(api.byIds).toHaveBeenLastCalledWith(['u-bo']);
    expect(screen.queryByText(/Couldn't load some names/)).toBeNull();
  });

  it('keeps every id of a lookup that failed outright as not loaded, and asks again on the next open', async () => {
    api.byIds.mockImplementationOnce(async () => ({ reachable: false, people: [] }));
    const { unmount } = render(<Harness initial={{ userIds: ['u-bo'] }} />);
    await waitFor(() => expect(rows()).toEqual([["Couldn't load name"]]));
    expect(screen.queryByText('Unknown person')).toBeNull();
    unmount();

    render(<Harness initial={{ userIds: ['u-bo'] }} />);
    await waitFor(() => expect(rows()).toEqual([['Bo Chen', 'bo@acme.com']]));
    expect(api.byIds).toHaveBeenCalledTimes(2);
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
    it('takes addresses without teams or the directory', async () => {
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
      expect(api.byIds).not.toHaveBeenCalled();
      expect(api.directory).not.toHaveBeenCalled();
    });
  });
});
