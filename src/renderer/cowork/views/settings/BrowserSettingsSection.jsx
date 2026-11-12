import { useCallback, useEffect, useRef, useState } from 'react';
import { Section, SettingsGroup } from './settingsLayout';
import { setBrowserPrefs, useBrowserPrefs } from '../../lib/browserPrefs';
import { Switch } from '../../components/ui/Switch';
import { Tooltip } from '../../components/ui/Tooltip';
import Button from '../../components/ui/Button';
import { signOutOfBrowserSites } from '../../api';
import { readBrowseStatus } from '../../lib/browseStatus';
import { host, onInAppBrowserRegistered } from '../../../platform/host';
import i18n, { useTranslation } from '../../../lib/i18n';

/* Settings > Agent > Shared browser, in its own group. It shows when the
   server says this deployment offers the browser to this person
   (GET /browse/status answers `available: true`): on the web, a browser router
   is configured and the account may use it; on the desktop, the app's own
   browser has registered with the local server. An account the browser isn't
   enabled for (`not_entitled`), and an organization that turned the browser
   off (`organization_off`), see one line saying so, and can still sign out
   of every site. Settings reads the status as the composer's + menu does
   (lib/browseStatus.js): a server with no such route (a 404) predates the
   browser and counts as an answered `unavailable`, and a read with no answer
   in READ_TIMEOUT_MS has failed. When the status can't be read and no answer
   came before, the group says so with a Retry, and keeps the switch and Sign
   out of all sites, which need no answer. An answered `unavailable` shows no
   group. Settings asks again when the window gets focus, when the tab shows
   again, and when main says the local server took the desktop browser's
   registration. A focus or a visible tab while a read is still out waits for
   that read, so its time limit still passes.

   One switch, on by default, saved with the rest of the form. Each task can
   still switch the browser off from the composer's + menu.

   The group says what the browser does with the person's data, as it runs
   today: where websites see the browser come from, how long sign-ins are kept
   and reused, and that page text and screenshots go to the model provider. On
   the desktop it also says that the agent's code runs as the person.

   Every desktop also gets a switch for the agent's anonymous usage events, in
   its own group whatever the browser's status, since it covers all of the
   agent's events, not only the browser's.

   Text lives in the settingsTools catalog (browser.*). The exported constants
   are its English, fixed at import, for the components and tests that import
   them; this section renders the current language. */

const english = (key) => i18n.t(`settingsTools:browser.${key}`, { lng: 'en' });

export const NOT_ENTITLED = english('notEntitled');
export const ORGANIZATION_OFF = english('organizationOff');
export const STATUS_UNCONFIRMED = english('statusUnconfirmed');

export function webDisclosure(agentLabel) {
  return i18n.t('settingsTools:browser.webDisclosure', { agent: agentLabel });
}

export function desktopDisclosure(agentLabel) {
  return i18n.t('settingsTools:browser.desktopDisclosure', { agent: agentLabel });
}

/* Both sign-in lines name Settings rather than a place on this page, so the
   pane can show them as they are. On the desktop a site's session cookies end
   when the app quits, and only its persistent cookies outlive a restart. */
export const WEB_SIGN_INS = english('webSignIns');
export const DESKTOP_SIGN_INS = english('desktopSignIns');

export const WEB_SIGN_OUT_HELP = english('webSignOutHelp');
export const SIGN_OUT_HELP = english('signOutHelp');
/* cowork-server's browser client (services/browser.py) answers 424
   browser_unreachable when its call to the router fails or passes its own
   time limit. After a timeout the router may still finish the sign-out, and
   signing out again is right in either case. */
export const SIGN_OUT_UNCONFIRMED = english('signOutUnconfirmed');

/* `signedInToMindsHub` names MindsHub, a MindsDB service, as the provider a
   signed-in desktop's turns may go to. */
export function pageContentLine(agentLabel, { signedInToMindsHub = false } = {}) {
  return i18n.t('settingsTools:browser.pageContent', { agent: agentLabel, mindshub: signedInToMindsHub ? 'yes' : 'no' });
}
export const WEB_JEV_LINE = english('webJevLine');

/* The switch reaches only the agent's events: the app's own analytics
   (lib/analytics.js) doesn't read it. */
export function usageEventsHelp(agentLabel) {
  return i18n.t('settingsTools:browser.usageEventsHelp', { agent: agentLabel });
}

export function approveStepsHelp(agentLabel) {
  return i18n.t('settingsTools:browser.approveStepsHelp', { agent: agentLabel });
}

export default function BrowserSettingsSection({ settings, setSetting, agentLabel = 'Anton', signedInToMindsHub = false }) {
  const browserPrefs = useBrowserPrefs();
  const { t } = useTranslation('settingsTools');
  // The last BrowseStatus answer (api.js), or null before the first one.
  const [status, setStatus] = useState(null);
  // Whether the last status read failed. It shows only while no answer came.
  const [readFailed, setReadFailed] = useState(false);
  const [signOut, setSignOut] = useState({ busy: false, note: '' });
  // The desktop agent's usage events, or null where the shell can't say.
  const [usageEvents, setUsageEvents] = useState(null);
  const inApp = host.supportsInAppBrowser;
  // The newest status read: an older one that answers later is dropped.
  const lastRead = useRef(0);
  // Whether the newest status read is still out.
  const reading = useRef(false);

  const loadStatus = useCallback(async () => {
    lastRead.current += 1;
    const read = lastRead.current;
    reading.current = true;
    try {
      const answer = await readBrowseStatus();
      if (read !== lastRead.current) return;
      setStatus(answer);
      setReadFailed(false);
    } catch {
      // A failed read keeps the last answer, if there was one.
      if (read === lastRead.current) setReadFailed(true);
    } finally {
      if (read === lastRead.current) reading.current = false;
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    /* The server may have come up while the person was away. A read already
       out answers for this ask too. */
    const askAgain = () => {
      if (document.visibilityState !== 'hidden' && !reading.current) void loadStatus();
    };
    window.addEventListener('focus', askAgain);
    document.addEventListener('visibilitychange', askAgain);
    /* The desktop's browser can register after the first answer, while the
       page stays open, and the status answers differently from then on. Only
       a shell with the in-app browser registers one. */
    const stopRegistered = host.supportsInAppBrowser ? onInAppBrowserRegistered(() => void loadStatus()) : () => {};
    return () => {
      window.removeEventListener('focus', askAgain);
      document.removeEventListener('visibilitychange', askAgain);
      stopRegistered();
    };
  }, [loadStatus]);

  useEffect(() => {
    if (host.isWeb) return;
    const ask = async () => {
      try {
        setUsageEvents(await host.getUsageEventsPref());
      } catch {
        // A failed read leaves the switch out, as on a shell that can't say.
        setUsageEvents(null);
      }
    };
    void ask();
  }, []);

  const offered = status?.available === true;
  const refused = status?.status === 'not_entitled' || status?.status === 'organization_off';
  // No answer yet and the read failed, in a shell that can run a browser.
  const unconfirmed = status === null && readFailed && (host.isWeb || inApp);

  const signOutOfAllSites = async () => {
    setSignOut({ busy: true, note: '' });
    let note;
    try {
      const cleared = inApp
        ? (await host.inAppBrowser.clearData()).ok
        : (await signOutOfBrowserSites())?.cleared === true;
      note = cleared ? t('browser.signedOut') : t('browser.clearFailed');
    } catch (err) {
      note = err?.code === 'browser_unreachable' ? t('browser.signOutUnconfirmed') : t('browser.clearFailed');
    }
    setSignOut({ busy: false, note });
  };

  const saveUsageEvents = async (on) => {
    setUsageEvents(on);
    if (!(await host.setUsageEventsPref(on).catch(() => false))) setUsageEvents(!on);
  };

  const signOutRow = (
    <Section title={t('browser.signOutTitle')} subtitle={signOut.note || (inApp ? t('browser.signOutHelp') : t('browser.webSignOutHelp'))}>
      <Button size="sm" variant="subtle" disabled={signOut.busy} onClick={() => void signOutOfAllSites()}>{t('browser.signOut')}</Button>
    </Section>
  );

  const browserHelp = (
    <div className="flex flex-col gap-2 max-w-[340px] text-left">
      <p className="m-0">
        <strong>{t('browser.signInsTitle')}</strong>{' '}
        <span>{inApp ? t('browser.desktopSignIns') : t('browser.webSignIns')}</span>
      </p>
      <p className="m-0">
        <strong>{t('browser.providerSeesTitle')}</strong>{' '}
        <span>{inApp ? pageContentLine(agentLabel, { signedInToMindsHub }) : `${pageContentLine(agentLabel)} ${t('browser.webJevLine')}`}</span>
      </p>
    </div>
  );

  const browserSwitch = (
    <Switch
      checked={settings.browserEnabled ?? true}
      onCheckedChange={(v) => setSetting('browserEnabled', v)}
      aria-label={t('browser.sharedBrowser')}
    />
  );

  let browserGroup = null;
  if (offered) {
    browserGroup = (
      <SettingsGroup title={t('browser.sharedBrowser')}>
        <Section title={t('browser.useSharedBrowser')} subtitle={inApp ? desktopDisclosure(agentLabel) : webDisclosure(agentLabel)}>
          {/* What stays signed in and what the model provider sees: on the switch, on hover. */}
          <Tooltip content={browserHelp}>
            <span className="inline-flex">{browserSwitch}</span>
          </Tooltip>
        </Section>
        <Section title={t('browser.approveStepsTitle')} subtitle={approveStepsHelp(agentLabel)}>
          <Switch
            checked={browserPrefs.askToApprove}
            onCheckedChange={(on) => setBrowserPrefs({ askToApprove: on })}
            aria-label={t('browser.approveStepsTitle')}
          />
        </Section>
        {signOutRow}
      </SettingsGroup>
    );
  } else if (refused) {
    // Access is off, but the person's saved sign-ins are still theirs to clear.
    browserGroup = (
      <SettingsGroup title={t('browser.sharedBrowser')}>
        <Section title={t('browser.useSharedBrowser')} subtitle={status.status === 'organization_off' ? t('browser.organizationOff') : t('browser.notEntitled')} />
        {signOutRow}
      </SettingsGroup>
    );
  } else if (unconfirmed) {
    browserGroup = (
      <SettingsGroup title={t('browser.sharedBrowser')}>
        <Section
          title={t('browser.useSharedBrowser')}
          subtitle={t('browser.statusUnconfirmed')}
          notice={<Button size="sm" variant="subtle" onClick={() => void loadStatus()}>{t('browser.retry')}</Button>}
        >
          {browserSwitch}
        </Section>
        {signOutRow}
      </SettingsGroup>
    );
  }

  return (
    <>
      {browserGroup}
      {usageEvents !== null && (
        <SettingsGroup title={t('browser.usageEventsTitle')}>
          <Section title={t('browser.sendUsageEvents')} subtitle={usageEventsHelp(agentLabel)}>
            <Switch
              checked={usageEvents}
              onCheckedChange={(v) => void saveUsageEvents(v)}
              aria-label={t('browser.sendUsageEvents')}
            />
          </Section>
        </SettingsGroup>
      )}
    </>
  );
}
