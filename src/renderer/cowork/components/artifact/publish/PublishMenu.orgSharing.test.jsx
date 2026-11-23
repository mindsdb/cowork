// Teams and "Everyone at ‹org›" in the restricted choice.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

const people = vi.hoisted(() => ({ byIds: vi.fn(), directory: vi.fn() }));
const sharingRead = vi.hoisted(() => vi.fn());
vi.mock('../../../api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchMindsHubPeopleByIds: people.byIds,
  fetchMindsHubDirectory: people.directory,
  fetchSkillSharingCapabilities: sharingRead,
}));
// The access route, for the panel driven by the real usePublish.
const workspace = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../../../lib/artifactWorkspaceApi', async (importOriginal) => ({
  ...(await importOriginal()),
  canUseArtifactWorkspace: () => true,
  loadArtifactAccess: workspace.load,
  setArtifactAccess: workspace.save,
}));

import { PublishMenu } from './PublishMenu';
import { usePublish } from './usePublish';
import { __resetOrgSharingForTests } from '../../../hooks/useOrgSharing';
import { SHARING_OFF } from '../../../lib/orgSharing';
import { setOrgMode } from '../../../../lib/orgMode';

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
// What usePublish hands a MindsHub mode panel once the capabilities read
// answered: useSharingCapabilities' `status`, `capabilities` (here an
// admin's) and `retry`, with the caller's `teams` and the organization's
// name from the app's organization list or the token's claim (`orgName`,
// useSharingOrgName).
const ADMIN_CAPABILITIES = { enabled: true, canShareArtifactsOrg: true, canWriteSkillsOrg: false };
const orgSharing = ({ capabilities = {}, ...over } = {}) => ({
  status: 'ready', retry: vi.fn(), capabilities: { ...ADMIN_CAPABILITIES, ...capabilities }, teams: TEAMS, orgName: 'Acme', ...over,
});

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
    orgMode: true,
    orgSharing: orgSharing(),
    setError: vi.fn(),
    loadVersions: vi.fn(),
    publish: vi.fn(async () => true),
    unpublish: vi.fn(),
    activate: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

// The access card is a dropdown (ENG-4455): it opens the options as radios,
// and picking another one starts the change. The access already chosen is
// edited from "Edit list" (a Specific list), not picked again.
async function openPicker(user) {
  await user.click(await screen.findByTestId('access-dropdown'));
}

async function pickAccess(user, option) {
  const choice = screen.getByRole('radio', { name: option });
  if (choice.getAttribute('aria-checked') === 'true') {
    await user.click(screen.getByTestId('access-dropdown'));
    await user.click(screen.getByText('Edit list'));
  } else {
    await user.click(choice);
  }
}

async function openAccessChange(user, option = /^Specific teams and people/) {
  await user.click(screen.getByText('Share'));
  await openPicker(user);
  if (option) await pickAccess(user, option);
}

// The Share trigger, whatever it reads: on an org card it says "Share" until
// the access route answers.
const trigger = () => screen.getByRole('button', { name: /^Share/ });

async function openChange(user) {
  await user.click(trigger());
  await openPicker(user);
}

// Opens the access view on the stored list, to edit the people on it.
async function openListEdit(user) {
  await user.click(trigger());
  await user.click(await screen.findByText('Edit list'));
}

// The dropdown names the access it shows (in the summary, the live one; in
// the access view, the one drafted).
const dropdown = () => screen.getByTestId('access-dropdown');

const radio = (name) => screen.getByRole('radio', { name });
const recipients = () => screen.getByRole('list', { name: 'Recipients' });

describe('PublishMenu with sharing in MindsHub mode', () => {
  it('offers Only me, Everyone at the org, Specific teams and people, Password, Public in that order', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController()} />);
    await openAccessChange(user, null);

    const names = screen.getAllByRole('radio').map((r) => r.textContent);
    expect(names).toEqual([
      'Only meNobody else can open this',
      'Everyone at AcmeAnyone in your organization',
      'Specific teams and peoplePick teams, colleagues or outside emails',
      expect.stringMatching(/^Password protected/),
      expect.stringMatching(/^Public/),
    ]);
    // No nested checkboxes.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('says Everyone in the organization when no org name is known', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({ orgSharing: orgSharing({ orgName: null }) })} />);
    await openAccessChange(user, null);

    expect(radio(/^Everyone in the organization/)).toBeInTheDocument();
    expect(screen.queryByText(/Everyone at/)).toBeNull();
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
    });
  });

  describe('who may share with everyone at the org', () => {
    it('disables Everyone at the org for a role without the capability, with the role hint, and shares nothing with everyone', async () => {
      const user = userEvent.setup();
      const pub = makeController({ orgSharing: orgSharing({ capabilities: { canShareArtifactsOrg: false } }) });
      render(<PublishMenu controller={pub} />);
      await openAccessChange(user, null);

      expect(radio(/^Everyone at Acme/)).toHaveAttribute('aria-disabled', 'true');
      await user.hover(screen.getByTestId('org-option-locked'));
      expect(await screen.findByText("Your role can't share with everyone in the organization")).toBeInTheDocument();
      await user.click(radio(/^Everyone at Acme/));
      expect(radio(/^Everyone at Acme/)).toHaveAttribute('aria-checked', 'false');
      expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
      expect(pub.publish).not.toHaveBeenCalled();
    });

    it('lets a member with the capability pick it', async () => {
      const user = userEvent.setup();
      const pub = makeController({ orgSharing: orgSharing({ capabilities: { canShareArtifactsOrg: true } }) });
      render(<PublishMenu controller={pub} />);
      await openAccessChange(user, /^Everyone at Acme/);

      expect(screen.queryByTestId('org-option-locked')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Update' }));
      expect(pub.publish).toHaveBeenCalledWith(expect.objectContaining({ org_allowed: true, owner_only: false }));
    });

    // artifacts.share_org decides it, not skills.share_org.
    it('reads the artifact capability, never the skill one', async () => {
      const user = userEvent.setup();
      const pub = makeController({
        orgSharing: orgSharing({ capabilities: { canShareArtifactsOrg: false, canShareSkillsOrg: true } }),
      });
      render(<PublishMenu controller={pub} />);
      await openAccessChange(user, null);

      expect(radio(/^Everyone at Acme/)).toHaveAttribute('aria-disabled', 'true');
    });

    /* With MindsHub unreachable the capabilities read false, and the role hint
       would blame the caller for an outage. The lock says what happened and
       the panel offers Retry. */
    it("says MindsHub couldn't be reached instead of the role hint, with Retry", async () => {
      const user = userEvent.setup();
      const retry = vi.fn();
      const pub = makeController({
        orgSharing: orgSharing({ retry, capabilities: { canShareArtifactsOrg: false, permissionsKnown: false } }),
      });
      render(<PublishMenu controller={pub} />);
      await openAccessChange(user, null);

      // The summary says so already, before any change starts.
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reach MindsHub to check what you can share.");
      expect(radio(/^Everyone at Acme/)).toHaveAttribute('aria-disabled', 'true');
      await user.hover(screen.getByTestId('org-option-locked'));
      expect(await screen.findByText("Couldn't reach MindsHub")).toBeInTheDocument();
      expect(screen.queryByText("Your role can't share with everyone in the organization")).toBeNull();

      // The access view, once a change starts, says so too and offers Retry.
      await user.click(radio(/^Specific teams and people/));
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reach MindsHub to check what you can share.");
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalledTimes(1);
      // Its dropdown keeps the same lock.
      await openPicker(user);
      expect(radio(/^Everyone at Acme/)).toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('shows the recipient field under the dropdown once Specific is picked, never inside the options', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController()} />);
    await openAccessChange(user, null);
    // The options only switch: no field opens among them.
    expect(screen.queryByTestId('access-editor')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();

    await user.click(radio(/^Specific teams and people/));
    // The pick closes the options and drafts Specific in the access view.
    expect(screen.queryByRole('radio')).toBeNull();
    expect(dropdown()).toHaveAccessibleName('Who can access your app: Specific teams and people');
    const editor = screen.getByTestId('access-editor');
    expect(within(editor).getByRole('combobox', { name: 'Add teams, people or emails' })).toBeInTheDocument();
    const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(dropdown(), editor)).toBe(true);
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();

    // Reopened, the options still carry no field.
    await openPicker(user);
    expect(radio(/^Specific teams and people/)).toHaveAttribute('aria-checked', 'true');
    const options = screen.getByRole('radiogroup', { name: 'Who can access your app' });
    expect(within(options).queryByRole('combobox')).toBeNull();
    expect(options).not.toContainElement(editor);
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
    // The people on it are edited from Edit list.
    await pickAccess(user, /^Specific teams and people/);
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
      orgSharing: orgSharing({ teams: withDefault }),
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

  it('summarizes Everyone at the org on the summary card', () => {
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
      orgSharing: orgSharing({ teams: { status: 'ready', reachable: false, teams: [] } }),
    })} />);
    await openAccessChange(user);
    await user.click(screen.getByRole('combobox'));

    expect(screen.getByText("Couldn't load your teams. Try again later.")).toBeInTheDocument();
  });

  it('drops an Unknown person and sends the rest', async () => {
    const user = userEvent.setup();
    const pub = makeController({ allowedUserIds: ['u-bo', 'u-gone'], ownerOnly: false });
    render(<PublishMenu controller={pub} />);
    await openListEdit(user);

    await user.click(await screen.findByRole('button', { name: 'Remove Unknown person' }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(pub.publish).toHaveBeenCalledWith(expect.objectContaining({
      allowed_user_ids: ['u-bo'], allowed_emails: [], owner_only: false,
    }));
  });

  it('offers Specific people by email only without sharing in MindsHub mode', async () => {
    const user = userEvent.setup();
    const pub = makeController({ orgSharing: orgSharing({ capabilities: SHARING_OFF }) });
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user, null);

    expect(screen.queryByRole('radio', { name: /^Everyone/ })).toBeNull();
    expect(radio(/^Specific people/)).toHaveTextContent('Only the people you list');
    await pickAccess(user, /^Specific people/);
    const field = screen.getByRole('combobox', { name: 'Add people by email' });
    await user.click(field);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();

    await user.type(field, 'Zed@Partner.io{Enter}');
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(screen.getByTestId('notify-confirm')).toHaveTextContent('Let 1 new person know by email?');
    expect(screen.getByTestId('notify-confirm')).toHaveTextContent('zed@partner.io');
    await user.click(screen.getByRole('button', { name: "Don't notify" }));
    // The org access route takes the org names whatever sharing allows.
    expect(pub.publish).toHaveBeenCalledWith({
      mode: 'restricted', org_allowed: false, owner_only: false,
      allowed_emails: ['zed@partner.io'], allowed_team_ids: [], allowed_user_ids: [],
    });
    expect(within(document.body).queryByText(/Acme/)).toBeNull();
  });

  // `orgMode` alone decides the route; usePublish hands every deployment an
  // `orgSharing`, idle where nothing is asked.
  it('on desktop waits for nothing and sends outside emails as desktop publish reads them', async () => {
    const user = userEvent.setup();
    const pub = makeController({
      orgMode: false,
      orgSharing: orgSharing({ status: 'idle', capabilities: SHARING_OFF }),
    });
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user, /^Specific people/);

    await user.type(screen.getByRole('combobox', { name: 'Add people by email' }), 'zed@partner.io{Enter}');
    await user.click(screen.getByRole('button', { name: 'Update' }));
    await user.click(screen.getByRole('button', { name: "Don't notify" }));
    expect(pub.publish).toHaveBeenCalledWith({ mode: 'restricted', emails: ['zed@partner.io'], org_allowed: false, owner_only: false });
  });

  describe('before the sharing capabilities are known', () => {
    const update = () => screen.getByRole('button', { name: 'Update' });
    // The summary offers no dropdown to start a change from, and no Update.
    const expectNoChange = () => {
      expect(screen.queryByTestId('access-dropdown')).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    };

    it('shows no chooser and saves nothing while they load', async () => {
      const user = userEvent.setup();
      const pub = makeController({
        allowedTeamIds: ['t-platform'], ownerOnly: false,
        orgSharing: orgSharing({ status: 'loading', capabilities: SHARING_OFF }),
      });
      render(<PublishMenu controller={pub} />);
      await user.click(trigger());

      // In the body: the footer's up-to-date tag is a status too.
      const loading = () => within(screen.getByTestId('publish-menu-body')).getByRole('status');
      expect(loading()).toHaveTextContent('Loading sharing settings…');
      expectNoChange();

      // Nor Edit list: no change can start until they are known.
      expect(screen.queryByText('Edit list')).toBeNull();
      expect(pub.publish).not.toHaveBeenCalled();
    });

    it('holds a first share too', async () => {
      const user = userEvent.setup();
      const pub = makeController({ publishedUrl: '', orgSharing: orgSharing({ status: 'loading', capabilities: SHARING_OFF }) });
      render(<PublishMenu controller={pub} />);
      await user.click(screen.getByText('Share'));

      expect(screen.queryByRole('radio')).toBeNull();
      const share = screen.getAllByRole('button', { name: 'Share' }).at(-1);
      expect(share).toBeDisabled();
      await user.click(share);
      expect(pub.publish).not.toHaveBeenCalled();
    });

    it('offers Retry when they could not be read, and saves nothing', async () => {
      const user = userEvent.setup();
      const retry = vi.fn();
      const pub = makeController({
        allowedTeamIds: ['t-platform'], ownerOnly: false,
        orgSharing: orgSharing({ status: 'error', retry, capabilities: SHARING_OFF }),
      });
      render(<PublishMenu controller={pub} />);
      await user.click(trigger());

      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the sharing settings.");
      expectNoChange();
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalledTimes(1);
      expect(pub.publish).not.toHaveBeenCalled();
    });

    it('sends Only me under the org names, with no emails key, once they are known', async () => {
      const user = userEvent.setup();
      const pub = makeController({ allowedTeamIds: ['t-platform'], ownerOnly: false });
      const { rerender } = render(<PublishMenu controller={{ ...pub, orgSharing: orgSharing({ status: 'loading', capabilities: SHARING_OFF }) }} />);
      await user.click(trigger());
      expectNoChange();

      rerender(<PublishMenu controller={pub} />);
      await openPicker(user);
      await user.click(radio(/^Only me/));
      await user.click(update());

      expect(pub.publish).toHaveBeenCalledTimes(1);
      expect(pub.publish).toHaveBeenCalledWith({
        mode: 'restricted', org_allowed: false, owner_only: true,
        allowed_emails: [], allowed_team_ids: [], allowed_user_ids: [],
      });
      expect(pub.publish.mock.calls[0][0]).not.toHaveProperty('emails');
    });
  });
  describe('the collapsed summary', () => {
    const open = (user) => user.click(screen.getByText(/Shared/));
    const sharedWith = () => screen.getByRole('list', { name: 'Shared with' });
    const names = () => within(sharedWith()).getAllByRole('listitem').map((row) => row.querySelector('span.truncate').textContent);

    it('lists who it is shared with, without opening the dropdown', async () => {
      const user = userEvent.setup();
      render(<PublishMenu controller={makeController({
        allowedTeamIds: ['t-platform'], allowedUserIds: ['u-ana'], accessEmails: ['zed@partner.io'], ownerOnly: false,
      })} />);
      await open(user);

      // The dropdown names the access; the list follows it, in the summary.
      const summary = screen.getByTestId('access-summary');
      expect(within(summary).getByTestId('access-dropdown')).toHaveAccessibleName('Who can access your app: Specific teams and people');
      expect(summary).toContainElement(sharedWith());
      await waitFor(() => expect(names()).toEqual(['Platform', 'Ana Ruiz', 'zed@partner.io']));
      expect(sharedWith()).toHaveTextContent('Outside Acme');
      // The card's line counts who is on the list.
      expect(within(summary).getByTestId('access-dropdown')).toHaveTextContent('1 team · 1 person · 1 outside Acme');
      // Read only: the people are edited from Edit list.
      expect(within(sharedWith()).queryByRole('button')).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();
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

    it('lists the emails of Specific people without sharing in MindsHub mode', async () => {
      const user = userEvent.setup();
      render(<PublishMenu controller={makeController({
        accessEmails: ['zed@partner.io', 'amy@partner.io'], ownerOnly: false,
        orgSharing: orgSharing({ capabilities: SHARING_OFF }),
      })} />);
      await open(user);
      expect(dropdown()).toHaveAccessibleName('Who can access your app: Specific people');
      expect(names()).toEqual(['zed@partner.io', 'amy@partner.io']);
      expect(dropdown()).toHaveTextContent('2 people');
      expect(people.byIds).not.toHaveBeenCalled();
    });
  });

  describe('asking whether to notify added people', () => {
    it('asks only when people are added one by one, listing them with +N more', async () => {
      const user = userEvent.setup();
      const pub = makeController({ allowedUserIds: ['u-bo'], ownerOnly: false });
      render(<PublishMenu controller={pub} />);
      await openListEdit(user);

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
      await openListEdit(user);
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
      await openListEdit(user);
      await user.click(screen.getByRole('button', { name: 'Update' }));

      expect(screen.queryByTestId('notify-confirm')).toBeNull();
    });

    it('goes back to editing on Escape, without saving or closing', async () => {
      const user = userEvent.setup();
      const pub = makeController({ ownerOnly: false, allowedTeamIds: ['t-platform'] });
      render(<PublishMenu controller={pub} />);
      await openListEdit(user);
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

describe('PublishMenu on an org card, driven by usePublish', () => {
  /* cowork-server's org card says restricted but not who it reaches: its
     audience fields answer null whoever it is shared with
     (cowork.schemas.artifact_access.ArtifactAccessView.audience_unknown).
     Only the access route says who has access. */
  const CARD = {
    id: '7db94eb8f0a54c7e9c1d2b3a4f5e6d70',
    projectId: 'proj-1',
    publishedUrl: 'https://share/abc',
    accessMode: 'restricted',
    accessProtected: false,
    ownerOnly: null,
    orgAllowed: null,
    allowedTeamIds: null,
    allowedUserIds: null,
  };
  // The access route's answer, camelCase as cowork-server sends it.
  const SHARED_WITH_PLATFORM = {
    accessMode: 'restricted', accessEmails: [], ownerOnly: false,
    orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: [],
  };

  function OrgPanel() {
    const pub = usePublish(CARD, { enabled: true });
    return <PublishMenu controller={pub} />;
  }

  beforeEach(() => {
    workspace.load.mockReset();
    workspace.save.mockReset();
    sharingRead.mockReset();
    sharingRead.mockResolvedValue(ADMIN_CAPABILITIES);
    setOrgMode(true);
  });
  afterEach(() => setOrgMode(false));

  it('keeps Update disabled until the access route answers, then saves the stored audience with the change', async () => {
    const user = userEvent.setup();
    let answer;
    workspace.load.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    workspace.save.mockResolvedValue({ url: 'https://share/abc', ...SHARED_WITH_PLATFORM, allowedUserIds: ['u-ana'] });
    render(<OrgPanel />);
    await user.click(trigger());

    // In the body: the footer's up-to-date tag is a status too.
    await waitFor(() => expect(within(screen.getByTestId('publish-menu-body')).getByRole('status')).toHaveTextContent('Loading current access…'));
    // Nothing to pick from the card's unknown audience, and nothing to save:
    // the summary offers no dropdown, no Edit list and no Update.
    expect(screen.queryByTestId('access-dropdown')).toBeNull();
    expect(screen.queryByText('Edit list')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    expect(workspace.save).not.toHaveBeenCalled();

    await act(async () => { answer(SHARED_WITH_PLATFORM); });
    await waitFor(() => expect(dropdown()).toHaveAccessibleName('Who can access your app: Specific teams and people'));
    await user.click(screen.getByText('Edit list'));
    await user.type(screen.getByRole('combobox', { name: 'Add teams, people or emails' }), 'ana');
    await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
    await user.click(screen.getByRole('button', { name: 'Update' }));
    await user.click(screen.getByRole('button', { name: "Don't notify" }));

    // The team the artifact is shared with stays; only Ana is added.
    await waitFor(() => expect(workspace.save).toHaveBeenCalledTimes(1));
    expect(workspace.save).toHaveBeenCalledWith(CARD, {
      mode: 'restricted',
      org_allowed: false,
      allowed_team_ids: ['t-platform'],
      allowed_user_ids: ['u-ana'],
      allowed_emails: [],
      owner_only: false,
    });
  });

  it('keeps the stored audience when the list reloads mid-edit', async () => {
    const user = userEvent.setup();
    workspace.load.mockResolvedValue(SHARED_WITH_PLATFORM);
    workspace.save.mockResolvedValue({ url: 'https://share/abc', ...SHARED_WITH_PLATFORM, allowedUserIds: ['u-ana'] });
    // Like the app: the parent keeps the card, takes the hook's reports, and
    // replaces the card when its artifacts list reloads after a turn.
    let reloadCard;
    function ReloadingPanel() {
      const [card, setCard] = useState(CARD);
      reloadCard = setCard;
      const pub = usePublish(card, { enabled: true, onChange: setCard });
      return <PublishMenu controller={pub} />;
    }
    render(<ReloadingPanel />);
    // The trigger reads "Shared" once the access route has answered.
    await waitFor(() => expect(trigger()).toHaveTextContent(/Shared/));
    await openListEdit(user);
    expect(dropdown()).toHaveAccessibleName('Who can access your app: Specific teams and people');

    // A fresh card with no audience, `modified` flipped by an edit that
    // autopublish has not caught up with yet.
    await act(async () => { reloadCard({ ...CARD, modified: true }); });
    await user.type(screen.getByRole('combobox', { name: 'Add teams, people or emails' }), 'ana');
    await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
    await user.click(screen.getByRole('button', { name: 'Update' }));
    await user.click(screen.getByRole('button', { name: "Don't notify" }));

    await waitFor(() => expect(workspace.save).toHaveBeenCalledTimes(1));
    expect(workspace.save.mock.calls[0][1]).toEqual({
      mode: 'restricted',
      org_allowed: false,
      allowed_team_ids: ['t-platform'],
      allowed_user_ids: ['u-ana'],
      allowed_emails: [],
      owner_only: false,
    });
  });

  it("offers Retry when the access route fails, never the card's unknown audience", async () => {
    const user = userEvent.setup();
    workspace.load.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { status: 503 }));
    workspace.load.mockResolvedValueOnce(SHARED_WITH_PLATFORM);
    render(<OrgPanel />);
    await user.click(trigger());

    const failed = await screen.findByRole('alert');
    expect(failed).toHaveTextContent("Couldn't load the current access.");
    // A failed read says nothing about who it reaches: neither the trigger nor
    // the panel claims "Shared".
    expect(trigger()).toHaveTextContent(/^Share$/);
    expect(within(screen.getByRole('dialog')).queryByText('Shared')).toBeNull();
    expect(screen.queryByTestId('access-summary')).toBeNull();
    // No way into a change from an unknown audience.
    expect(screen.queryByTestId('access-dropdown')).toBeNull();
    expect(screen.queryByText('Edit list')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();

    // Its own Retry, not the viewer analytics' one below it.
    await user.click(within(failed).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(dropdown()).toHaveAccessibleName('Who can access your app: Specific teams and people'));
    await openPicker(user);
    expect(radio(/^Specific teams and people/)).toHaveAttribute('aria-checked', 'true');
    expect(workspace.load).toHaveBeenCalledTimes(2);
    expect(workspace.save).not.toHaveBeenCalled();
  });

  /* The card answers its audience null for every org artifact, owner-only
     ones included. Until the access route answers, nothing may claim the
     artifact is shared. */
  it('claims "Shared" neither on the trigger nor in the panel until the access route answers', async () => {
    const user = userEvent.setup();
    let answer;
    workspace.load.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<OrgPanel />);

    expect(trigger()).toHaveTextContent(/^Share$/);
    expect(trigger()).toHaveAttribute('data-share-state', 'unknown');
    await user.hover(trigger());
    expect(screen.queryByText(/^Shared with/)).toBeNull();
    await user.click(trigger());
    const panel = screen.getByRole('dialog');
    expect(within(panel).queryByText('Shared')).toBeNull();
    expect(within(panel).getByText('Share')).toBeInTheDocument();

    await act(async () => { answer(SHARED_WITH_PLATFORM); });
    await waitFor(() => expect(within(panel).getByText('Shared')).toBeInTheDocument());
    expect(trigger()).toHaveTextContent(/Shared/);
  });

  /* An org artifact stays published after a save narrows it to Only me, so
     the panel stays open on its summary. Its title must stop saying "Shared"
     then, like the trigger. */
  it('titles the panel "Share" once a save narrows a shared artifact to Only me', async () => {
    const user = userEvent.setup();
    workspace.load.mockResolvedValue(SHARED_WITH_PLATFORM);
    workspace.save.mockResolvedValue({
      url: 'https://share/abc', accessMode: 'restricted', accessEmails: [],
      orgAllowed: false, ownerOnly: true, allowedTeamIds: [], allowedUserIds: [],
    });
    render(<OrgPanel />);
    await waitFor(() => expect(trigger()).toHaveTextContent(/Shared/));
    await user.click(trigger());
    // The Share panel, before the dropdown adds its own dialog.
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByText('Shared')).toBeInTheDocument();
    await openPicker(user);
    expect(radio(/^Specific teams and people/)).toHaveAttribute('aria-checked', 'true');

    await user.click(radio(/^Only me/));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(within(panel).getByTestId('access-summary')).toHaveTextContent('Only me'));
    expect(within(panel).getByText('Share')).toBeInTheDocument();
    expect(screen.queryByText('Shared')).toBeNull();
  });
});
