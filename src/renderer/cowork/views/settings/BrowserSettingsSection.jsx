import { useCallback, useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Section, SettingsGroup } from './settingsLayout';
import { asksToApprove, showsOnlyWhenNeeded } from '../../lib/browserPrefs';
import { Switch } from '../../components/ui/Switch';
import { Tooltip } from '../../components/ui/Tooltip';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { Field, Input } from '../../components/ui';
import { signOutOfBrowserSites, testDecisionModel } from '../../api';
import { hasDecisionsModel, readBrowseStatus } from '../../lib/browseStatus';
import { llmViaMindsHub } from '../../lib/voice/voicePrefs';
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

   One switch, off by default, saved with the rest of the form. Each task can
   still switch the browser off from the composer's + menu.

   The browser runs only with a decisions model to pick its steps (the
   status's `decisions_model`): Jev on MindsHub, or a decision model of the
   organization's own. Without one the switch reads as off, even when it was
   saved on and the model was removed later. Whoever may set one up (the
   status's `can_set_decisions_model`: an organization admin, or anyone on a
   desktop) turns the switch on to see the endpoint and API key fields, the
   organization's own decision_model_url and decision_model_api_key; the
   switch turns on once a test decision answers, and the fields save with the
   form. Anyone else reads a note to ask their admin. Where the organization
   set up its own decision model but this deployment's browser can't ask it
   (the status's `own_decisions_unused`), everyone reads one line instead,
   saying so and that the browser needs Jev on MindsHub until then, as the
   server's 400 on turning it on says: setting one up again changes nothing,
   so no fields show. On the web the browser runs in MindsDB's cloud, which
   takes only a MindsHub credential, so there is no group where MindsHub
   isn't the LLM provider.

   The group says what the browser does with the person's data, as it runs
   today: where websites see the browser come from, how long sign-ins are kept
   and reused, that page text and screenshots go to the model provider, and
   what the decisions model gets for each step. That is Jev on MindsHub on the
   desktop too when the LLM is MindsHub: the desktop's browser is local so it
   needs no browser server, not to keep its pages from MindsHub. On the
   desktop it also says that the agent's code runs as the person.

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

export function onlyWhenNeededHelp(agentLabel) {
  return i18n.t('settingsTools:browser.onlyWhenNeededHelp', { agent: agentLabel });
}

export default function BrowserSettingsSection({ settings, setSetting, agentLabel = 'Anton', signedInToMindsHub = false }) {
  const { t } = useTranslation('settingsTools');
  // The last BrowseStatus answer (api.js), or null before the first one.
  const [status, setStatus] = useState(null);
  // Whether the last status read failed. It shows only while no answer came.
  const [readFailed, setReadFailed] = useState(false);
  const [signOut, setSignOut] = useState({ busy: false, note: '' });
  // Whether the browser's help tooltip is open (hover, focus, or a tap on its info button).
  const [helpOpen, setHelpOpen] = useState(false);
  // The same for Only show the browser when I'm needed.
  const [neededHelpOpen, setNeededHelpOpen] = useState(false);
  // The desktop agent's usage events, or null where the shell can't say.
  const [usageEvents, setUsageEvents] = useState(null);
  // The decision model's fields, open under the switch, and their test.
  const [setupOpen, setSetupOpen] = useState(false);
  const [decisionTest, setDecisionTest] = useState({ busy: false, passed: false, note: '' });
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

  // On the web the browser runs only on MindsHub (see above).
  const offered = status?.available === true && !(host.isWeb && !llmViaMindsHub(settings));
  // No decisions model, and none tested here since.
  const needsDecisions = status !== null && !hasDecisionsModel(status) && !decisionTest.passed;
  // The organization's own decision model is set up, but this browser can't ask it.
  const ownDecisionsUnused = needsDecisions && status?.own_decisions_unused === true;
  // Setting up another changes nothing then, so nobody may.
  const canSetDecisions = status?.can_set_decisions_model === true && !ownDecisionsUnused;
  const decisionUrl = (settings.decisionModelUrl ?? '').trim();
  const decisionKey = settings.decisionModelApiKey ?? '';
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

  // Off until the person turns it on, and marked Beta.
  const browserTitle = (
    <>
      {t('browser.useSharedBrowser')}
      <Badge variant="accent" size="xs" className="ml-2 align-middle uppercase tracking-[0.04em]">{t('browser.beta')}</Badge>
    </>
  );

  /* What the decisions model gets, on either browser: Jev on MindsHub (the
     desktop's in-app browser asks it too when the LLM is MindsHub), or the
     organization's own decision model. */
  let decisionsLine = '';
  if (status?.decisions_model === 'own') decisionsLine = t('browser.ownDecisionsLine');
  else if (!inApp || status?.decisions_model === 'mindshub') decisionsLine = t('browser.webJevLine');
  const contentLine = inApp ? pageContentLine(agentLabel, { signedInToMindsHub }) : pageContentLine(agentLabel);
  const providerSees = decisionsLine ? `${contentLine} ${decisionsLine}` : contentLine;

  const browserHelp = (
    <div className="flex flex-col gap-2 max-w-[340px] text-left">
      <p className="m-0">{inApp ? t('browser.desktopSignIns') : t('browser.webSignIns')}</p>
      <p className="m-0">{providerSees}</p>
    </div>
  );

  const turnBrowser = (on) => {
    if (on && needsDecisions) {
      // Only once a decision model answers (testDecisions).
      setSetupOpen(true);
      return;
    }
    setSetupOpen(false);
    setSetting('browserEnabled', on);
  };

  const testDecisions = async () => {
    setDecisionTest({ busy: true, passed: false, note: '' });
    let answer = null;
    try {
      // '***' is the stored key, which the server sends only to the stored endpoint.
      answer = await testDecisionModel({ url: decisionUrl, apiKey: decisionKey, model: (settings.decisionModel ?? '').trim() });
    } catch (err) {
      setDecisionTest({ busy: false, passed: false, note: err?.message || t('browser.decisionsUntested') });
      return;
    }
    if (answer?.ok !== true) {
      setDecisionTest({ busy: false, passed: false, note: t('browser.decisionsFailed', { error: answer?.error || '?' }) });
      return;
    }
    setDecisionTest({ busy: false, passed: true, note: '' });
    setSetupOpen(false);
    setSetting('browserEnabled', true);
  };

  const browserSwitch = (
    <Switch
      checked={settings.browserEnabled === true && !needsDecisions}
      onCheckedChange={turnBrowser}
      disabled={needsDecisions && !canSetDecisions}
      aria-label={t('browser.sharedBrowser')}
    />
  );

  /* Why the switch is off without a decisions model, and what to do: the
     fields for whoever may set one up, a note to ask an admin for anyone else.
     An organization model this browser can't ask gets its own line, and no
     fields. */
  let decisionsNote = null;
  if (ownDecisionsUnused) {
    decisionsNote = t('browser.ownDecisionsUnused');
  } else if (needsDecisions) {
    const removed = settings.browserEnabled === true ? `${t('browser.decisionsRemoved')} ` : '';
    decisionsNote = canSetDecisions
      ? `${removed}${t('browser.decisionsSetUp', { agent: agentLabel })}`
      : `${removed}${t('browser.decisionsAskAdmin')}`;
  }
  const decisionFields = needsDecisions && canSetDecisions && (setupOpen || settings.browserEnabled === true) && (
    <div className="flex flex-col gap-3">
      <Field label={t('browser.decisionsUrl')}>
        <Input
          type="url"
          value={settings.decisionModelUrl ?? ''}
          onChange={(v) => setSetting('decisionModelUrl', v)}
          placeholder="https://api.typesafe.ai/v1/systemone"
        />
      </Field>
      <Field label={t('browser.decisionsKey')}>
        {/* A saved key reads as '***': the field shows it as saved, and typing replaces it. */}
        <Input
          type="password"
          autoComplete="off"
          value={decisionKey === '***' ? '' : decisionKey}
          onChange={(v) => setSetting('decisionModelApiKey', v)}
          placeholder={decisionKey === '***' ? t('browser.decisionsKeySaved') : ''}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!decisionUrl || !decisionKey || decisionTest.busy} onClick={() => void testDecisions()}>
          {decisionTest.busy ? t('browser.decisionsTesting') : t('browser.decisionsTest')}
        </Button>
        {decisionTest.note && <span role="status" className="text-sm text-ink-3">{decisionTest.note}</span>}
      </div>
    </div>
  );

  let browserGroup = null;
  if (offered) {
    browserGroup = (
      <SettingsGroup title={t('browser.sharedBrowser')}>
        <Section
          title={browserTitle}
          subtitle={inApp ? desktopDisclosure(agentLabel) : webDisclosure(agentLabel)}
          notice={decisionsNote && <span className="text-sm text-ink-2">{decisionsNote}</span>}
        >
          {/* What stays signed in and what the model provider sees: a tooltip on
              the switch, on hover or focus, which the info button also opens on
              a tap or a key, since touch has no hover. */}
          <Tooltip content={browserHelp} open={helpOpen} onOpenChange={setHelpOpen} closeOnClick={false}>
            <span className="inline-flex items-center gap-2">
              {browserSwitch}
              <button
                type="button"
                className="inline-flex items-center justify-center w-7 h-7 rounded-full border-0 bg-transparent text-ink-3 hover:text-ink cursor-pointer"
                aria-label={i18n.t('chat:browser.learnWhat', { agent: agentLabel })}
                aria-expanded={helpOpen}
                onClick={() => setHelpOpen(true)}
              >
                <Info size={15} aria-hidden="true" />
              </button>
            </span>
          </Tooltip>
        </Section>
        {decisionFields && <div className="pb-4">{decisionFields}</div>}
        {/* The rest only matters with the browser on. */}
        {settings.browserEnabled === true && !needsDecisions && (
          <>
            <Section title={t('browser.approveStepsTitle')} subtitle={approveStepsHelp(agentLabel)}>
              {/* The person's setting (browser_approve_steps), so every device asks alike; on unless turned off. */}
              <Switch
                checked={asksToApprove(settings)}
                onCheckedChange={(on) => setSetting('browserApproveSteps', on)}
                aria-label={t('browser.approveStepsTitle')}
              />
            </Section>
            <Section title={t('browser.onlyWhenNeededTitle')}>
              {/* The person's setting (browser_only_when_needed), on unless
                  turned off. Its help is a tooltip like the browser's own,
                  which the info button opens on a tap or a key. */}
              <Tooltip content={<span className="block max-w-[300px] text-left">{onlyWhenNeededHelp(agentLabel)}</span>} open={neededHelpOpen} onOpenChange={setNeededHelpOpen} closeOnClick={false}>
                <span className="inline-flex items-center gap-2">
                  <Switch
                    checked={showsOnlyWhenNeeded(settings)}
                    onCheckedChange={(on) => setSetting('browserOnlyWhenNeeded', on)}
                    aria-label={t('browser.onlyWhenNeededTitle')}
                  />
                  <button
                    type="button"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-full border-0 bg-transparent text-ink-3 hover:text-ink cursor-pointer"
                    aria-label={t('browser.onlyWhenNeededLearn')}
                    aria-expanded={neededHelpOpen}
                    onClick={() => setNeededHelpOpen(true)}
                  >
                    <Info size={15} aria-hidden="true" />
                  </button>
                </span>
              </Tooltip>
            </Section>
            {signOutRow}
          </>
        )}
      </SettingsGroup>
    );
  } else if (refused) {
    // Access is off, but the person's saved sign-ins are still theirs to clear.
    browserGroup = (
      <SettingsGroup title={t('browser.sharedBrowser')}>
        <Section title={browserTitle} subtitle={status.status === 'organization_off' ? t('browser.organizationOff') : t('browser.notEntitled')} />
        {signOutRow}
      </SettingsGroup>
    );
  } else if (unconfirmed) {
    browserGroup = (
      <SettingsGroup title={t('browser.sharedBrowser')}>
        <Section
          title={browserTitle}
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
