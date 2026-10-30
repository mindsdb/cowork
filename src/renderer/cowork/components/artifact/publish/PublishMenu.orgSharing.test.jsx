// Teams and "Everyone at ‹org›" in the restricted choice (ENG-3787).
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const people = vi.hoisted(() => ({ byIds: vi.fn(), directory: vi.fn() }));
vi.mock('../../../api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHubPeopleByIds: people.byIds,
  fetchHubDirectory: people.directory,
}));

import { PublishMenu } from './PublishMenu';
import { __resetOrgSharingForTests } from '../../../hooks/useOrgSharing';

const DIRECTORY = [
  { id: 'u-ana', name: 'Ana Ruiz', email: 'ana@acme.com' },
  { id: 'u-bo', name: 'Bo Chen', email: 'bo@acme.com' },
];

beforeEach(() => {
  __resetOrgSharingForTests();
  people.directory.mockReset();
  people.directory.mockImplementation(async () => ({ reachable: true, people: DIRECTORY, truncated: false }));
  people.byIds.mockReset();
  people.byIds.mockImplementation(async (ids) => ({
    reachable: true,
    people: DIRECTORY.filter((p) => ids.includes(p.id)),
  }));
});

const TEAMS = { status: 'ready', reachable: true, teams: [{ id: 't-platform', display_name: 'Platform' }] };

function makeController(overrides = {}) {
  return {
    publishedUrl: 'https://share/abc',
    phase: 'idle',
    busy: false,
    error: '',
    accessMode: 'restricted',
    accessPassword: '',
    accessEmails: [],
    allowedTeamIds: [],
    allowedUserIds: [],
    orgAllowed: false,
    ownerOnly: true,
    accessLoaded: true,
    versions: [],
    modified: false,
    supportsPublishRoutes: false,
    orgSharing: { enabled: true, orgName: 'Acme', teams: TEAMS },
    setError: vi.fn(),
    loadVersions: vi.fn(),
    publish: vi.fn(async () => true),
    unpublish: vi.fn(),
    activate: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

async function openAccessChange(user, option = /^Specific teams and people/) {
  await user.click(screen.getByText('Share'));
  await user.click(screen.getByText('Change'));
  if (option) await user.click(screen.getByRole('radio', { name: option }));
}

async function openChange(user) {
  await user.click(screen.getByText(/Shared/));
  await user.click(screen.getByText('Change'));
}

const radio = (name) => screen.getByRole('radio', { name });
const recipients = () => screen.getByRole('list', { name: 'Recipients' });

describe('PublishMenu with org sharing', () => {
  it('offers Only you, Everyone at the org, Specific teams and people, Password, Public in that order', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController()} />);
    await openAccessChange(user, null);

    const names = screen.getAllByRole('radio').map((r) => r.textContent);
    expect(names).toEqual([
      'Only youNobody else can open this',
      'Everyone at AcmeAnyone in your organization',
      'Specific teams and peoplePick teams, colleagues or outside emails',
      expect.stringMatching(/^Password protected/),
      expect.stringMatching(/^Public/),
    ]);
    // No nested checkboxes any more.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('sends Everyone at the org as org_allowed with no lists', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user, /^Everyone at Acme/);
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(pub.publish).toHaveBeenCalledWith({
      mode: 'restricted',
      org_allowed: true,
      allowed_team_ids: [],
      allowed_user_ids: [],
      allowed_emails: [],
      owner_only: false,
      emails: [],
      team_ids: [],
    });
  });

  it('unfolds the recipient field inside the Specific card, before Password protected', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController()} />);
    await openAccessChange(user, null);
    expect(screen.queryByTestId('specific-recipients')).toBeNull();

    await user.click(radio(/^Specific teams and people/));
    const editor = screen.getByTestId('specific-recipients');
    expect(within(editor).getByRole('combobox', { name: 'Add teams, people or emails' })).toBeInTheDocument();
    const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(radio(/^Specific teams and people/), editor)).toBe(true);
    expect(follows(editor, radio(/^Password protected/))).toBe(true);
    // Directly under its own card, in the same wrapper.
    expect(editor.parentElement).toContainElement(radio(/^Specific teams and people/));
    expect(editor.parentElement).not.toContainElement(radio(/^Password protected/));
  });

  it('sends teams, people in the org and outside emails apart', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user);

    const field = screen.getByRole('combobox', { name: 'Add teams, people or emails' });
    await user.click(field);
    await user.click(screen.getByRole('option', { name: /Platform/ }));
    await user.type(field, 'ana');
    await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
    await user.type(field, 'Zed@Partner.io');
    await user.click(await screen.findByRole('option', { name: /Invite zed@partner.io/ }));
    expect(screen.getByTestId('recipient-summary')).toHaveTextContent('1 team · 1 person · 1 outside Acme');

    await user.click(screen.getByRole('button', { name: 'Update' }));
    // Two people are added one by one: asked first.
    expect(pub.publish).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    expect(pub.publish).toHaveBeenCalledWith({
      mode: 'restricted',
      org_allowed: false,
      allowed_team_ids: ['t-platform'],
      allowed_user_ids: ['u-ana'],
      allowed_emails: ['zed@partner.io'],
      owner_only: false,
      // The names cowork-server's publish still reads.
      emails: ['zed@partner.io'],
      team_ids: ['t-platform'],
      // Exactly the people this save adds.
      notify: { user_ids: ['u-ana'], emails: ['zed@partner.io'] },
    });
  });

  it('keeps Update disabled until Specific names someone', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user);

    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
    expect(screen.getByTestId('recipient-summary')).toHaveTextContent('Add at least one team, person or email.');
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Platform/ }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(pub.publish).toHaveBeenCalledWith(expect.objectContaining({
      allowed_team_ids: ['t-platform'], org_allowed: false, owner_only: false,
    }));
  });

  it('reads org_allowed with no lists as Everyone at the org', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({ orgAllowed: true, ownerOnly: false })} />);
    expect(screen.getByText(/Shared/)).toBeInTheDocument();
    await openChange(user);
    expect(radio(/^Everyone at Acme/)).toHaveAttribute('aria-checked', 'true');
  });

  it('reads stored lists as Specific teams and people, naming them as rows', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({
      allowedTeamIds: ['t-platform'], allowedUserIds: ['u-bo', 'u-gone'], accessEmails: ['zed@partner.io'], ownerOnly: false,
    })} />);
    await openChange(user);

    expect(radio(/^Specific teams and people/)).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(recipients()).toHaveTextContent('Bo Chen'));
    expect(recipients()).toHaveTextContent('Platform');
    expect(recipients()).toHaveTextContent('Unknown person');
    expect(recipients()).toHaveTextContent('zed@partner.io');
    expect(people.byIds).toHaveBeenCalledWith(['u-bo', 'u-gone']);
  });

  it("reads the org's default team as Everyone at the org, and never offers it as a team", async () => {
    const user = userEvent.setup();
    const withDefault = { ...TEAMS, teams: [{ id: 't-all', display_name: 'All members', is_default: true }, ...TEAMS.teams] };
    render(<PublishMenu controller={makeController({
      allowedTeamIds: ['t-all'], ownerOnly: false,
      orgSharing: { enabled: true, orgName: 'Acme', teams: withDefault },
    })} />);
    await openChange(user);

    expect(radio(/^Everyone at Acme/)).toHaveAttribute('aria-checked', 'true');
    await user.click(radio(/^Specific teams and people/));
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: /Platform/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /All members/ })).toBeNull();
  });

  it('reads org_allowed with lists as Everyone, keeping the lists for Specific', async () => {
    const user = userEvent.setup();
    const pub = makeController({ orgAllowed: true, allowedTeamIds: ['t-platform'], ownerOnly: false });
    render(<PublishMenu controller={pub} />);
    await openChange(user);

    expect(radio(/^Everyone at Acme/)).toHaveAttribute('aria-checked', 'true');
    await user.click(radio(/^Specific teams and people/));
    expect(recipients()).toHaveTextContent('Platform');
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(pub.publish).toHaveBeenCalledWith(expect.objectContaining({
      org_allowed: false, allowed_team_ids: ['t-platform'],
    }));
  });

  it('summarises Everyone at the org on the summary card', () => {
    render(<PublishMenu controller={makeController({ orgAllowed: true, ownerOnly: false })} />);
    // The popover is closed; the summary is what opening it shows.
    return userEvent.setup().click(screen.getByText(/Shared/)).then(() => {
      expect(screen.getByText('Everyone at Acme')).toBeInTheDocument();
      expect(screen.getByText('Anyone in your organization')).toBeInTheDocument();
    });
  });

  it('says when the teams could not be loaded', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({
      orgSharing: { enabled: true, orgName: 'Acme', teams: { status: 'ready', reachable: false, teams: [] } },
    })} />);
    await openAccessChange(user);
    await user.click(screen.getByRole('combobox'));

    expect(screen.getByText("Couldn't load your teams. Try again later.")).toBeInTheDocument();
  });

  it('drops an Unknown person and sends the rest', async () => {
    const user = userEvent.setup();
    const pub = makeController({ allowedUserIds: ['u-bo', 'u-gone'], ownerOnly: false });
    render(<PublishMenu controller={pub} />);
    await openChange(user);

    await user.click(await screen.findByRole('button', { name: 'Remove Unknown person' }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(pub.publish).toHaveBeenCalledWith(expect.objectContaining({
      allowed_user_ids: ['u-bo'], allowed_emails: [], owner_only: false,
    }));
  });

  it('offers Specific people by email only without org sharing', async () => {
    const user = userEvent.setup();
    const pub = makeController({ orgSharing: { enabled: false, orgName: null, teams: TEAMS } });
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user, /^Specific people/);

    expect(screen.queryByRole('radio', { name: /^Everyone/ })).toBeNull();
    expect(radio(/^Specific people/)).toHaveTextContent('Only the people you list');
    const field = screen.getByRole('combobox', { name: 'Add people by email' });
    await user.click(field);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();

    await user.type(field, 'Zed@Partner.io{Enter}');
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(screen.getByTestId('notify-confirm')).toHaveTextContent('Let 1 new person know by email?');
    expect(screen.getByTestId('notify-confirm')).toHaveTextContent('zed@partner.io');
    await user.click(screen.getByRole('button', { name: "Don't notify" }));
    expect(pub.publish).toHaveBeenCalledWith({ mode: 'restricted', emails: ['zed@partner.io'], org_allowed: false, owner_only: false });
    expect(within(document.body).queryByText(/Acme/)).toBeNull();
  });
  describe('the collapsed summary', () => {
    const open = (user) => user.click(screen.getByText(/Shared/));
    const sharedWith = () => screen.getByRole('list', { name: 'Shared with' });
    const names = () => within(sharedWith()).getAllByRole('listitem').map((row) => row.querySelector('span.truncate').textContent);

    it('lists who it is shared with, without clicking Change', async () => {
      const user = userEvent.setup();
      render(<PublishMenu controller={makeController({
        allowedTeamIds: ['t-platform'], allowedUserIds: ['u-ana'], accessEmails: ['zed@partner.io'], ownerOnly: false,
      })} />);
      await open(user);

      expect(screen.getByTestId('access-summary')).toHaveTextContent('Specific teams and people');
      expect(screen.getByTestId('access-summary')).toHaveTextContent('1 team · 1 person · 1 outside Acme');
      await waitFor(() => expect(names()).toEqual(['Platform', 'Ana Ruiz', 'zed@partner.io']));
      expect(sharedWith()).toHaveTextContent('Outside Acme');
      // Read only.
      expect(within(sharedWith()).queryByRole('button')).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('shows the first four and +N more, which expands the rest', async () => {
      const user = userEvent.setup();
      const emails = ['a@x.io', 'b@x.io', 'c@x.io', 'd@x.io', 'e@x.io', 'f@x.io', 'g@x.io'];
      render(<PublishMenu controller={makeController({
        allowedTeamIds: ['t-platform'], accessEmails: emails, ownerOnly: false,
      })} />);
      await open(user);

      expect(names()).toEqual(['Platform', 'a@x.io', 'b@x.io', 'c@x.io']);
      await user.click(screen.getByRole('button', { name: '+4 more' }));
      expect(names()).toEqual(['Platform', ...emails]);
      expect(screen.queryByRole('button', { name: /more$/ })).toBeNull();
    });

    it('says Everyone at the org plainly, with no list', async () => {
      const user = userEvent.setup();
      render(<PublishMenu controller={makeController({ orgAllowed: true, ownerOnly: false })} />);
      await open(user);
      expect(screen.getByTestId('access-summary')).toHaveTextContent('Everyone at Acme');
      expect(screen.queryByRole('list', { name: 'Shared with' })).toBeNull();
    });

    it('lists the emails of Specific people without org sharing', async () => {
      const user = userEvent.setup();
      render(<PublishMenu controller={makeController({
        accessEmails: ['zed@partner.io', 'amy@partner.io'], ownerOnly: false,
        orgSharing: { enabled: false, orgName: null, teams: TEAMS },
      })} />);
      await open(user);
      expect(screen.getByTestId('access-summary')).toHaveTextContent('Specific people');
      expect(screen.getByTestId('access-summary')).toHaveTextContent('2 people');
      expect(names()).toEqual(['zed@partner.io', 'amy@partner.io']);
      expect(people.byIds).not.toHaveBeenCalled();
    });
  });

  describe('asking whether to notify added people', () => {
    it('asks only when people are added one by one, listing them with +N more', async () => {
      const user = userEvent.setup();
      const pub = makeController({ allowedUserIds: ['u-bo'], ownerOnly: false });
      render(<PublishMenu controller={pub} />);
      await openChange(user);

      const field = screen.getByRole('combobox', { name: 'Add teams, people or emails' });
      await user.type(field, 'ana');
      await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
      fireEvent.paste(field, { clipboardData: { getData: () => 'a@x.io b@x.io c@x.io' } });
      await waitFor(() => expect(screen.getByTestId('recipient-summary')).toHaveTextContent('2 people · 3 outside Acme'));
      await user.click(screen.getByRole('button', { name: 'Update' }));

      const confirm = screen.getByTestId('notify-confirm');
      expect(confirm).toHaveTextContent('Let 4 new people know by email?');
      // Bo was already there: not counted.
      await waitFor(() => expect(confirm).toHaveTextContent('Ana Ruiz, a@x.io, b@x.io +1 more'));
      expect(confirm).not.toHaveTextContent('Bo Chen');
      expect(screen.getByRole('button', { name: 'Notify' })).toHaveFocus();
      expect(pub.publish).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: "Don't notify" }));
      expect(pub.publish).toHaveBeenCalledTimes(1);
      expect(pub.publish).toHaveBeenCalledWith(expect.objectContaining({
        allowed_user_ids: ['u-bo', 'u-ana'], allowed_emails: ['a@x.io', 'b@x.io', 'c@x.io'],
      }));
      // Don't notify sends no notify at all.
      expect(pub.publish.mock.calls[0][0]).not.toHaveProperty('notify');
    });

    it('sends notify with the added people on Notify, on a first share too', async () => {
      const user = userEvent.setup();
      const pub = makeController({ publishedUrl: '', ownerOnly: false });
      render(<PublishMenu controller={pub} />);
      await user.click(screen.getByText('Share'));
      await user.click(radio(/^Specific teams and people/));
      await user.type(screen.getByRole('combobox'), 'ana');
      await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
      // The footer's Share, not the trigger.
      await user.click(screen.getAllByRole('button', { name: 'Share' }).at(-1));

      expect(screen.getByTestId('notify-confirm')).toHaveTextContent('Let 1 new person know by email?');
      await user.click(screen.getByRole('button', { name: 'Notify' }));
      expect(pub.publish).toHaveBeenCalledWith(expect.objectContaining({ allowed_user_ids: ['u-ana'], notify: { user_ids: ['u-ana'], emails: [] } }));
    });

    it('does not ask when only teams are added', async () => {
      const user = userEvent.setup();
      const pub = makeController({ allowedUserIds: ['u-bo'], ownerOnly: false });
      render(<PublishMenu controller={pub} />);
      await openChange(user);
      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('option', { name: /Platform/ }));
      await user.click(screen.getByRole('button', { name: 'Update' }));

      expect(screen.queryByTestId('notify-confirm')).toBeNull();
      expect(pub.publish).toHaveBeenCalledWith(expect.objectContaining({
        allowed_team_ids: ['t-platform'], allowed_user_ids: ['u-bo'],
      }));
      expect(pub.publish.mock.calls[0][0]).not.toHaveProperty('notify');
    });

    it('does not ask on an unchanged save', async () => {
      const user = userEvent.setup();
      const pub = makeController({ allowedUserIds: ['u-bo'], ownerOnly: false, modified: true });
      render(<PublishMenu controller={pub} />);
      await openChange(user);
      await user.click(screen.getByRole('button', { name: 'Update' }));

      expect(screen.queryByTestId('notify-confirm')).toBeNull();
    });

    it('goes back to editing on Escape, without saving or closing', async () => {
      const user = userEvent.setup();
      const pub = makeController({ ownerOnly: false, allowedTeamIds: ['t-platform'] });
      render(<PublishMenu controller={pub} />);
      await openChange(user);
      await user.type(screen.getByRole('combobox'), 'ana');
      await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
      await user.click(screen.getByRole('button', { name: 'Update' }));
      expect(screen.getByTestId('notify-confirm')).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByTestId('notify-confirm')).toBeNull();
      expect(pub.publish).not.toHaveBeenCalled();
      // Still editing, with Ana still picked.
      expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
      expect(screen.getByRole('list', { name: 'Recipients' })).toHaveTextContent('Ana Ruiz');
    });
  });
});
