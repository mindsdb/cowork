import { useEffect, useState } from 'react';
import { Section, SettingsGroup } from './settingsLayout';
import { Switch } from '../../components/ui/Switch';
import Button from '../../components/ui/Button';
import { fetchBrowseStatus, signOutOfBrowserSites } from '../../api';
import { host } from '../../../platform/host';

/* Settings > Agent > Shared browser, in its own group. It shows only when the
   server says this deployment offers the browser to this person
   (GET /browse/status answers `available: true`): on the web, a browser router
   is configured and the account may use it; on the desktop, the app's own
   browser has registered with the local server. Until that answer comes, and
   when the call fails, there is no group. An account the browser isn't
   enabled for (`not_entitled`), and an organization that turned the browser
   off (`organization_off`), see one line saying so, and can still sign out
   of every site.

   One switch, on by default, saved with the rest of the form. Each task can
   still switch the browser off from the composer's + menu.

   The group says what the browser does with the person's data, as it runs
   today: where websites see the browser come from, that sign-ins are kept and
   reused, and that page text and screenshots go to the model provider. On
   the desktop it also says that the agent's code runs as the person, and
   offers a switch for the agent's anonymous usage events. */

export const NOT_ENTITLED = 'Not available for your account.';
export const ORGANIZATION_OFF = 'Your organization turned off the browser.';

export function webDisclosure(agentLabel) {
  return `A browser you and ${agentLabel} use together, shown beside the chat. It runs in MindsDB's cloud, so websites see MindsDB's addresses. ${agentLabel} asks you before a step that submits, buys, sends or deletes.`;
}

export function desktopDisclosure(agentLabel) {
  return `A browser inside this app that you and ${agentLabel} use together, shown beside the chat. Websites see your own connection, and no MindsDB server carries your browsing. ${agentLabel}'s code runs as you and can read this browser's sign-ins. Some sites, Google's sign-in among them, don't allow signing in from an app's built-in browser.`;
}

export const WEB_SIGN_INS = 'Sites you sign in to stay signed in for your later tasks, in every organization you belong to, until they go 90 days unused. Deleting your MindsHub account deletes them.';
export const DESKTOP_SIGN_INS = "Sites you sign in to stay signed in on this computer for your later tasks, in every organization of this account, until you sign out.";

export const WEB_SIGN_OUT_HELP = "Clears every site's cookies and sign-ins from your browser and from storage. Saved tabs stay.";
export const SIGN_OUT_HELP = "Clears this browser's cookies, sign-ins and cache, and closes its tabs. Saved tabs stay.";

export function pageContentLine(agentLabel) {
  return `When ${agentLabel} reads a page, its text and a screenshot go to the model provider that serves your turn.`;
}
export const WEB_JEV_LINE = 'With Fast answers with Jev on, Jev also gets the page\'s address, title, element names and its first 1,500 characters, without field values or what you type.';

export const USAGE_EVENTS_HELP = 'Anonymous usage events with an installation id, the browser\'s included, never page text or addresses. Off stops all of them from the next time the app starts its server.';

export default function BrowserSettingsSection({ settings, setSetting, agentLabel = 'Anton' }) {
  // The last BrowseStatus answer (api.js), or null.
  const [status, setStatus] = useState(null);
  const [signOut, setSignOut] = useState({ busy: false, note: '' });
  // The desktop agent's usage events, or null where the shell can't say.
  const [usageEvents, setUsageEvents] = useState(null);
  const inApp = host.supportsInAppBrowser;

  useEffect(() => {
    const load = async () => {
      try {
        setStatus(await fetchBrowseStatus());
      } catch {
        // Without an answer the browser can't be offered, so nothing shows.
        setStatus(null);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!inApp) return;
    host.getUsageEventsPref().then(setUsageEvents, () => setUsageEvents(null));
  }, [inApp]);

  const offered = status?.available === true;
  const refused = status?.status === 'not_entitled' || status?.status === 'organization_off';

  const signOutOfAllSites = async () => {
    setSignOut({ busy: true, note: '' });
    let cleared = false;
    try {
      cleared = inApp
        ? (await host.inAppBrowser.clearData()).ok
        : (await signOutOfBrowserSites())?.cleared === true;
    } catch {
      cleared = false;
    }
    setSignOut({ busy: false, note: cleared ? 'Signed out of all sites.' : "Couldn't clear the browser's data. Try again." });
  };

  const saveUsageEvents = async (on) => {
    setUsageEvents(on);
    if (!(await host.setUsageEventsPref(on).catch(() => false))) setUsageEvents(!on);
  };

  if (!offered && !refused) return null;

  const signOutRow = (
    <Section title="Sign out of all sites" subtitle={signOut.note || (inApp ? SIGN_OUT_HELP : WEB_SIGN_OUT_HELP)}>
      <Button size="sm" variant="subtle" disabled={signOut.busy} onClick={() => void signOutOfAllSites()}>Sign out</Button>
    </Section>
  );

  // Access is off, but the person's saved sign-ins are still theirs to clear.
  if (!offered) {
    return (
      <SettingsGroup title="Shared browser">
        <Section title="Use the shared browser" subtitle={status.status === 'organization_off' ? ORGANIZATION_OFF : NOT_ENTITLED} />
        {signOutRow}
      </SettingsGroup>
    );
  }

  const on = settings.browserEnabled ?? true;

  return (
    <SettingsGroup title="Shared browser">
      <Section title="Use the shared browser" subtitle={inApp ? desktopDisclosure(agentLabel) : webDisclosure(agentLabel)}>
        <Switch
          checked={on}
          onCheckedChange={(v) => setSetting('browserEnabled', v)}
          aria-label="Shared browser"
        />
      </Section>
      <Section title="Sign-ins" subtitle={inApp ? DESKTOP_SIGN_INS : WEB_SIGN_INS} />
      {signOutRow}
      <Section
        title="What the model provider sees"
        subtitle={inApp ? pageContentLine(agentLabel) : `${pageContentLine(agentLabel)} ${WEB_JEV_LINE}`}
      />
      {inApp && usageEvents !== null && (
        <Section title="Send anonymous usage events" subtitle={USAGE_EVENTS_HELP}>
          <Switch
            checked={usageEvents}
            onCheckedChange={(v) => void saveUsageEvents(v)}
            aria-label="Send anonymous usage events"
          />
        </Section>
      )}
    </SettingsGroup>
  );
}
