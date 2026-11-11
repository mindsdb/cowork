import { diagnostic } from '../../../../shared/diagnostics';
import { Fragment, useState, useEffect, useMemo, useRef } from 'react';
import { useId } from 'react';
import Ico from '../../components/Icons';
import { validateSettings, revealSettingKey, testProviders, fetchRecommendedModels } from '../../api';
import { isModelLocked, isModelRestricted, isModelBudgetReached } from '../../lib/modelCatalog';
import { providerTypeToKeyField, providerValueToType, resolveRoleModel, resolveModelPickerValue, buildModelOptions, displayModelLabel, effectiveRoleModel, effectiveRoleProvider, mergeRecommendedModels, budgetSpec, clampBudgetValue, clampBudgets, BUDGET_FIELDS, isBudgetUnlimited, resolveBudgetRestore, toDisplayUnits, toNaturalUnits, formatCount, routerRoleSubtitle, showJevSwitch, showRouterRoleRow } from '../../lib/settingsTransform';
import { MODEL_REFRESH_TTL_MS } from '../../lib/modelRefresh';
import { trackBillingOpened } from '../../lib/analytics';
import { copyText as copyToClipboard } from '../../lib/clipboard';
import { deriveProviderStatus, friendlyProviderError, mindsProbeNotice, probePolicyUnavailableSentence, probeRateLimitedSentence } from '../../lib/providerStatus';
import { useHubUsageContext } from '../../lib/hubUsageContext';
import { USAGE_ACTIONS, usageActionUrl, allowanceStopCopy, freeServingPausedCopy, budgetExceededCopy } from '../../lib/usageWarnings';
import { ToggleGroup } from '../../components/ui/ToggleGroup';
import { Switch } from '../../components/ui/Switch';
import { Badge, Button, Input, Checkbox, Select, Tooltip } from '../../components/ui';
import Spinner from '../../components/ui/Spinner';
import ModelSelect from '../../components/ModelSelect.jsx';
import { host } from '../../../platform/host';
import { DEFAULT_SKIN, SKINS, SKIN_LOCKED, normalizeSkin, skinLabel } from '../../../lib/skins';
import { stockBackground } from '../../../lib/stockThemeTokens';
import { MINDS_API_BASE, MINDS_API_KEY_URL, MINDS_REGISTER_URL, MINDS_BILLING_URL } from '../../../lib/mindsUrls';
import { useBudgetsUrl } from '../../hooks/useBudgetsUrl';
import { useOrgMode } from '../../../lib/orgMode';
import { isElectron } from '../../../platform/host';
import ChannelsView from '../ChannelsView';
import UpdatesSection from './UpdatesSection';
import BackendSection from './BackendSection';
import AccountSection from './AccountSection';
import UsageSection from './UsageSection';
import { SettingsGroup, SettingsLayoutContext, Section, SettingsSectionPanel } from './settingsLayout';
import CodingAgentSettingsSection from './CodingAgentSettingsSection';
import OrgBrandingFields from './OrgBrandingFields';
import BrowserSettingsSection from './BrowserSettingsSection';
import ComputersSettingsSection from './ComputersSettingsSection';
import { navItemsForHost } from './settingsNavigation';
import i18n, { useTranslation } from '../../../lib/i18n';
import { useCodeModeAccess } from '../../code/codeModeAccess';
import { useSettingsDraft } from './useSettingsDraft';
import { PLATFORM_UI } from '../../../lib/deployment';
import { providerTestsEnabled } from '../../../lib/providerTests';
import { visibleProviderCards } from './providerVisibility';
import { productName } from '../../../lib/deploymentBrand';
import { STOCK_WORDMARK } from '../../../../shared/product-name';

// Small icon button that lives inside a text field (clear / reveal / copy).
// CORE carries the shape; the states add color/background/cursor so no state
// ever stacks two utilities for the same property.
const FIELD_ICON_BTN_CORE =
  'inline-flex items-center justify-center w-[28px] h-[26px] rounded-md border-0 p-0';
const FIELD_ICON_BTN_BASE = `${FIELD_ICON_BTN_CORE} bg-transparent text-ink-3 cursor-pointer`;
// Variant absolutely positioned against the field's right edge.
const FIELD_ICON_BTN = `${FIELD_ICON_BTN_BASE} absolute right-1 top-1/2 -translate-y-1/2`;

// Native <input type="color"> rendered as a small swatch well.
const COLOR_SWATCH_INPUT =
  'w-[64px] h-[32px] p-0.5 border border-solid border-line-2 rounded-md bg-surface cursor-pointer';

const FAVICON_MIME_TYPES = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml', 'image/webp'];
const FAVICON_EXTENSION_TYPES = { png: 'image/png', ico: 'image/x-icon', svg: 'image/svg+xml', webp: 'image/webp' };

// Inline text-link button (renders inside a sentence, inherits its type).
const LINK_BTN =
  'bg-transparent border-none p-0 cursor-pointer text-accent underline text-[length:inherit] [font-family:inherit]';

// Renders a translated message whose `{link}` argument is a React element
// (a button or anchor), so the sentence stays one message in the catalog.
const LINK_TOKEN = '';
function withLink(message, link) {
  const [before, after = ''] = message.split(LINK_TOKEN);
  return <>{before}{link}{after}</>;
}
const NO_ORG_LOCKS = { style: false, theme: false, greeting: false, logo: false, favicon: false };

// Where a deep link (?settings=appearance&section=…) lands on Appearance.
export const APPEARANCE_ANCHORS = {
  style: 'settings-appearance-style',
  display: 'settings-appearance-display',
};

/* The notice under each Settings > Agent role row after the MindsHub health
   probe was refused, one per `mindsProbeNotice` kind. Exported for the visual
   fixture.

   Two stacked lines for the billing stops (ENG-1248): the state and its funds
   action read first on their own line, and the BYOK escape hatch sits under
   it. Inline, the escape hatch diluted the one action that matters when the
   wallet is empty. The velocity limit and a billing outage get one muted line
   and no billing action: money fixes neither.

   `usage` is the `/hub/usage/` view, which decides the allowance copy (a
   refill time, or the no-grant sentence). */
export function MindsProbeNotice({ notice, usage = null, isBillingOwner = false, providerTestsAvailable = true }) {
  const { t } = useTranslation('settings');
  if (!PLATFORM_UI || !providerTestsAvailable) {
    return <div className="text-[12px] text-ink-3">{t('providers.unavailable')}</div>;
  }
  const byok = <div className="text-ink-3">{t('probe.byok')}</div>;
  if (notice.kind === 'no_credits') {
    return (
      <div className="text-[12px] leading-[1.6] grid gap-px">
        <div>
          <span className="text-danger font-semibold">{t('probe.noCredits')}{' '}</span>
          <button
            type="button"
            // Recorded before the navigation, so web and
            // desktop count identically. `host.openExternal` is
            // always defined and already falls back to window.open
            // internally (platform/host.ts), with noopener —
            // guarding it here was dead code that would have opened
            // an unhardened window if it ever had run.
            onClick={() => {
              trackBillingOpened('no_credits_notice');
              return host.openExternal(MINDS_BILLING_URL);
            }}
            className={LINK_BTN}
          >{t('probe.topUp')}</button>
        </div>
        {byok}
      </div>
    );
  }
  if (notice.kind === 'allowance_used' || notice.kind === 'paused') {
    const allowance = notice.kind === 'allowance_used';
    /* The same sentences the stopped-task cards use for the same stops. Each
       gets its own trigger, apart from the card's: a funnel reads a failed
       Settings test and a stopped task as different moments. */
    const body = allowance
      ? allowanceStopCopy({ resetAt: notice.resetAt, usage })
      : freeServingPausedCopy(notice.resetAt);
    return (
      <div className="text-[12px] leading-[1.6] grid gap-px">
        <div>
          <span className="text-danger">{body} </span>
          <button
            type="button"
            onClick={() => {
              // Literal triggers inline, so the analytics vocabulary sweep sees them.
              trackBillingOpened(allowance ? 'allowance_used_notice' : 'free_air_paused_notice');
              return host.openExternal(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner }));
            }}
            className={LINK_BTN}
          >{t('probe.addFunds')}</button>
        </div>
        {byok}
      </div>
    );
  }
  if (notice.kind === 'budget_reached') {
    // Credits do not lift a budget, so the link goes to Budgets, not funds.
    return (
      <div className="text-[12px] leading-[1.6] grid gap-px">
        <div>
          <span className="text-danger">{t('probe.budgetReached', { detail: budgetExceededCopy({ usage }) })} </span>
          <ViewBudgetsLink>{t('probe.viewBudgetsArrow')}</ViewBudgetsLink>
        </div>
        {byok}
      </div>
    );
  }
  if (notice.kind === 'slow_down') {
    return (
      <div className="text-[12px] leading-[1.6] text-ink-3">
        {t('probe.slowDown', { sentence: probeRateLimitedSentence() })}
      </div>
    );
  }
  if (notice.kind === 'billing_unavailable') {
    return (
      <div className="text-[12px] leading-[1.6] text-ink-3">
        {probePolicyUnavailableSentence()}
      </div>
    );
  }
  return null;
}

/** The Budgets tab for this session's organization; credits do not lift a budget. */
function ViewBudgetsLink({ children }) {
  const budgetsUrl = useBudgetsUrl();
  return (
    <button
      type="button"
      onClick={() => {
        trackBillingOpened('budget_notice');
        return host.openExternal(budgetsUrl);
      }}
      className={LINK_BTN}
    >{children}</button>
  );
}

/* The line under a role's picker when the CURRENT model cannot run. The
   stored pin is never rewritten, so a wallet that drains, or an admin rule
   that lands, leaves the user sitting on a model they can no longer run. This
   names it and gives the way out. A restricted model has no billing way out,
   so its line has no link; a budget-stopped one links to Budgets. Exported
   for the visual fixture. */
export function UnavailableModelHint({ label, restricted, budgetReached = false }) {
  const { t } = useTranslation('settings');
  if (!PLATFORM_UI) {
    return <div className="text-[11.5px] text-ink-3">{t('agent.modelUnavailable', { model: label })}</div>;
  }
  if (restricted) {
    return (
      <div className="text-[11.5px] text-ink-3">
        {t('agent.modelRestricted', { model: label })}
      </div>
    );
  }
  if (budgetReached) {
    return (
      <div className="text-[11.5px] text-ink-3">
        {t('agent.modelBudgetReached', { model: label })}{' '}
        <ViewBudgetsLink>{t('agent.viewBudgets')}</ViewBudgetsLink>
      </div>
    );
  }
  return (
    <div className="text-[11.5px] text-ink-3">
      {withLink(t('agent.modelNeedsCredits', { model: label, link: LINK_TOKEN }), (
        <button
          type="button"
          onClick={() => {
            trackBillingOpened('locked_model_hint');
            return host.openExternal(MINDS_BILLING_URL);
          }}
          className={LINK_BTN}
        >{t('agent.topUpBalance')}</button>
      ))}
    </div>
  );
}

// Numeric input for the Advanced Settings agent budgets. State keeps the
// server's string form (settings round-trip as strings; the page-wide dirty
// compare is a JSON diff, so types must stay stable across save → re-fetch).
// Free typing is allowed — including transiently empty/out-of-range text —
// and the value is clamped into [min, max] on blur. Two deliberate rules:
//   * An untouched field never commits (blur alone must not materialize a
//     key the server never sent — that would flip Save to dirty with zero
//     edits and PUT an unknown key to an older server).
//   * Emptied/unparseable input reverts to the last committed value, not the
//     factory default (clearing a saved 500 to retype must not save 50).
// Escape-dismiss skips blur entirely; clampBudgets() in save() is the
// backstop that keeps rejectable values out of every PUT.
// `lockedValue`: while the limits switch is off the field is read-only and
// shows the safety limit in force instead of the user's saved value, which is
// left untouched for when the switch goes back on.
function BudgetNumberField({ settingKey, value, savedValue, spec, label, setSetting, unlimitedLabel, lockedValue = null }) {
  const { t } = useTranslation('settings');
  const { min, max, fallback } = spec;
  const hintId = useId();
  // "No limit" writes the TOP of the range, which already was the off switch —
  // it was just undiscoverable, which is the whole job of this checkbox. Writing
  // `spec.max` keeps the range contiguous, so there is no sentinel to guard with
  // a server-side validator and no special case in the clamp.
  //
  // The hint below says "only the step and auto-continue caps apply" rather
  // than promising infinity, and that wording is load-bearing: at ~2,750 calls
  // (the server's default 250 rounds x 11 passes) 50M is reached at ~18k per
  // call, which almost any conversation carries. Never observed — largest turn
  // in 30 days was 34.4M — but not impossible.
  const locked = lockedValue != null;
  const showUnlimited = unlimitedLabel != null && spec.max != null;
  const isUnlimited = showUnlimited && isBudgetUnlimited(locked ? lockedValue : value, spec);
  // The number to put back when the switch goes off. A ref, not state: it must
  // survive re-renders without causing one, and it is read only on toggle.
  const preToggle = useRef(null);
  if (showUnlimited && !isUnlimited && value != null) preToggle.current = value;
  // The input reads/writes in `spec.unitDivisor` units (millions, for
  // maxTurnTokens) — seven-digit token counts aren't something anyone wants
  // to type or read. Storage stays in natural units throughout; only the
  // displayed text and what onChange/onBlur parse are scaled. See
  // toDisplayUnits/toNaturalUnits in settingsTransform.js.
  const hasUnit = !!spec.unitDivisor;
  const toDisplay = (v) => toDisplayUnits(v, spec);
  const toNatural = (v) => toNaturalUnits(v, spec);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="inline-flex items-start gap-2">
        <div className="flex flex-col items-start gap-1">
          {/* globals.css `.field-input` sets width:100% and loads after the
              Tailwind layer, so a w-[90px] utility loses the cascade — inline
              width is the one reliable override here. */}
          <input
            className="field-input"
            style={{ width: 90 }}
            type="number"
            inputMode="decimal"
            min={toDisplay(min)}
            max={toDisplay(max)}
            disabled={locked || isUnlimited}
            // Show the number they'd return to, not the max: a disabled field
            // reading 50000000 invites someone to "fix" it back down by hand.
            value={locked
              ? toDisplay(lockedValue)
              : isUnlimited
                ? toDisplay(resolveBudgetRestore(preToggle.current, savedValue, spec))
                : toDisplay(value ?? String(fallback))}
            onChange={(e) => setSetting(settingKey, toNatural(e.target.value))}
            onBlur={(e) => {
              if (value == null) return; // untouched — don't materialize the key
              // Emptying the field reverts to the factory default — clearing
              // any of the three budget fields is the discoverable way to
              // reset it, not a mid-retype state to preserve.
              setSetting(settingKey, clampBudgetValue(toNatural(e.target.value), spec));
            }}
            aria-label={label}
            aria-describedby={hintId}
            title={t('budget.fieldTitle', {
              label,
              min: formatCount(toDisplay(min)),
              max: formatCount(toDisplay(max)),
              fallback: formatCount(toDisplay(fallback)),
              unit: hasUnit ? 'million' : 'none',
            })}
          />
          {hasUnit && <span className="text-[11.5px] text-ink-4 whitespace-nowrap">{t('budget.millionTokens')}</span>}
        </div>
        <div id={hintId} className="flex flex-col text-[11.5px] text-ink-3">
          {locked ? (
            <span className="whitespace-nowrap">{t('budget.safetyLimit')}</span>
          ) : isUnlimited ? (
            <span className="whitespace-nowrap">{t('budget.noLimitHint')}</span>
          ) : (
            <>
              <span className="whitespace-nowrap">{formatCount(toDisplay(min))}&ndash;{formatCount(toDisplay(max))}</span>
              <span className="whitespace-nowrap">{t('budget.default', { value: formatCount(toDisplay(fallback)) })}</span>
            </>
          )}
        </div>
      </div>
      {showUnlimited && (
        <div className="flex flex-col items-start gap-1.5">
          <span className="text-[11px] text-ink-4">{t('budget.or')}</span>
          <label className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
            <Checkbox
              checked={isUnlimited}
              disabled={locked}
              onCheckedChange={(on) => setSetting(
                settingKey,
                on
                  ? String(spec.max)
                  : resolveBudgetRestore(preToggle.current, savedValue, spec),
              )}
              aria-label={unlimitedLabel}
            />
            <span className="text-[11.5px] text-ink-3">{unlimitedLabel}</span>
          </label>
        </div>
      )}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, title, ariaLabel, disabled }) {
  return (
    <Input
      value={value ?? ''}
      onChange={(next) => onChange(next)}
      placeholder={placeholder}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
    />
  );
}

// Drop-in for TextInput in Credentials rows. Adds a × button inside the
// field that empties the value — pairs with the trash icon on the API
// key fields so the whole Credentials card uses one clear gesture.
// Save settings still has to be clicked to commit the deletion to env.
function ClearableTextInput({ value, onChange, placeholder, ariaLabel }) {
  const { t } = useTranslation('settings');
  const v = value ?? '';
  const hasValue = v.length > 0;
  return (
    <div className="relative">
      <Input
        value={v}
        onChange={(next) => onChange(next)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        style={hasValue ? { paddingRight: 36 } : undefined}
      />
      {hasValue && (
        <Tooltip content={t('fields.clearTooltip')}>
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('fields.clearAriaLabel')}
            className={FIELD_ICON_BTN}
          >
            {Ico.close(14)}
          </button>
        </Tooltip>
      )}
    </div>
  );
}

// Masked credential input. The backend returns "***" as a sentinel for
// stored keys (the real value never leaves disk on a plain GET), so the
// eye icon does two things:
//   (a) toggles the input type between password and text, and
//   (b) when revealing a sentinel and `revealName` is set, asks the
//       server for the real stored value via /settings/reveal-key.
// The fetched value is held in local component state — we never push it
// into the parent settings object, so saving an untouched revealed value
// still sends "***" and the server skips overwriting the stored key.
// Whether toggling the eye should fetch the real stored key from the server.
//
// `isWeb` short-circuits everything: `/settings/reveal-key` returns UNMASKED
// provider secrets and is loopback-only server-side (`_require_local`), and on
// hosted the browser reaches the server from the docker bridge rather than
// 127.0.0.1 — so the fetch would 403. That is the ENG-912 shape: a panel that
// looks functional and throws on a sub-action. A web user can still SET a key
// (`PUT /settings/{key}` is not gated); they just can't read the stored one
// back, and the field keeps showing the "***" sentinel.
//
// Extracted as a pure predicate rather than inlined so both platforms' paths
// are directly testable — this gate lives inside a shared component that
// desktop depends on, and the desktop direction is the one a web-only change
// is most likely to break silently (ENG-932).
export function shouldRevealStoredKey({ isWeb, show, revealName, isSentinel, alreadyRevealed }) {
  if (isWeb) return false;
  // Only worth a round trip when the field is currently masked, the caller told
  // us which key to ask for, the value really is the server's sentinel, and we
  // haven't already fetched it.
  return !show && Boolean(revealName) && Boolean(isSentinel) && !alreadyRevealed;
}

function ApiKeyInput({ value, onChange, placeholder, disabled, revealName }) {
  const { t } = useTranslation('settings');
  const [show, setShow] = useState(false);
  // 'idle' | 'copied' | 'failed' — 'failed' surfaces feedback when the
  // clipboard helper's fallback chain (see lib/clipboard.js) also fails,
  // instead of leaving the button looking like it silently did nothing.
  const [copyState, setCopyState] = useState('idle');
  const [revealedValue, setRevealedValue] = useState(null); // null = no fetched override
  const [revealing, setRevealing] = useState(false);

  const stored = value ?? '';
  const isSentinel = stored === '***';
  // What the input renders. While the user hasn't toggled reveal we show
  // `stored` (typically "***" if the server has a key, or "" if not).
  // After a successful reveal we show the fetched value.
  const v = revealedValue ?? stored;
  const hasValue = v.length > 0;
  // Copy is gated on what the input is *displaying* — not the prop. After
  // a reveal, `v` is the real key (held locally; we never push it up to
  // the parent) so `stored` still equals "***" but the user can copy the
  // resolved value. Using `v === '***'` here keeps the "reveal first"
  // hint while the field still shows the masked sentinel.
  const isDisplayingSentinel = v === '***';
  const canCopy = hasValue && !isDisplayingSentinel;

  const onCopy = async () => {
    if (!hasValue) return;
    const ok = await copyToClipboard(v);
    if (ok) {
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } else {
      // Unlike 'copied', 'failed' doesn't auto-clear on a timer — an error
      // needs longer than 1.5s to read. It clears on the next copy attempt
      // (above) or here, on blur.
      setCopyState('failed');
    }
  };

  const onToggleShow = async () => {
    if (shouldRevealStoredKey({
      isWeb: host.isWeb,
      show,
      revealName,
      isSentinel,
      alreadyRevealed: revealedValue !== null,
    })) {
      // Reveal the real stored key from the loopback server.
      setRevealing(true);
      try {
        const real = await revealSettingKey(revealName);
        if (real) setRevealedValue(real);
      } finally {
        setRevealing(false);
      }
    }
    if (show) {
      // Going back to hidden — drop any fetched value so the next
      // reveal re-fetches (and we don't keep a plaintext key around).
      setRevealedValue(null);
    }
    setShow((s) => !s);
  };

  // If the user types, treat that as a fresh local edit. Clear any
  // revealed-from-server value and forward straight to the parent.
  const onInput = (next) => {
    if (revealedValue !== null) setRevealedValue(null);
    onChange(next);
  };

  // Trash → empty the field locally. The change only hits the server
  // on Save settings, where update_settings sees an empty string and
  // routes the key to its delete branch (`_stage_string_env` / the API
  // key block). Also resets reveal state so we don't keep a fetched
  // plaintext copy around.
  const onClearField = () => {
    setRevealedValue(null);
    setShow(false);
    onChange('');
  };

  const btnClass = FIELD_ICON_BTN_BASE;
  const btnClassActive = `${FIELD_ICON_BTN_CORE} cursor-pointer text-ink bg-surface-2`;
  const btnClassDisabled = `${FIELD_ICON_BTN_CORE} bg-transparent text-ink-3 opacity-35 cursor-not-allowed`;

  // When the field is holding the server sentinel and the user hasn't
  // toggled reveal, render the input as empty + a long bullet placeholder.
  // The literal "***" rendered as type=password is only 3 dots wide, which
  // looks like an almost-empty field rather than "a stored key is here."
  // Typing replaces the (empty) value cleanly — no asterisk contamination.
  const showSentinelAsMask = !show && v === '***';

  const copyHint = isDisplayingSentinel ? t('apiKey.revealFirst')
    : copyState === 'copied' ? t('apiKey.copied')
      : copyState === 'failed' ? t('apiKey.copyFailed')
        : t('apiKey.copy');

  return (
    <div className="relative">
      <Input
        variant="mono"
        type={show ? 'text' : 'password'}
        value={showSentinelAsMask ? '' : v}
        onChange={(next) => onInput(next)}
        placeholder={showSentinelAsMask ? '••••••••••••••••' : (placeholder || '••••••••••••••••••')}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        aria-label={revealName ? t('apiKey.namedAriaLabel', { name: revealName }) : t('apiKey.ariaLabel')}
        style={{ paddingRight: 108 }}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5">
        <span className="relative inline-flex">
          <Tooltip content={copyHint}>
            <button
              type="button"
              onClick={onCopy}
              onBlur={() => { if (copyState === 'failed') setCopyState('idle'); }}
              disabled={!canCopy}
              title={!canCopy ? copyHint : undefined}
              aria-label={copyState === 'copied' ? t('apiKey.copiedAriaLabel') : t('apiKey.copyAriaLabel')}
              className={canCopy ? btnClass : btnClassDisabled}
            >
              {copyState === 'copied' ? Ico.check(14) : Ico.copy(14)}
            </button>
          </Tooltip>
          {(copyState === 'copied' || copyState === 'failed') && (
            <span
              role="status"
              aria-live="polite"
              className={`absolute bottom-[calc(100%+6px)] left-1/2 py-[3px] px-2 text-[10.5px] font-semibold tracking-[0.04em] uppercase bg-surface-3 border border-solid rounded-md whitespace-nowrap pointer-events-none shadow-sh-2 z-[5] ${copyState === 'failed'
                ? 'text-danger border-[color-mix(in_srgb,var(--danger)_45%,transparent)]'
                : 'text-accent border-[color-mix(in_srgb,var(--accent)_45%,transparent)]'}`}
              style={{
                // 'copied' pops in, holds, fades on its own 1.5s clock. 'failed'
                // only pops in and holds — it's cleared by state (next attempt
                // or blur), not by the animation, so it stays legible.
                animation: copyState === 'failed' ? 'failed-pop var(--dur-layout) ease forwards' : 'copied-pop 1.5s ease forwards',
              }}
            >{copyState === 'failed' ? t('apiKey.copyFailed') : t('apiKey.copied')}</span>
          )}
        </span>
        <Tooltip content={show ? t('apiKey.hide') : (revealing ? t('apiKey.revealing') : t('apiKey.reveal'))}>
          <button
            type="button"
            onClick={onToggleShow}
            disabled={revealing}
            aria-label={show ? t('apiKey.hide') : t('apiKey.reveal')}
            aria-pressed={show}
            className={show ? btnClassActive : btnClass}
          >
            {show ? Ico.eyeOff(14) : Ico.eye(14)}
          </button>
        </Tooltip>
        <Tooltip content={t('apiKey.clearTooltip')}>
          <button
            type="button"
            onClick={onClearField}
            disabled={!hasValue}
            aria-label={t('apiKey.clearAriaLabel')}
            className={hasValue ? btnClass : btnClassDisabled}
          >
            {Ico.close(14)}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

// Pill that hangs off a credential row's title to show whether the field
// is required, optional, auto-managed, or unused for the active provider.
// Drives the eye flow toward what matters for the current selection.
function RelevanceBadge({ status }) {
  if (!status || status === 'unused') return null;
  const config = {
    required: { variant: 'warning', label: 'Required' },
    optional: { variant: 'muted', label: 'Optional' },
    auto: { variant: 'success', label: 'Auto' },
  }[status];
  if (!config) return null;
  return (
    <Badge
      variant={config.variant}
      size="xs"
      className="ml-2 align-middle uppercase tracking-[0.04em]"
    >{config.label}</Badge>
  );
}

// Small green pill that confirms a credential is stored. Pairs with the
// Required / Optional relevance badge so users can answer two questions
// at a glance: "do I need this?" and "is it filled in?". Independent of
// reveal — driven purely by whether the field has a non-empty value
// (which for API keys means either the "***" sentinel from the server
// or a freshly typed key not yet saved).
//
// `active` lifts the badge visually when the credential is on the
// active provider's hot path (required / optional / auto-managed for
// this preset). Idle rows that just happen to still hold a value keep
// the muted look so the eye is drawn to what's currently in use.
function SetBadge({ hasValue, active }) {
  if (!hasValue) return null;
  return (
    <Badge
      title={active
        ? 'Stored and used by the active provider'
        : 'A value is stored, but the active provider does not use it'}
      variant="success"
      size="xs"
      className={`ml-2 align-middle uppercase tracking-[0.04em] ${active ? 'set-badge-pulse' : ''}`}
      icon={<span aria-hidden className={`w-1.5 h-1.5 rounded-full bg-current ${active
        ? 'shadow-[0_0_8px_currentColor,0_0_14px_color-mix(in_srgb,var(--sage-500)_60%,transparent)]'
        : 'shadow-[0_0_4px_color-mix(in_srgb,var(--sage-500)_45%,transparent)]'}`} />}
      style={{
        // When active, the box-shadow comes from the set-badge-pulse
        // keyframes; the static value would never paint. When inactive
        // we explicitly clear any inherited shadow.
        boxShadow: active ? undefined : 'none',
        animation: active ? 'set-badge-pulse 2.4s ease-in-out infinite' : 'none',
        transition: 'box-shadow var(--dur-hover) ease, background var(--dur-hover) ease, color var(--dur-hover) ease',
      }}
    >
      Set
    </Badge>
  );
}

// ───────────────────────── Multi-provider helpers ─────────────────────────

const PROVIDER_TYPE_ORDER = ['minds-cloud', 'anthropic', 'openai', 'gemini', 'openai-compatible'];

export function providerStatusBadge(status, configured) {
  if (status === 'ok') return { label: i18n.t('settings:providers.status.connected'), variant: 'success' };
  if (status === 'fail') return { label: i18n.t('settings:providers.status.unableToConnect'), variant: 'danger' };
  if (status === 'testing') return { label: i18n.t('settings:providers.status.testing'), variant: 'warning' };
  if (configured) return { label: i18n.t('settings:providers.status.notTested'), variant: 'muted' };
  return null;
}

// Catalog keys (settings:providers.desc.*) for each provider type's blurb.
const PROVIDER_TYPE_DESC = {
  'minds-cloud': 'providers.desc.mindsCloud',
  anthropic: 'providers.desc.anthropic',
  openai: 'providers.desc.openai',
  gemini: 'providers.desc.gemini',
  'openai-compatible': 'providers.desc.openaiCompatible',
};

const GET_KEY_URL = {
  'minds-cloud': MINDS_API_KEY_URL,
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
  'openai-compatible': null,
};

const PROTECTED_PROVIDER_TYPES = new Set(['minds-cloud']);

function makeEmptyProvider(type) {
  const base = { type, apiKey: '', isDefault: false };
  if (type === 'openai-compatible') base.baseUrl = '';
  if (type === 'minds-cloud') {
    base.mindsUrl = MINDS_API_BASE;
    base.mindsMindName = '';
    base.mindsDatasource = '';
    base.mindsDatasourceEngine = '';
    base.mindsSslVerify = true;
  }
  return base;
}

function dedupeByType(arr) {
  const map = {};
  for (const p of arr) map[p.type] = p;
  return Object.values(map);
}

function setOneDefault(arr, type) {
  return arr.map((p) => ({ ...p, isDefault: p.type === type }));
}

function ensureDefaultInvariant(arr) {
  if (!arr.length) return arr;
  if (arr.some((p) => p.isDefault)) {
    let found = false;
    return arr.map((p) => {
      if (p.isDefault && !found) { found = true; return p; }
      if (p.isDefault) return { ...p, isDefault: false };
      return p;
    });
  }
  return arr.map((p, i) => ({ ...p, isDefault: i === 0 }));
}

const PROVIDER_LABELS_LOCAL = {
  'minds-cloud': 'MindsHub',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  'openai-compatible': 'OpenAI-compatible',
};

// Wrapper that dims a Section row when the credential is unused for the
// active provider. Built on the existing Section grid so layout stays
// consistent.
function CredentialRow({ title, subtitle, status, hasValue, children }) {
  const dimmed = status === 'unused';
  // The Set badge only glows when this credential is on the active
  // provider's actual auth path — i.e. the active preset *requires* it
  // (or auto-manages it). `optional` credentials (e.g. Minds API key
  // while on Anthropic) and `unused` ones show Set in a muted style so
  // the glow stays meaningful: "this is what's authenticating you now."
  const setActive = hasValue && (status === 'required' || status === 'auto');
  const titleNode = (
    <span className="inline-flex items-center flex-wrap gap-y-1">
      {title}
      <RelevanceBadge status={status} />
      <SetBadge hasValue={hasValue} active={setActive} />
    </span>
  );
  return (
    <div className={`[transition:opacity_var(--dur-hover)_ease] ${dimmed ? 'opacity-50' : 'opacity-100'}`}>
      <Section title={titleNode} subtitle={subtitle}>{children}</Section>
    </div>
  );
}

// ───────────────────────── Nav sidebar ─────────────────────────

function SettingsNav({ section, onSectionChange, serverOnline = true, items = [] }) {
  const { t } = useTranslation('settings');
  return (
    <nav
      role="navigation"
      aria-label={t('nav.ariaLabel')}
      className="w-[180px] shrink-0 border-r border-y-0 border-l-0 border-solid border-line py-5 px-2.5 flex flex-col gap-0.5"
    >
      <div className="section-label pt-0 px-2.5 pb-1.5">{t('nav.title')}</div>
      {items.map((item, index) => {
        const active = section === item.id;
        // A dead local server cannot accept most settings saves. Keep Backend
        // available as the recovery path and Coding agent available because
        // the Code switch is device-local and works before the runtime starts.
        // Hosted rows remain usable because those APIs are managed.
        const disabled = !host.isWeb
          && !serverOnline
          && item.id !== 'backend'
          && item.id !== 'codingAgent';
        const icon = Ico[item.icon] ? Ico[item.icon](14) : null;
        const showGroup = index === 0 || items[index - 1]?.group !== item.group;
        return (
          <Fragment key={item.id}>
          {showGroup && <div className="section-label mt-3 first:mt-0 px-2.5 pb-1">{t(`nav.groups.${item.group}`)}</div>}
          <button
            type="button"
            onClick={disabled ? undefined : () => onSectionChange?.(item.id)}
            aria-current={active ? 'page' : undefined}
            aria-disabled={disabled ? 'true' : undefined}
            className={`w-full flex items-center gap-2 py-2 px-2.5 rounded-[7px] border-0 text-[13px] [font-family:inherit] text-left [transition:background_var(--dur-hover)_ease,color_var(--dur-hover)_ease] ${active
              ? 'bg-surface-2 text-ink font-semibold'
              : 'bg-transparent text-ink-3 font-normal hover:bg-surface-2 hover:text-ink'} ${disabled
              ? 'opacity-35 pointer-events-none cursor-default'
              : 'cursor-pointer'}`}
          >
            {icon && (
              <span aria-hidden="true" className="inline-flex shrink-0 text-[color:inherit]">
                {icon}
              </span>
            )}
            <span>{t(`nav.items.${item.id}`)}</span>
          </button>
          </Fragment>
        );
      })}
    </nav>
  );
}

export default function SettingsView({
  settings: committedSettings, setSetting: setSettingProp, onSave, onAppearancePreview,
  theme, onThemeChange,
  skin, onSkinChange, customTheme, onCustomThemeChange,
  agentLabel,
  serverOnline = false,
  serverBusy = false,
  serverBusyKind = 'starting',
  onStartServer,
  onStopServer,
  section = 'agent',
  onSectionChange,
  isSsoConnected = false,
  ssoError = '',
  onSsoSignIn,
  // Mobile (ENG-990): render as a full page with master-detail navigation
  // instead of the desktop two-column layout. onClose closes the surface
  // from the section list (the top-bar back control drills out to it first).
  mobile = false,
  onClose,
  // Shell (installer) update notice (ENG-849): { version, currentVersion,
  // downloadUrl } or null. Shown in Updates regardless of banner dismissal —
  // Settings is a deliberate visit, so it always reflects the true state.
  shellUpdate = null,
  onDownloadShellUpdate,
  shellAutoUpdate = null,
  onDownloadShellAutoUpdate,
  onInstallShellAutoUpdate,
  onRetryShellAutoUpdate,
  // Company branding: the org-branding read (lib/orgBranding.ts),
  // what to call with an admin's saved answer, and the resolved look, whose
  // `lockedByOrg` turns off the member's own controls the org has set.
  orgBranding = null,
  onOrgBrandingSaved,
  // An admin's unsaved Branding edits, for the live preview (null = none).
  onOrgBrandingDraft,
  look = null,
  // Web with the platform UI in org mode, personal orgs included: there is no
  // per-person sidebar title, logo or tab icon to set.
  hostedMindsHub = false,
  // A deep link's part of Appearance to scroll to ('branding' | 'display'),
  // and what to call once it has.
  appearanceAnchor = null,
  onAppearanceAnchorShown,
}) {
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { t } = useTranslation('settings');
  const draft = useSettingsDraft(committedSettings);
  const { settings, setSetting, dirty: settingsDirty } = draft;
  const lastSavedSettings = committedSettings;
  const codeModeAccess = useCodeModeAccess();
  const canEditBranding = Boolean(orgBranding?.enabled && orgBranding?.canEdit);
  const visibleNav = navItemsForHost(
    host.isWeb,
    codeModeAccess.available,
    codeModeAccess.enabled,
    { branding: canEditBranding },
  );
  // Branding is for org admins; anyone else sent there (a deep link, a
  // stale section) lands on Appearance, where their own look is.
  const shownSection = section === 'branding' && !canEditBranding ? 'appearance' : section;
  const orgLocks = look?.lockedByOrg ?? NO_ORG_LOCKS;
  const orgMode = useOrgMode();
  const providerTestsAvailable = providerTestsEnabled(host.isWeb);
  // The `/hub/usage/` view App polls: the probe notice reads it for the
  // allowance copy and the funds link. Null outside the provider (tests).
  const hubUsageCtx = useHubUsageContext();
  const hubUsage = hubUsageCtx?.usage || null;
  const isBillingOwner = !!hubUsage?.isBillingOwner;
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [validation, setValidation] = useState(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  // "Tested" is a brief confirmation. Own its timer so a stale one can't
  // clear a newer result, and none fires after the view unmounts.
  const testedTimerRef = useRef(null);
  const showTested = ({ autoHide = false } = {}) => {
    clearTimeout(testedTimerRef.current);
    testedTimerRef.current = null;
    setTested(true);
    if (autoHide) testedTimerRef.current = setTimeout(() => setTested(false), 2400);
  };
  const resetTested = () => {
    clearTimeout(testedTimerRef.current);
    testedTimerRef.current = null;
    setTested(false);
  };
  useEffect(() => () => clearTimeout(testedTimerRef.current), []);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  // Per-role "use a typed model id" flag. Sticky so picking Other…
  // keeps the text input visible even when the typed value is empty.
  const [modelInputMode, setModelInputMode] = useState({ planning: false, coding: false });
  // Per-role "refetching model list on dropdown open" flag — drives the
  // trigger's spinner so a still-open dropdown showing possibly-stale
  // locked/unlocked state doesn't read as done loading.
  const [modelRefreshing, setModelRefreshing] = useState({ planning: false, coding: false, router: false });
  // Start by distrusting a persisted provider failure. The mount-time check
  // below decides whether it is still real before failure UI is shown. A deployment
  // with testing disabled keeps the stored result without running connectivity tests.
  const [initialProviderTestDone, setInitialProviderTestDone] = useState(!providerTestsAvailable);
  // Per-role note of when the refresh above last landed fresh data, so
  // re-opening the dropdown doesn't re-pay a round trip that just completed.
  // -Infinity, not 0: performance.now() is already well past 0 by first render, so a
  // 0 sentinel reads as "refreshed at page load" and skips the first open of the
  // session — the one open where the wallet state is most likely to be stale.
  const modelOpenState = useRef({});
  const modelOpenFor = (role) => (modelOpenState.current[role] ||= { refreshedAt: -Infinity });
  // Whether the refresh token lives in the macOS keychain (vs a file under
  // ~/.cowork). Mac-only; read from main on mount.
  const [keychainPref, setKeychainPref] = useState(false);
  // Mobile master-detail (ENG-990/ENG-991): the open section is the shared
  // `section` prop, not a separate local state — so a deep-link
  // (onOpenSettings('backend')) lands on that section AND the section-keyed
  // load effects below fire on mobile too. `section == null` is the list; a
  // row tap calls onSectionChange(id), the back control onSectionChange(null).

  useEffect(() => { if (host.isElectron && host.isMac()) host.getKeychainPref().then(setKeychainPref).catch(() => { }); }, []);

  // Optimistically flip the keychain toggle, then persist via main. Revert
  // the local state if the migration/write fails.
  const handleKeychainToggle = async (next) => {
    setKeychainPref(next);
    try {
      const ok = await host.setKeychainPref(next);
      if (!ok) setKeychainPref(!next);
    } catch {
      setKeychainPref(!next);
    }
  };

  // Tracks whether any LLM-affecting setting changed since the last
  // successful Save. Used to skip provider tests on a no-op Save so a
  // user just toggling appearance doesn't pay the network round-trip.
  const [llmDirty, setLlmDirty] = useState(false);
  // Providers currently showing the API key input instead of the status pill.
  // Starts empty — providers flip to key-edit mode when the user clicks Edit.
  // Cleared automatically after a successful save+test so the pill re-appears.
  const [editingProviders, setEditingProviders] = useState(new Set());
  // Capability probe for the Advanced Settings budgets: cowork-server's
  // list_settings returns a row for EVERY UserSettings field, so a server
  // with the budget settings always sends both keys and an older one never
  // does. Gating on presence keeps the section (and any possibility of
  // writing the keys) off screens backed by servers that would 400 the
  // write — the renderer ships OTA and can lead the installed server.
  // Probe the LIVE settings, not the saved snapshot: the snapshot latches on
  // the first render (offline-open would pin "no budgets" for the whole
  // mount, even after a successful fetch). Live is equally safe — the only
  // writer that can materialize these keys is the budget field itself, which
  // sits inside this gate, so on an older server they can never appear.
  const hasBudgetSettings = settings != null
    && 'maxToolRounds' in settings
    && 'maxContinuations' in settings;
  // The limits switch, probed the same way. A server without it applies the
  // budgets on every turn, so they stay editable there.
  const hasLimitsSwitch = settings != null && 'limitsEnabled' in settings;
  const limitsOn = !hasLimitsSwitch || settings.limitsEnabled === true;
  // What a budget field shows while the switch is off: the safety limit the
  // server serves, or the factory default from a server that doesn't.
  const safetyLimit = (key) => (limitsOn
    ? null
    : settings.budgetDefaults?.[key] ?? String(BUDGET_FIELDS[key].fallback));
  // Async provider tests merge their status into the latest displayed values.
  // The draft overlay keeps edits made during those requests intact.
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; });

  const configReady = validation?.configReady ?? settings.configReady;
  const configError = validation?.configError || settings.configError;

  // Providers state — surfaced from the server, edited inline, committed
  // on Save settings. The save handler routes through the providers path
  // when `providers` is included on the patch.
  const configuredProviders = Array.isArray(settings.providers) ? settings.providers : [];
  const providers = !PLATFORM_UI || configuredProviders.some((p) => p.type === 'minds-cloud')
    ? configuredProviders : [makeEmptyProvider('minds-cloud'), ...configuredProviders];
  const visibleProviders = visibleProviderCards(settings, providers, PLATFORM_UI);
  const modelMode = settings.modelMode === 'custom' ? 'custom' : 'default';
  const overrides = settings.modelOverrides || {};
  const recommendedModels = settings.recommendedModels || {};
  const recommendedPair = settings.recommendedPair || {};
  const typeLabels = settings.providerTypeLabels || PROVIDER_LABELS_LOCAL;

  const updateProviders = (next) => setSetting('providers', dedupeByType(next));
  const availableTypesForAdd = PROVIDER_TYPE_ORDER.filter(
    (t) => (PLATFORM_UI || t !== 'minds-cloud') && !providers.some((p) => p.type === t),
  );

  const roleOverride = (role) => {
    if (modelMode !== 'custom') return null;
    const override = overrides[role];
    if (!override || typeof override !== 'object') return null;
    return { ...override, providerType: providerValueToType(override.providerType) };
  };
  const canonicalProviderForRole = (role) => effectiveRoleProvider(settings, role);
  const canonicalModelForRole = (role) => effectiveRoleModel(settings, role);
  // ENG-739: resolve the picker's current provider/model from the canonical
  // fields the SERVER executes, never from `model_overrides`. Sourcing the
  // current value from the overrides hid a stale planning_model pin
  // (latest:sonnet) behind the override's model, so the picker showed a model
  // already-selected, offered no change, and a stuck free-tier user could not
  // recover. See effectiveRoleModel / effectiveRoleProvider.
  const roleProviderType = (role) => canonicalProviderForRole(role);
  const roleModelValue = (role, fallback = '') => canonicalModelForRole(role) || fallback || '';
  // effectiveRoleProvider already falls back to MindsHub, as the server does.
  const budgetRowsShown = hasBudgetSettings && !(host.isWeb && PLATFORM_UI);
  const jevSwitchShown = showJevSwitch(settings?.routing, roleProviderType('coding'));
  const setRoleDriver = (role, providerType, model) => {
    const normalizedType = providerValueToType(providerType) || 'minds-cloud';
    // null is a tombstone ("clear the stored row so the server's enabled-aware
    // default governs", ENG-1632) and must survive to the save path untouched.
    const nextModel = model === null ? null : (model || '');
    if (role === 'planning') {
      setSetting('planningProvider', normalizedType);
      setSetting('planningModel', nextModel);
      setSetting('defaultModel', nextModel);
    } else if (role === 'router') {
      setSetting('routerProvider', normalizedType);
      setSetting('routerModel', nextModel);
    } else {
      setSetting('codingProvider', normalizedType);
      setSetting('codingModel', nextModel);
    }
  };

  // A provider is usable once it carries the credential it needs: an
  // API key for the hosted providers, or a base URL for an
  // OpenAI-compatible endpoint (key optional there). Mirrors the
  // server's _provider_configured. Note keys arrive masked ('***'),
  // which is still truthy — exactly what "has a key" should mean.
  const providerConfigured = (p) => (
    p.type === 'openai-compatible'
      ? !!(p.baseUrl || '').trim()
      : !!(p.apiKey || '').trim()
  );
  const canRetestProviders = providerTestsAvailable && providers.some(
    (p) => providerConfigured(p) && (settings.providerStatus || {})[p.type] === 'fail',
  );

  // The provider that drives roles in default mode. Mirrors the
  // server's _default_provider: prefer MindsHub when it's actually
  // keyed, otherwise fall back to the first configured provider so
  // adding e.g. an Anthropic key "just works" without touching the
  // custom-model controls. Falls back to MindsHub when nothing is
  // configured so the unconfigured baseline still surfaces a row.
  const defaultModeProviderType = (() => {
    const minds = visibleProviders.find((p) => p.type === 'minds-cloud');
    if (minds && providerConfigured(minds)) return 'minds-cloud';
    const configured = visibleProviders.find(providerConfigured);
    return configured ? configured.type : PLATFORM_UI ? 'minds-cloud' : '';
  })();

  // Which provider types actually drive planning + coding right now.
  // Planning and coding can pick *different* providers, so the active
  // set is the union of both roles. A role with no explicit override
  // implicitly falls back to the default-mode provider (matches the
  // server's _resolve_role logic) — include that in the set so the
  // test still pings it. Used by the per-row dot, runProviderTests,
  // and the banner's effective-ready calculation.
  const activeProviderTypes = (() => {
    const types = new Set();
    if (modelMode === 'custom') {
      // ENG-739: source each role's provider from the canonical field the
      // server executes (via roleProviderType), not the orphaned
      // model_overrides — otherwise connectivity tests + the readiness banner
      // could target a different provider than the picker and the server use.
      types.add(roleProviderType('planning'));
      types.add(roleProviderType('coding'));
    } else {
      types.add(defaultModeProviderType);
    }
    return types;
  })();

  // Editable custom providers must carry a non-empty name. Hidden provider
  // fields must not prevent saving the settings that remain available.
  const providerDisplayName = (p) => {
    if (p.type === 'openai-compatible') return (p.name || '').trim() || 'OpenAI-compatible';
    return typeLabels[p.type] || p.type;
  };
  const missingCustomNames = PLATFORM_UI && providers.some(
    (p) => p.type === 'openai-compatible' && !(p.name || '').trim(),
  );

  const updateProviderField = (type, key, value) => {
    setLlmDirty(true);
    updateProviders(providers.map((p) => (p.type === type ? { ...p, [key]: value } : p)));
    // Sync provider card API keys to the individual settings so both
    // stay in sync. Without this, the providers JSON blob gets the new
    // key but the individual openai_api_key / anthropic_api_key /
    // minds_api_key setting stays stale.
    if (key === 'apiKey' && value !== '***') {
      const settingKey = providerTypeToKeyField(type);
      if (settingKey) setSetting(settingKey, value);
      const nextStatus = { ...(settings.providerStatus || {}) };
      const nextDetails = { ...(settings.providerStatusDetails || {}) };
      const nextReasons = { ...(settings.providerStatusReasons || {}) };
      delete nextStatus[type];
      delete nextDetails[type];
      delete nextReasons[type];
      setSettingProp('providerStatus', nextStatus);
      setSettingProp('providerStatusDetails', nextDetails);
      setSettingProp('providerStatusReasons', nextReasons);
    }
    if (key === 'baseUrl' && (type === 'openai-compatible' || type === 'gemini')) {
      setSetting('openaiBaseUrl', value);
    }
  };
  const addProviderOfType = (type) => {
    if (providers.some((p) => p.type === type)) return;
    setLlmDirty(true);
    updateProviders(providers.concat([makeEmptyProvider(type)]));
    setAddPickerOpen(false);
  };
  const removeProvider = (type) => {
    // MindsHub stays as a permanent option even when unconfigured —
    // it's the recommended path and users shouldn't be able to lose it.
    if (PROTECTED_PROVIDER_TYPES.has(type)) return;
    setLlmDirty(true);
    const next = providers.filter((p) => p.type !== type);
    // Clear the individual API key so backfillProviders doesn't re-add
    // this provider on the next settings fetch.
    const keyField = providerTypeToKeyField(type);
    if (keyField) setSetting(keyField, '');

    // Role settings referencing the removed provider get re-pointed at
    // MindsHub with NO model value — tombstoned (null → row cleared) so the
    // server's enabled-aware default governs every role. Writing any model
    // here fabricates a user choice: the raw pair used to pin haiku/kimi for
    // exactly the accounts that couldn't pay for them (ENG-1632), and an
    // "affordable" seed would strand a later top-up on the free model
    // (ENG-597 spring-back). The picker shows the server-computed value for
    // unset fields after the post-save refetch.
    const adjustedOverrides = {};
    for (const role of ['planning', 'coding', 'router']) {
      const o = roleOverride(role);
      if (roleProviderType(role) === type) {
        adjustedOverrides[role] = { providerType: 'minds-cloud', model: null };
        setRoleDriver(role, 'minds-cloud', null);
      } else {
        if (o) adjustedOverrides[role] = o;
      }
    }
    setSetting('modelOverrides', adjustedOverrides);
    updateProviders(next);
  };

  // Re-verify provider connectivity and persist the result. By default tests
  // only the providers driving the planning + coding roles (each role
  // contributes its driver — a custom override or the canonical role setting),
  // so a planning/coding split pings both. Pass an explicit list to test others
  // — the mount-time background verify passes every configured provider. The
  // server merges results into the persisted status map, so dots survive a
  // reload.
  const runProviderTests = async (targetProviders = null) => {
    if (!providerTestsAvailable) return null;
    const toTest = targetProviders || providers.filter((p) => activeProviderTypes.has(p.type));
    if (toTest.length === 0) return null;

    const result = await testProviders(toTest);
    if (result && result.providerStatus) {
      const current = settingsRef.current?.providerStatus || {};
      const next = { ...current, ...result.providerStatus };
      const changed = Object.keys(result.providerStatus).some((k) => current[k] !== result.providerStatus[k]);
      if (changed) setSettingProp('providerStatus', next);
    }
    if (result && result.providerStatusDetails) {
      const currentDetails = settingsRef.current?.providerStatusDetails || {};
      setSettingProp('providerStatusDetails', { ...currentDetails, ...result.providerStatusDetails });
    }
    /* Reasons are replaced per type, not merged: every type this result
       reports a status for loses its held reason first, then takes the new
       one if there is one. A spread merge would keep a stale "paused" after a
       re-test that failed for some other reason. A request that failed
       outright reports no status, so it leaves every held reason alone, as it
       does the statuses beside them.
       A sidecar that sends the reasons map has classified every type it
       reports, so a reported type with no entry is held as null: tested, and
       not a MindsHub refusal. A sidecar that predates the map sends no key,
       and its types are left with no entry, which keeps mindsProbeNotice on
       its legacy detail check for them. */
    if (result && result.providerStatus) {
      const reported = Object.keys(result.providerStatus);
      const held = settingsRef.current?.providerStatusReasons || {};
      const nextReasons = Object.fromEntries(Object.entries(held).filter(([type]) => !reported.includes(type)));
      const sent = result.providerStatusReasons;
      if (sent && typeof sent === 'object') {
        for (const type of reported) nextReasons[type] = sent[type] || null;
      }
      setSettingProp('providerStatusReasons', nextReasons);
    }
    return result;
  };

  // On first mount (once settings have loaded so providers is populated),
  // re-verify every configured provider in the background so the seeded
  // connected-from-credentials dots converge to real connectivity. Ref-guarded
  // to fire a single time per mount.
  const didMountVerify = useRef(false);
  useEffect(() => {
    if (didMountVerify.current) return;
    const configured = visibleProviders.filter(providerConfigured);
    if (configured.length === 0) {
      // Nothing to verify — the picker's warning reflects config, not a
      // pending network result, so let it show without waiting.
      setInitialProviderTestDone(true);
      return;
    }
    didMountVerify.current = true;
    runProviderTests(configured)
      .catch(() => { })
      .finally(() => setInitialProviderTestDone(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  // In default model mode the role provider/model fields are never edited
  // directly — only the custom-mode controls call setRoleDriver — so the
  // persisted planning/coding roles stay pinned to whatever they were last
  // set to (e.g. minds-cloud from sign-in) and the server keeps demanding
  // that provider's key. Mirror the dropped server-side _resolve_role: pin
  // both roles to the resolved default-mode provider and its recommended
  // pair so a configured key actually drives the agent. Only repoints a role
  // whose provider differs, so unrelated saves don't rewrite the model.
  // A role is repointed only when its own provider cannot run. The server
  // resolves a configured provider as-is, so rewriting one the user chose
  // deliberately -- a local endpoint, say -- moves their turns to a provider
  // they never picked, and does it on any save, including a theme toggle.
  const roleProviderUsable = (raw) => {
    const type = providerValueToType(raw) || 'minds-cloud';
    const card = providers.find((p) => p.type === type);
    return Boolean(card && providerConfigured(card));
  };

  const withResolvedRoles = (s) => {
    if (modelMode === 'custom') return s;
    const type = defaultModeProviderType;
    const next = { ...s };
    // Default mode means "the server decides the models" — so a repoint writes
    // NO model value for any role, planning included. Writing one claims a
    // user intent that doesn't exist: the row is indistinguishable from a real
    // pick, so the server honors it forever, which both pinned unaffordable
    // models on wallet-locked accounts (ENG-1632 — the write survived the save
    // diff exactly for them) and, seeded "affordably", would strand a
    // topped-up account on the free model (defeats ENG-597's spring-back).
    // Tombstone instead (null → DELETE in updateSettings): the server's
    // enabled-aware default governs, and GET /settings returns the computed
    // value for unset fields, so the picker displays exactly what runs.
    // The provider still repoints: keeping a stale model id from another
    // provider would misroute (pnewsam review on #663).
    if (!roleProviderUsable(s.planningProvider)
        && (providerValueToType(s.planningProvider) || 'minds-cloud') !== type) {
      next.planningProvider = type;
      next.planningModel = null;
      next.defaultModel = null;
    }
    if (!roleProviderUsable(s.codingProvider)
        && (providerValueToType(s.codingProvider) || 'minds-cloud') !== type) {
      next.codingProvider = type;
      next.codingModel = null;
    }
    if (!roleProviderUsable(s.routerProvider)
        && (providerValueToType(s.routerProvider) || 'minds-cloud') !== type) {
      next.routerProvider = type;
      next.routerModel = null;
    }
    return next;
  };

  const save = async () => {
    const shouldTestLlm = llmDirty || canRetestProviders;
    const submitted = draft.capture();
    const normalized = withResolvedRoles(clampBudgets(settings));
    const patch = clampBudgets(submitted.patch);
    // Role resolution can add tombstones/provider changes to the user's patch.
    // Keep unrelated committed settings and appearance previews out of the write.
    for (const [key, value] of Object.entries(normalized)) {
      if (JSON.stringify(value) !== JSON.stringify(settings[key])) patch[key] = value;
    }
    setTesting(true);
    resetTested();
    setSaveError(null);
    let result;
    try {
      result = await onSave(patch);
      if (!mountedRef.current) return;
      draft.acknowledge(submitted.entries);
      setSaved(true);
      if (Object.keys(draft.capture().patch).length === 0) {
        setLlmDirty(false);
        setEditingProviders(new Set());
      }
    } catch (err) {
      setSaveError(err.message || t('footer.errors.saveFailed'));
      setSaved(false);
      setTesting(false);
      return;
    }

    // Persistence and verification have separate outcomes. A failed check
    // cannot turn an accepted write into a rejected save or restore a draft.
    try {
      const validationResult = await validateSettings();
      setValidation(validationResult);
      if (shouldTestLlm) {
        const freshProviders = result?.settings?.providers || normalized.providers || providers;
        await runProviderTests(visibleProviderCards(normalized, freshProviders, PLATFORM_UI).filter(providerConfigured));
      }
      showTested({ autoHide: true });
    } catch (err) {
      setValidation({
        status: 'error',
        configReady: false,
        configError: t('footer.errors.verifyFailed', { error: err.message || t('footer.errors.checkFailed') }),
      });
      showTested();
    } finally {
      setTesting(false);
    }
  };

  const validate = async () => {
    if (testing) return;
    setTesting(true);
    resetTested();
    try {
      const [result] = await Promise.all([
        validateSettings(),
        runProviderTests(),
      ]);
      setValidation(result);
      showTested({ autoHide: true });
    } catch (err) {
      setValidation({
        status: 'error',
        configReady: false,
        configError: err.message || t('footer.errors.validateFailed'),
      });
    } finally {
      setTesting(false);
    }
  };

  const testButtonLabel = testing
    ? 'Testing…'
    : tested
      ? (<><span className="inline-flex mr-1.5 align-middle">{Ico.check(14)}</span>Tested</>)
      : 'Test';

  // ───────────────────────── Shared footer/banner helpers ─────────────────────────

  const renderSaveFooter = () => {
    const saveDisabled = (!settingsDirty && !canRetestProviders) || testing || missingCustomNames;
    const saveHint = missingCustomNames ? t('footer.hint.missingNames') : testing ? t('footer.hint.saving')
      : (!settingsDirty && !canRetestProviders) ? t('footer.hint.noChanges')
        : !providerTestsAvailable ? t('footer.hint.save')
          : canRetestProviders ? t('footer.hint.retest') : t('footer.hint.saveAndTest');
    return (
    <>
      <div
        role="status" aria-live="polite" aria-atomic="true"
        className="flex-1 text-[13px] font-medium text-ink-3 inline-flex items-center gap-1.5"
      >
        {testing && <span aria-hidden="true" className="spinner" style={{ width: 12, height: 12 }} />}
        {!testing && tested && configReady && <span aria-hidden="true" className="text-sage-500 inline-flex">{Ico.check(14)}</span>}
        {!testing && saved && !tested && <span aria-hidden="true" className="text-sage-500 inline-flex">{Ico.check(14)}</span>}
        <span>
          {saveError ? saveError : testing ? (providerTestsAvailable ? t('footer.status.testing') : t('footer.status.saving'))
            : tested ? (configReady
              ? (providerTestsAvailable ? t('footer.status.testPassed') : t('footer.status.saved'))
              : (configError || (providerTestsAvailable ? t('footer.status.testProblem') : t('footer.status.configProblem'))))
              : saved ? t('footer.status.saved')
                : configError ? configError
                  : t('footer.status.applyOnSave')}
        </span>
      </div>
      <Tooltip content={saveHint}>
        {/* Native title only while disabled: a disabled <button> fires no
            hover/focus events, so the styled Tooltip can't open — but the
            reason it's disabled is exactly what the user needs then. */}
        <Button
          variant="primary" onClick={save}
          disabled={saveDisabled}
          title={saveDisabled ? saveHint : undefined}
          className="w-[140px] inline-flex items-center justify-center gap-1.5"
          style={{ opacity: saveDisabled ? 0.55 : 1, cursor: saveDisabled ? 'default' : 'pointer' }}
        >
          {testing ? t('footer.button.saving') : (settingsDirty || canRetestProviders) ? t('footer.button.save') : <>{Ico.check(14)} {t('footer.button.saved')}</>}
        </Button>
      </Tooltip>
    </>
    );
  };

  // ───────────────────────── Section renderers ─────────────────────────

  const renderAgentSection = () => {
    const anyProviderConfigured = visibleProviders.some(providerConfigured);
    return (
      <SettingsSectionPanel footer={renderSaveFooter()}>
        <div className="flex flex-col">
          {/* Platform builds offer BYOK outside SaaS orgs, which use their managed provider. */}
          {PLATFORM_UI && !orgMode && <div className={anyProviderConfigured ? 'order-2' : 'order-none'}>
            <SettingsGroup title={t('providers.title')}>
              {visibleProviders.map((p) => {
                const configured = providerConfigured(p);
                const label = typeLabels[p.type] || p.type;
                const reveal = p.type === 'anthropic' ? 'anthropic'
                  : p.type === 'minds-cloud' ? 'minds'
                    : p.type === 'gemini' ? 'gemini'
                      : p.type === 'openai-compatible' ? 'openai-compatible'
                        : p.type === 'openai' ? 'openai'
                          : null;
                // Show the persisted/seeded status for any configured provider — a
                // configured provider reads as connected at startup, not just the one
                // currently driving a role. Unconfigured rows have nothing to show.
                const st = deriveProviderStatus(p.type, {
                  providerStatus: settings.providerStatus || {},
                  providerStatusDetails: settings.providerStatusDetails || {},
                  providerStatusReasons: settings.providerStatusReasons || {},
                  configured,
                  isSsoConnected: PLATFORM_UI && isSsoConnected,
                  testInProgress: providerTestsAvailable && testing,
                  initialTestDone: initialProviderTestDone,
                });
                const status = st.checking ? 'testing' : st.settled;
                const detail = configured ? st.detail : '';
                // The probe's reason names which MindsHub limit a 402/429 was,
                // which the detail string alone cannot.
                const neutralProbeError = (!PLATFORM_UI || !providerTestsAvailable) && p.type === 'minds-cloud'
                  && mindsProbeNotice({ detail, reason: configured ? st.reason : null })
                  ? t('providers.unavailable') : '';
                const friendlyError = neutralProbeError || friendlyProviderError(detail, configured ? st.reason : null);
                const statusBadge = providerStatusBadge(status, configured);
                const statusPillTitle = status === 'ok'
                  ? (!providerTestsAvailable && st.raw !== 'ok'
                    ? t('providers.statusTitle.signedIn')
                    : (detail ? t('providers.statusTitle.passedDetail', { detail }) : t('providers.statusTitle.passed')))
                  : status === 'fail' ? (detail ? t('providers.statusTitle.failedDetail', { detail }) : t('providers.statusTitle.failed'))
                    : status === 'testing' ? t('providers.statusTitle.testing')
                      : providerTestsAvailable ? t('providers.statusTitle.notTested')
                        : t('providers.statusTitle.notTestedNoTests');
                const statusPill = statusBadge ? (
                  <Badge
                    title={statusPillTitle}
                    aria-label={statusPillTitle}
                    variant={statusBadge.variant}
                    size="md"
                    className={`shrink-0 tracking-[0.01em] ${status === 'testing' ? 'set-badge-pulse' : ''}`}
                    style={{
                      animation: status === 'testing' ? 'set-badge-pulse 1.4s ease-in-out infinite' : 'none',
                    }}
                  >{statusBadge.label}</Badge>
                ) : null;
                // Each provider row is a sub-section in the Providers group,
                // so every row gets an <h3> for SR heading navigation. Known
                // types render the label visibly; the openai-compatible row
                // already shows an editable name input as its title, so the
                // <h3> uses the `.sr-only` utility (its text is the current
                // name or a sensible fallback) — keeps the visual unchanged
                // while making the row reachable by H/4 navigation.
                const headingBaseClass =
                  'm-0 p-0 leading-[1.3] text-base font-semibold text-ink';
                const customHeadingText = p.type === 'openai-compatible'
                  ? ((p.name || '').trim() || t('providers.customHeading'))
                  : null;
                const titleNode = (
                  <span className="inline-flex items-center flex-wrap gap-2">
                    {p.type === 'openai-compatible' ? (() => {
                      const nameEmpty = !(p.name || '').trim();
                      const errorId = `provider-name-error-${p.type}`;
                      return (
                        <div className="flex flex-col gap-[3px]">
                          <h3 className="sr-only">{customHeadingText}</h3>
                          <Input
                            value={p.name ?? ''}
                            onChange={(next) => updateProviderField('openai-compatible', 'name', next)}
                            placeholder={t('providers.customName.label')}
                            title={t('providers.customName.hint')}
                            aria-label={t('providers.customName.label')}
                            aria-invalid={nameEmpty || undefined}
                            aria-describedby={nameEmpty ? errorId : undefined}
                            aria-required="true"
                            style={{
                              width: 220, fontSize: 13.5, fontWeight: 600,
                              borderColor: nameEmpty ? 'color-mix(in srgb, var(--danger) 55%, transparent)' : undefined,
                            }}
                          />
                          {nameEmpty && (
                            <span id={errorId} className="text-[10.5px] text-danger">{t('providers.customName.required')}</span>
                          )}
                        </div>
                      );
                    })() : (
                      <h3 className={headingBaseClass}>{label}</h3>
                    )}
                  </span>
                );
                // Show the key input when: unconfigured, never tested, or user clicked Edit.
                // Otherwise the middle column shows the status pill and an Edit button appears.
                const ssoMindsHub = PLATFORM_UI && p.type === 'minds-cloud' && isSsoConnected;
                // Keep a stale failed provider in badge mode while its fresh test is
                // pending; otherwise the testing badge is replaced by the masked key.
                const showKeyInput = ssoMindsHub || !configured || st.settled === 'untested'
                  || (st.settled === 'fail' && !st.checking) || editingProviders.has(p.type);
                return (
                  <div key={p.type} className={`settings-provider-row py-4 items-start ${mobile
                    // Desktop: name | key/status | actions in a 3-col grid.
                    // Mobile: a compact left-aligned column — the grid stacked
                    // but kept the status pill + a 30px-wide button column
                    // right-aligned, floating them into a lot of dead space.
                    ? 'flex flex-col gap-2.5'
                    : 'grid grid-cols-[1fr_380px_auto] gap-6'}`}>
                    {/* Left: name + description */}
                    <div>
                      {titleNode}
                      {PROVIDER_TYPE_DESC[p.type] && (PLATFORM_UI || p.type !== 'minds-cloud') && (
                        <div className="text-[12px] text-ink-3 mt-1.5 max-w-[380px] leading-[1.45]">
                          {t(PROVIDER_TYPE_DESC[p.type])}
                        </div>
                      )}
                    </div>

                    {/* Middle: status pill (tested) OR key input (editing / untested) */}
                    {showKeyInput ? (
                      <div className="grid gap-1.5">
                        {ssoMindsHub ? (
                          <div className={`flex items-center py-[5px] px-0 ${mobile ? 'justify-start' : 'justify-end'}`}>
                            {statusPill}
                          </div>
                        ) : (
                          <ApiKeyInput
                            value={p.apiKey ?? ''}
                            onChange={(v) => updateProviderField(p.type, 'apiKey', v)}
                            placeholder={
                              p.type === 'anthropic' ? 'sk-ant-••••••••' :
                                p.type === 'minds-cloud' ? 'mdb_••••••••' :
                                  p.type === 'gemini' ? 'AIza••••••••' :
                                    'sk-••••••••'
                            }
                            revealName={reveal}
                          />
                        )}
                        {p.type === 'openai-compatible' && (
                          <ClearableTextInput
                            value={p.baseUrl ?? ''}
                            onChange={(v) => updateProviderField('openai-compatible', 'baseUrl', v)}
                            placeholder="https://example.com/v1"
                            ariaLabel={t('providers.baseUrl')}
                          />
                        )}
                        {GET_KEY_URL[p.type] && !ssoMindsHub && (PLATFORM_UI || p.type !== 'minds-cloud') && (
                          <div className="text-[11.5px] text-ink-3">
                            {withLink(t('providers.getKey', { link: LINK_TOKEN }), (
                              <Tooltip content={t('providers.openInBrowser', { url: GET_KEY_URL[p.type].replace(/^https?:\/\//, '') })}>
                                <a
                                  href={GET_KEY_URL[p.type]}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="text-accent"
                                >{GET_KEY_URL[p.type].replace(/^https?:\/\//, '')} →</a>
                              </Tooltip>
                            ))}
                          </div>
                        )}
                        {PLATFORM_UI && p.type === 'minds-cloud' && !isSsoConnected && (
                          <div className="text-[11.5px] text-ink-3">
                            {t('providers.noAccount')}{' '}
                            <Tooltip content={t('providers.signUpTooltip')}>
                              <a
                                href={MINDS_REGISTER_URL}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-accent"
                              >{t('providers.signUp')}</a>
                            </Tooltip>
                          </div>
                        )}
                        {status === 'fail' && friendlyError && (
                          <div className="text-[11.5px] text-danger flex items-start gap-1.5">
                            <span className="shrink-0 mt-px">{Ico.key ? Ico.key(12) : '!'}</span>
                            <span>{friendlyError}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      // Status pill replaces the key input after a test result
                      <div className={`flex items-center py-[5px] px-0 gap-2.5 ${mobile ? 'justify-start' : 'justify-end'}`}>
                        {status === 'fail' && friendlyError && (
                          <span className="text-[11.5px] text-danger">{friendlyError}</span>
                        )}
                        {statusPill}
                      </div>
                    )}

                    {/* Right (desktop) / inline row (mobile): trash + edit */}
                    <div className={`flex gap-1.5 ${mobile ? 'flex-row w-auto' : 'flex-col w-[30px]'}`}>
                      {!PROTECTED_PROVIDER_TYPES.has(p.type) && (
                        <Tooltip content={t('providers.remove')}>
                          <Button
                            variant="danger"
                            icon
                            size="sm"
                            onClick={() => removeProvider(p.type)}
                            aria-label={t('providers.remove')}
                          >{Ico.trash(14)}</Button>
                        </Tooltip>
                      )}
                      {!showKeyInput && (
                        <Tooltip content={t('providers.editKey')}>
                          <Button
                            icon
                            size="sm"
                            onClick={() => setEditingProviders((prev) => new Set([...prev, p.type]))}
                            aria-label={t('providers.editKey')}
                          >{Ico.edit(14)}</Button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="relative pt-[14px] px-0 pb-1 min-h-[50px]">
                {/* Idle: + Add provider button. Fades + slides down when
              the picker opens. */}
                <Tooltip content={availableTypesForAdd.length === 0 ? t('providers.allConfigured') : t('providers.addAnother')}>
                  <Button
                    variant="subtle"
                    onClick={() => setAddPickerOpen(true)}
                    disabled={availableTypesForAdd.length === 0}
                    title={availableTypesForAdd.length === 0 ? t('providers.allConfigured') : undefined}
                    className="absolute top-[14px] left-0 inline-flex items-center gap-1.5 [transition:opacity_var(--dur-layout)_ease,transform_var(--dur-layout)_ease]"
                    style={{
                      opacity: addPickerOpen ? 0 : (availableTypesForAdd.length === 0 ? 0.45 : 1),
                      transform: addPickerOpen ? 'translateY(6px)' : 'translateY(0)',
                      pointerEvents: addPickerOpen ? 'none' : (availableTypesForAdd.length === 0 ? 'none' : 'auto'),
                      cursor: availableTypesForAdd.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >{Ico.plus(14)} {t('providers.add')}</Button>
                </Tooltip>

                {/* Open: Choose Provider: <chip> <chip> · Cancel.
              Fades + slides up from below as it appears. */}
                <div
                  className="flex flex-wrap gap-1.5 items-center absolute top-[14px] left-0 right-0 [transition:opacity_var(--dur-layout)_ease,transform_var(--dur-layout)_ease]"
                  style={{
                    opacity: addPickerOpen ? 1 : 0,
                    transform: addPickerOpen ? 'translateY(0)' : 'translateY(-6px)',
                    pointerEvents: addPickerOpen ? 'auto' : 'none',
                  }}>
                  <strong className="text-sm text-ink mr-1">{t('providers.choose')}</strong>
                  {availableTypesForAdd.map((type) => (
                    <Tooltip key={type} content={t(PROVIDER_TYPE_DESC[type])}>
                      <Button
                        variant="subtle"
                        onClick={() => addProviderOfType(type)}
                        style={{ fontSize: 12.5, padding: '4px 10px', fontWeight: 400 }}
                      >{typeLabels[type] || type}</Button>
                    </Tooltip>
                  ))}
                  <Tooltip content={t('providers.hidePicker')}>
                    <Button
                      variant="subtle"
                      icon
                      size="sm"
                      onClick={() => setAddPickerOpen(false)}
                      aria-label={t('providers.closePicker')}
                      className="ml-1"
                    >{Ico.close(14)}</Button>
                  </Tooltip>
                </div>
              </div>
            </SettingsGroup>
          </div>}
          {PLATFORM_UI && <div className={anyProviderConfigured ? 'order-1' : 'order-none'}>
            <SettingsGroup title={t('agent.modelRouter')}>
              {(() => {
                // The default-mode provider is the implicit fallback for
                // any role that hasn't been explicitly assigned an
                // override (keyed MindsHub, else first configured).
                const defaultProvider =
                  visibleProviders.find((p) => p.type === defaultModeProviderType) ||
                  visibleProviders[0];
                const multipleProviders = visibleProviders.length > 1;

                // For each role: render provider selector (when N>1) +
                // model field. When the user picks a new provider, auto-
                // fill the role with that provider's recommended default
                // for the role. Empty overrides fall back to the default
                // provider's recommended pair.
                const RoleRow = ({ role, label }) => {
                  // Resolve the effective provider for this role. The server may
                  // store a stale planning_provider (e.g. 'anthropic') that doesn't
                  // match any configured provider card. When that happens, fall back
                  // to defaultModeProviderType (which prefers the actually-configured
                  // provider — MindsHub if available, else first configured).
                  const rawType = roleProviderType(role) || (defaultProvider?.type || '');
                  const rawProvider = visibleProviders.find((p) => p.type === rawType);
                  const curType = (rawProvider && providerConfigured(rawProvider))
                    ? rawType
                    : defaultModeProviderType;
                  const providerWasRepointed = curType !== rawType;
                  // Role slot in the per-provider default tuple
                  // [planning, coding, router]. Router falls back to the coding
                  // default when the backend hasn't sent a 3rd slot yet.
                  const roleIdx = role === 'planning' ? 0 : role === 'router' ? 2 : 1;
                  const fallbackPair = recommendedPair[curType] || ['', '', ''];
                  const fallbackModel = fallbackPair[roleIdx] || fallbackPair[1] || '';
                  const provider = visibleProviders.find((p) => p.type === curType);
                  const modelList = recommendedModels[curType] || [];
                  // minds-cloud has no free-text mode (unlike a BYOK provider,
                  // where an unlisted id is just a user-typed custom model) —
                  // same condition resolveModelPickerValue uses for its
                  // "legacy — re-select a model" stale pin.
                  const allowOther = curType !== 'minds-cloud';
                  // See resolveRoleModel: substitutes the fallback not just
                  // when the PROVIDER field was stale, but also when the
                  // provider is already correct (e.g. after an SSO sign-in)
                  // yet the paired model still names a different provider's
                  // model — the case that used to surface as "legacy —
                  // re-select a model" for the user to fix by hand.
                  const curModel = resolveRoleModel(
                    providerWasRepointed, roleModelValue(role, fallbackModel), modelList, allowOther, fallbackModel,
                  );
                  /* Per-model availability (settings.modelEnabled, sourced from MindsHub
                   * /v1/models). A model the org's wallet can't currently pay for, or
                   * whose free allowance is spent, is listed here as false. Such a row
                   * renders disabled with a "Needs credits" tag, and the hint below
                   * says how to unlock it. An absent id counts as available (direct
                   * providers have no such flag at all). */
                  const modelEnabled = settings.modelEnabled || {};
                  const isLocked = (m) => isModelLocked(modelEnabled, m);
                  const firstEnabledModel = modelList.find((m) => !isLocked(m)) || modelList[0] || '';
                  const st = deriveProviderStatus(curType, {
                    providerStatus: settings.providerStatus || {},
                    providerStatusDetails: settings.providerStatusDetails || {},
                    providerStatusReasons: settings.providerStatusReasons || {},
                    configured: !!(provider && providerConfigured(provider)),
                    isSsoConnected: PLATFORM_UI && isSsoConnected,
                    testInProgress: providerTestsAvailable && testing,
                    initialTestDone: initialProviderTestDone,
                  });
                  const providerUnconfigured = !!curType && st.unconfigured;
                  const providerFailed = st.failed;
                  // Which MindsHub refusal the last probe hit, from the
                  // sidecar's reason, or the legacy detail check when an older
                  // sidecar sends no reasons map (see mindsProbeNotice).
                  const probeNotice = providerFailed && !st.checking && curType === 'minds-cloud'
                    ? mindsProbeNotice({ reason: st.reason, detail: st.detail })
                    : null;
                  const providerUnusable = (providerUnconfigured || providerFailed) && !probeNotice && !st.checking;
                  const providerCheckingNotice = st.checking;
                  const providerWarnId = `agent-model-${role}-provider`;

                  // Reasoning effort — folded into the Model picker itself now
                  // (ENG-1940, ModelSelect's footer row), only for models that
                  // advertise effort levels (settings.modelEfforts, sourced from
                  // MindsHub /v1/models + the static direct-provider catalog).
                  // Router has no reasoning-effort knob — it's a single cheap
                  // gating call, not a reasoning role. `effortEntry`/`effortOptions`/
                  // `effortValue` still get derived here (ModelSelect needs
                  // `effortValue` as its `effort` prop, and `writeOverride` below
                  // still needs `effortKey` to drop a stale level on model change).
                  const effortKey = role === 'planning' ? 'planningReasoningEffort'
                    : role === 'coding' ? 'codingReasoningEffort'
                    : null;
                  const effortEntry = (settings.modelEfforts || {})[curModel];
                  const effortOptions = effortEntry?.efforts || [];
                  const savedEffort = effortKey ? settings[effortKey] : '';
                  const effortValue = effortOptions.includes(savedEffort)
                    ? savedEffort
                    : (effortEntry?.default || effortOptions[0] || '');

                  const writeOverride = (next) => {
                    const providerType = providerValueToType(next.providerType || curType) || 'minds-cloud';
                    const model = next.model || '';
                    const normalized = { providerType, model };
                    setLlmDirty(true);
                    setRoleDriver(role, providerType, model);
                    setSetting('modelOverrides', { ...overrides, [role]: normalized });
                    setSetting('modelMode', 'custom');
                    // Effort is model-specific — drop any stale level so we never
                    // send an effort the newly-selected model doesn't accept.
                    if (effortKey) setSetting(effortKey, '');
                  };

                  // Plain bold field label. Note: no dotted underline — that reads as
                  // a "hover for a tooltip" affordance, and none is wired here.
                  const fieldLabel = (text) => (
                    <span className="text-xs font-bold text-ink tracking-[0.02em]">{text}</span>
                  );

                  const probeNoticeNode = probeNotice ? (
                    <MindsProbeNotice notice={probeNotice} usage={hubUsage} isBillingOwner={isBillingOwner} providerTestsAvailable={providerTestsAvailable} />
                  ) : null;

                  const subtitle = role === 'planning'
                    ? t('agent.roles.planningSubtitle')
                    : role === 'coding'
                      ? t('agent.roles.codingSubtitle')
                      // The server says which model gates (ENG-1851); see routerRoleSubtitle.
                      : routerRoleSubtitle(settings.gate, {
                        rowProviderType: curType,
                        providerTypeLabels: settings.providerTypeLabels || {},
                      });

                  return (
                    <Section title={label} subtitle={subtitle} notice={probeNoticeNode}>
                      <div className="grid gap-1.5">
                        {multipleProviders && (
                          <label className="grid gap-1">
                            {fieldLabel(t('agent.providerLabel'))}
                            <Select
                              value={curType}
                              onValueChange={(type) => {
                                // Seed the first wallet-affordable candidate,
                                // not the raw pair value: writing a locked
                                // model on a provider switch converts the
                                // server's dynamic default into a hard pin
                                // that 402s (ENG-1632). This is the ONE place
                                // the client still derives a model — allowed
                                // because it's custom mode and the value lands
                                // visibly in the model field for the user to
                                // see and change before saving (ENG-1248's
                                // informed-consent lane). ENG-1650 (server
                                // exposes resolved per-role models) retires
                                // this derivation too.
                                const pair = recommendedPair[type] || ['', '', ''];
                                const candidates = [
                                  pair[roleIdx] || pair[1],
                                  ...(recommendedModels[type] || []),
                                ].filter(Boolean);
                                const newModel =
                                  candidates.find((m) => !isModelLocked(modelEnabled, m))
                                  || candidates[0] || '';
                                setModelInputMode((m) => ({ ...m, [role]: false }));
                                writeOverride({ providerType: type, model: newModel });
                              }}
                              invalid={providerUnusable}
                              aria-describedby={(providerUnusable || providerCheckingNotice) ? providerWarnId : undefined}
                              title={t('agent.providerHint', { role })}
                              options={visibleProviders.map((p) => ({ value: p.type, label: providerDisplayName(p) }))}
                            />
                          </label>
                        )}
                        {modelList.length > 0 ? (
                          (() => {
                            // allowOther is hoisted above (also feeds curModel's
                            // staleness check). See resolveModelPickerValue +
                            // buildModelOptions: keeps the Select's
                            // value matched to a rendered option so picking a model always fires
                            // a real change and Save writes it — a login-written `latest:` pin no
                            // longer wedges the control into a no-op "Saved" (ENG-739).
                            const { showStalePin, inputMode, selectValue } =
                              resolveModelPickerValue(curModel, modelList, allowOther, modelInputMode[role]);
                            // The trailing bag carries MindsHub's authoritative
                            // maker field (so the picker's sections stop being
                            // inferred from the alias) plus the family metadata
                            // that tags the moving aliases "latest".
                            const modelOptions = buildModelOptions(
                              curModel, modelList, allowOther, showStalePin, modelEnabled,
                              settings.modelLabels || {},
                              {
                                modelProviders: settings.modelProviders,
                                modelFamilies: settings.modelFamilies,
                                modelDisabledReasons: settings.modelDisabledReasons,
                              },
                            );
                            return (
                              <>
                              <label className="grid gap-1">
                                {fieldLabel(t('agent.modelLabel'))}
                                <ModelSelect
                                  value={selectValue || firstEnabledModel}
                                  onValueChange={(next) => {
                                    if (next === '__custom__') {
                                      setModelInputMode((m) => ({ ...m, [role]: true }));
                                      writeOverride({ providerType: curType, model: curModel || '' });
                                    } else {
                                      setModelInputMode((m) => ({ ...m, [role]: false }));
                                      writeOverride({ providerType: curType, model: next });
                                    }
                                  }}
                                  onOpenChange={(isOpen) => {
                                    // Opening re-checks the wallet, so a top-up made in an
                                    // external tab unlocks its models here without an app restart.
                                    // The popup opens immediately on the list we already hold and
                                    // reconciles in place when the response lands, rather than
                                    // withholding itself until then: the trigger is a click target,
                                    // and a click that produces nothing for the length of a network
                                    // round trip reads as a broken control. Briefly showing a
                                    // model as locked that a top-up has just unlocked is safe —
                                    // this list is an affordance, not the authority. Auth decides
                                    // at request time, so a stale row can mislead for a moment but
                                    // can never let a turn through that shouldn't run.
                                    if (!isOpen) return;
                                    const openState = modelOpenFor(role);
                                    if (modelRefreshing[role]) return;
                                    // Don't re-pay the round trip for a re-open moments later.
                                    if (performance.now() - openState.refreshedAt < MODEL_REFRESH_TTL_MS) return;
                                    setModelRefreshing((m) => ({ ...m, [role]: true }));
                                    fetchRecommendedModels({ refresh: true }).then((data) => {
                                      // Same merge rule as the mount-time load: an empty list or
                                      // map in the response leaves what we have alone. The
                                      // endpoint answers 200 with empty buckets when the MindsHub
                                      // fetch itself failed, and assigning those straight through
                                      // would empty the dropdown the user just clicked (for every
                                      // role — the keys are shared) until the app restarts.
                                      // keepOrder: the dropdown is open on the list we hold
                                      // when this lands; a reordered list jumps under the cursor.
                                      const merged = mergeRecommendedModels(settings, data, { keepOrder: true });
                                      if (!merged) return;
                                      for (const [key, value] of Object.entries(merged)) setSettingProp(key, value);
                                      openState.refreshedAt = performance.now();
                                    }).catch(() => { }).finally(() => {
                                      setModelRefreshing((m) => ({ ...m, [role]: false }));
                                    });
                                  }}
                                  loading={modelRefreshing[role]}
                                  title={t('agent.modelHint', { role })}
                                  options={modelOptions}
                                  // Reasoning-effort footer (ENG-1940) — folded into
                                  // this same picker (see ModelSelect.jsx), replacing
                                  // the separate "Reasoning effort" <Select> that used
                                  // to sit below. Gated behind `effortKey` so Router
                                  // (which has none) never opts into the feature at
                                  // all — it never showed an effort control before
                                  // either, and passing `onEffortChange` through to a
                                  // null `effortKey` would be a `setSetting(null, …)`.
                                  modelEfforts={effortKey ? settings.modelEfforts : undefined}
                                  effort={effortValue}
                                  onEffortChange={(v) => { setLlmDirty(true); setSetting(effortKey, v); }}
                                />
                                {inputMode && allowOther && (
                                  <TextInput
                                    value={curModel}
                                    onChange={(v) => writeOverride({ providerType: curType, model: v })}
                                    placeholder={t('agent.customModelPlaceholder')}
                                    title={t('agent.customModelHint')}
                                  />
                                )}
                              </label>
                              {/* It covers only the CURRENT model: a locked row
                                  the user is merely looking at carries its own
                                  "Add credits" button, and a restricted row its
                                  own tooltip. Outside the <label> so it doesn't
                                  leak into the combobox's accessible name. */}
                              {!inputMode && !!curModel && isLocked(curModel) && (
                                <UnavailableModelHint
                                  label={displayModelLabel(curModel, settings.modelLabels || {})}
                                  restricted={isModelRestricted(modelEnabled, settings.modelDisabledReasons, curModel)}
                                  budgetReached={isModelBudgetReached(modelEnabled, settings.modelDisabledReasons, curModel)}
                                />
                              )}
                            </>);
                          })()
                        ) : (
                          <label className="grid gap-1">
                            {fieldLabel(t('agent.modelLabel'))}
                            <TextInput
                              value={curModel}
                              onChange={(v) => writeOverride({ providerType: curType, model: v })}
                              placeholder="model-id"
                              title={t('agent.modelIdHint')}
                            />
                          </label>
                        )}
                        {providerCheckingNotice && (
                          <div id={providerWarnId} aria-live="polite" className="text-[11.5px] text-ink-3 flex items-center gap-1.5">
                            <Spinner intervalMs={90} />
                            {t('agent.checking', { provider: providerDisplayName(provider) })}
                          </div>
                        )}
                        {providerUnusable && (
                          <div id={providerWarnId} className="text-[11.5px] text-warning">
                            {providerUnconfigured
                              ? (provider
                                ? t('agent.notConfigured', { provider: providerDisplayName(provider) })
                                : t('agent.unknownNotConfigured'))
                              : t('agent.failed', { provider: providerDisplayName(provider) })}
                          </div>
                        )}
                      </div>
                    </Section>
                  );
                };
                return (
                  <>
                    {RoleRow({ role: 'planning', label: t('agent.roles.planning') })}
                    {/* Hidden once the server routes with a decision model:
                        see showRouterRoleRow for when it stays. */}
                    {showRouterRoleRow(settings.routing, settings.gate)
                      && RoleRow({ role: 'router', label: t('agent.roles.router') })}
                    {RoleRow({ role: 'coding', label: t('agent.roles.coding') })}
                  </>
                );
              })()}
            </SettingsGroup>
          </div>}
        </div>

        <SettingsGroup title={t('memory.title')}>
          <Section title={t('memory.mode.title')} subtitle={t('memory.mode.subtitle', { agent: agentLabel || 'Anton' })}>
            <ToggleGroup
              value={settings.memoryMode ?? 'autopilot'}
              onValueChange={(v) => setSetting('memoryMode', v)}
              aria-label={t('memory.mode.ariaLabel')}
              options={[
                { value: 'autopilot', label: t('memory.mode.autopilot'), title: t('memory.mode.autopilotHint', { agent: agentLabel || 'Anton' }) },
                { value: 'copilot', label: t('memory.mode.copilot'), title: t('memory.mode.copilotHint', { agent: agentLabel || 'Anton' }) },
                { value: 'off', label: t('memory.mode.off'), title: t('memory.mode.offHint') },
              ]}
            />
          </Section>
          <Section title={t('memory.episodic.title')} subtitle={t('memory.episodic.subtitle')}>
            <Switch
              checked={settings.episodicMemory ?? true}
              onCheckedChange={(v) => setSetting('episodicMemory', v)}
              aria-label={t('memory.episodic.title')}
            />
          </Section>
          <Section title={t('memory.dashboards.title')} subtitle={t('memory.dashboards.subtitle')}>
            <Switch
              checked={settings.proactiveDashboards ?? false}
              onCheckedChange={(v) => setSetting('proactiveDashboards', v)}
              aria-label={t('memory.dashboards.title')}
            />
          </Section>
          <Section title={t('memory.actFirst.title')} subtitle={t('memory.actFirst.subtitle')}>
            <Switch
              checked={settings.actFirst ?? true}
              onCheckedChange={(v) => setSetting('actFirst', v)}
              aria-label={t('memory.actFirst.title')}
            />
          </Section>
        </SettingsGroup>

        <BrowserSettingsSection settings={settings} setSetting={setSetting} agentLabel={agentLabel || 'Anton'} signedInToMindsHub={PLATFORM_UI && isSsoConnected} />

        {/* Not on hosted web yet: its turns run in a pod that doesn't receive
            these limits until the web time limit and the PR that sends them
            ship, so the switch and values here would not be what a hosted web
            turn runs under. Self-hosted web runs turns in its own server, where
            they apply. The Jev switch has no such limit, so it keeps the group. */}
        {(budgetRowsShown || jevSwitchShown) && (
          <SettingsGroup title={t('advanced.title')} collapsible defaultCollapsed>
            {budgetRowsShown && <>
            {hasLimitsSwitch && (
              <Section
                title={t('advanced.limits.title')}
                subtitle={limitsOn
                  ? t('advanced.limits.subtitleOn', { agent: agentLabel || 'Anton' })
                  : t('advanced.limits.subtitleOff', { agent: agentLabel || 'Anton' })}
              >
                <Switch
                  checked={limitsOn}
                  onCheckedChange={(v) => setSetting('limitsEnabled', v)}
                  aria-label={t('advanced.limits.title')}
                />
              </Section>
            )}
            <Section
              title={t('advanced.maxSteps.title')}
              subtitle={t('advanced.maxSteps.subtitle', { agent: agentLabel || 'Anton' })}
            >
              <BudgetNumberField
                settingKey="maxToolRounds"
                lockedValue={safetyLimit('maxToolRounds')}
                value={settings.maxToolRounds}
                savedValue={lastSavedSettings?.maxToolRounds}
                spec={budgetSpec('maxToolRounds', settings.budgetDefaults)}
                label={t('advanced.maxSteps.title')}
                setSetting={setSetting}
              />
            </Section>
            <Section
              title={t('advanced.maxContinuations.title')}
              subtitle={t('advanced.maxContinuations.subtitle', { agent: agentLabel || 'Anton' })}
            >
              <BudgetNumberField
                settingKey="maxContinuations"
                lockedValue={safetyLimit('maxContinuations')}
                value={settings.maxContinuations}
                savedValue={lastSavedSettings?.maxContinuations}
                spec={budgetSpec('maxContinuations', settings.budgetDefaults)}
                label={t('advanced.maxContinuations.title')}
                setSetting={setSetting}
              />
            </Section>
            {/* Gated on its OWN key, not folded into `hasBudgetSettings`.
                This setting reaches the server one release after the other two,
                so requiring it in that gate would hide the whole group — and
                the two working fields with it — on every server that predates
                it. The renderer ships OTA and leads the installed server. */}
            {'maxTurnTokens' in settings && (
              <Section
                title={t('advanced.maxTokens.title')}
                subtitle={t('advanced.maxTokens.subtitle', { agent: agentLabel || 'Anton' })}
              >
                <BudgetNumberField
                  settingKey="maxTurnTokens"
                  lockedValue={safetyLimit('maxTurnTokens')}
                  value={settings.maxTurnTokens}
                  savedValue={lastSavedSettings?.maxTurnTokens}
                  spec={budgetSpec('maxTurnTokens', settings.budgetDefaults)}
                  label={t('advanced.maxTokens.title')}
                  setSetting={setSetting}
                  unlimitedLabel={t('advanced.maxTokens.noLimit')}
                />
              </Section>
            )}
            </>}
            {/* An org-level setting, like the budgets: who may change it is
                the server's call. Its own condition, so a server without the
                budget rows still shows it. */}
            {jevSwitchShown && (
              <Section
                title={t('advanced.jev.title')}
                subtitle={t('advanced.jev.subtitle', { agent: agentLabel || 'Anton' })}
              >
                <Switch
                  checked={settings.jevDecisionsEnabled ?? true}
                  onCheckedChange={(v) => setSetting('jevDecisionsEnabled', v)}
                  aria-label={t('advanced.jev.title')}
                />
              </Section>
            )}
          </SettingsGroup>
        )}
      </SettingsSectionPanel>
    );
  };

  // Appearance auto-save — every control on this page persists on its own,
  // debounced for text/color inputs so typing doesn't fire a write per
  // keystroke. Per-key status (saving/saved/error) gives the user direct
  // feedback instead of relying on the page-wide Save button, which these
  // fields no longer participate in — there's no Save button on this page
  // at all (see AutoSaveTag and renderAppearanceSection).
  const [autoSaveStatus, setAutoSaveStatus] = useState({});
  const autoSaveTimersRef = useRef({});
  const pendingAutoSavesRef = useRef({});
  const autoSaveFadeTimersRef = useRef({});
  const autoSaveRemoveTimersRef = useRef({});

  const AUTO_SAVE_HOLD_MS = 1400; // how long "Saved" stays at full opacity
  const AUTO_SAVE_FADE_MS = 500;  // opacity transition duration (matches the inline style below)

  const autoSaveSetting = (key, value, { debounceMs = 0 } = {}) => {
    if (!mountedRef.current) return;
    const submitted = setSetting(key, value, { autoSave: true });
    onAppearancePreview?.(key, value);
    clearTimeout(autoSaveTimersRef.current[key]);
    delete pendingAutoSavesRef.current[key];
    clearTimeout(autoSaveFadeTimersRef.current[key]);
    clearTimeout(autoSaveRemoveTimersRef.current[key]);

    const commit = async () => {
      delete pendingAutoSavesRef.current[key];
      if (mountedRef.current) {
        setAutoSaveStatus((prev) => ({ ...prev, [key]: { state: 'saving', fading: false } }));
      }
      try {
        await onSave({ [key]: value });
        if (!mountedRef.current) return;
        const cleared = draft.acknowledge({ [key]: submitted });
        if (!cleared.includes(key)) return;
        onAppearancePreview?.(key, undefined);
        setAutoSaveStatus((prev) => ({ ...prev, [key]: { state: 'saved', fading: false } }));
        // Hold at full opacity, then fade out, then unmount — a plain status
        // message, not a button, and it disappears on its own.
        autoSaveFadeTimersRef.current[key] = setTimeout(() => {
          setAutoSaveStatus((prev) => (
            prev[key]?.state === 'saved' ? { ...prev, [key]: { state: 'saved', fading: true } } : prev
          ));
          autoSaveRemoveTimersRef.current[key] = setTimeout(() => {
            setAutoSaveStatus((prev) => {
              const { [key]: _drop, ...rest } = prev;
              return rest;
            });
          }, AUTO_SAVE_FADE_MS);
        }, AUTO_SAVE_HOLD_MS);
      } catch (err) {
        if (!mountedRef.current || !draft.isCurrent(key, submitted)) return;
        // Errors don't auto-fade — they stay until the next attempt so a
        // failed save can't go unnoticed.
        setAutoSaveStatus((prev) => ({ ...prev, [key]: { state: 'error', fading: false } }));
        diagnostic("renderer.cowork.views.settings.SettingsView", "WARNING", "auto_save_failed_for", `Auto-save failed for ${key}:`, err);
      }
    };

    if (debounceMs > 0) {
      pendingAutoSavesRef.current[key] = commit;
      autoSaveTimersRef.current[key] = setTimeout(commit, debounceMs);
    } else {
      commit();
    }
  };

  useEffect(() => () => {
    onAppearancePreview?.(null);
    Object.values(autoSaveTimersRef.current).forEach(clearTimeout);
    // Appearance promises automatic persistence, including when closed mid-debounce.
    Object.values(pendingAutoSavesRef.current).forEach((commit) => { commit(); });
    Object.values(autoSaveFadeTimersRef.current).forEach(clearTimeout);
    Object.values(autoSaveRemoveTimersRef.current).forEach(clearTimeout);
  }, []);

  function AutoSaveTag({ settingKey }) {
    const status = autoSaveStatus[settingKey];
    if (!status) return null;
    const fadeStyle = {
      opacity: status.fading ? 0 : 1,
      transition: `opacity ${AUTO_SAVE_FADE_MS}ms ease`,
    };
    if (status.state === 'saving') {
      return <span style={fadeStyle} className="text-[11.5px] text-ink-4 ml-2">{t('autoSave.saving')}</span>;
    }
    if (status.state === 'error') {
      return <span style={fadeStyle} className="text-[11.5px] text-danger ml-2">{t('autoSave.failed')}</span>;
    }
    return (
      <span style={fadeStyle} className="text-[11.5px] text-[var(--ok)] ml-2 inline-flex items-center gap-1">
        {Ico.check(12)} {t('autoSave.saved')}
      </span>
    );
  }

  // Sidebar logo upload — read as a data URI and save as the synced
  // `navLogo` setting (same pipeline as every other setting, e.g. greeting).
  // Capped well under a reasonable size for a settings-table text column.
  const logoInputRef = useRef(null);
  const MAX_LOGO_BYTES = 300 * 1024;
  const [logoError, setLogoError] = useState(null);
  const handleLogoUpload = (file) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(t('appearance.sidebarLogo.tooLarge'));
      return;
    }
    setLogoError(null);
    const reader = new FileReader();
    reader.onload = () => autoSaveSetting('navLogo', reader.result);
    reader.readAsDataURL(file);
  };

  const faviconInputRef = useRef(null);
  const faviconReadRef = useRef(null);
  const [faviconError, setFaviconError] = useState(null);
  useEffect(() => () => faviconReadRef.current?.abort(), []);
  const handleFaviconUpload = (file) => {
    if (!file) return;
    faviconReadRef.current?.abort();
    faviconReadRef.current = null;
    const mime = file.type || FAVICON_EXTENSION_TYPES[file.name.split('.').pop().toLowerCase()];
    if (!FAVICON_MIME_TYPES.includes(mime)) {
      setFaviconError(t('appearance.favicon.wrongType'));
      return;
    }
    if (file.size >= 100 * 1024) {
      setFaviconError(t('appearance.favicon.tooLarge'));
      return;
    }
    setFaviconError(null);
    const reader = new FileReader();
    faviconReadRef.current = reader;
    reader.onload = () => {
      if (faviconReadRef.current !== reader) return;
      if (typeof reader.result !== 'string') {
        setFaviconError(t('appearance.favicon.unreadable'));
        return;
      }
      autoSaveSetting('favicon', reader.result);
    };
    reader.onerror = () => {
      if (faviconReadRef.current === reader) setFaviconError(t('appearance.favicon.unreadable'));
    };
    try {
      reader.readAsDataURL(file.type ? file : file.slice(0, file.size, mime));
    } catch {
      setFaviconError(t('appearance.favicon.unreadable'));
    }
  };

  const renderCodingAgentSection = () => (
    <CodingAgentSettingsSection
      settings={settings}
      setSetting={setSetting}
      footer={renderSaveFooter()}
      available={codeModeAccess.available}
      enabled={codeModeAccess.enabled}
      onEnabledChange={codeModeAccess.setEnabled}
    />
  );

  const renderComputersSection = () => <ComputersSettingsSection />;

  // Settings → Appearance: Your style, then Display.
  //   Your style — the person's own style, theme and greeting, over the org's
  //     look. In a hosted org it shows only when they may choose (member
  //     choice on, or they are an admin). Outside hosted MindsHub it also
  //     holds their sidebar title, color, logo and tab icon; hosted MindsHub
  //     has none of those, since the org's are the ones shown.
  //   Display — personal display preferences, for everyone.
  // The org's own branding is its own page, Settings → Branding, for admins.
  //
  // No Save footer: every control here auto-saves itself (see
  // autoSaveSetting/AutoSaveTag). `autoSaved` surfaces a quiet "saves
  // automatically" note on mobile.
  const org = orgBranding?.enabled ? orgBranding : null;
  // With member choice off, nobody (admins included) has personal style
  // controls: the section says so, and points admins to Branding.
  // With member choice off, only the fields the org set are locked: each shows
  // a note instead of its controls, and the rest stay the member's to choose.
  // When every field is the org's, one message replaces them all.
  const personalStyleOff = Boolean(org && !org.appearance.membersCanChoose
    && (orgLocks.style || SKIN_LOCKED) && orgLocks.theme && orgLocks.greeting);
  // A field the org set shows nothing; one line under the open controls says why.
  const orgSetsNote = () => null;
  const someLockedByOrg = Boolean(org && !org.appearance.membersCanChoose
    && (orgLocks.style || orgLocks.theme || orgLocks.greeting));
  const changeInBranding = org?.canEdit && onSectionChange ? (
    <>
      {' '}
      <button type="button" className={LINK_BTN} onClick={() => onSectionChange('branding')}>
        {t('appearance.yourStyle.changeInBranding')}
      </button>
    </>
  ) : null;
  // A deep link's part of Appearance, scrolled to once the page is showing.
  const appearanceShowing = shownSection === 'appearance';
  useEffect(() => {
    const id = appearanceAnchor && APPEARANCE_ANCHORS[appearanceAnchor];
    if (!id || !appearanceShowing) return;
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView?.({ block: 'start' });
      onAppearanceAnchorShown?.();
    }
  }, [appearanceAnchor, appearanceShowing, onAppearanceAnchorShown]);
  const renderAppearanceSection = () => (
    <SettingsSectionPanel autoSaved>
      <div id={APPEARANCE_ANCHORS.style} className="scroll-mt-2">
        <SettingsGroup
          title={org ? t('appearance.yourStyle.title') : t('appearance.style.title')}
          description={org && !personalStyleOff ? t('appearance.yourStyle.description') : null}
        >
        {personalStyleOff ? (
          <div className="py-3 text-sm text-ink-2" data-testid="personal-style-off">
            {t('appearance.yourStyle.off')}
            {changeInBranding}
          </div>
        ) : (
        <>
        {orgLocks.style ? orgSetsNote() : (
        <>
        {SKIN_LOCKED ? (
          <Section title={t('appearance.style.title')} subtitle={t('appearance.style.lockedSubtitle')}>
            <span className="text-sm text-ink-2">{skinLabel(DEFAULT_SKIN)}</span>
          </Section>
        ) : (
          <Section title={t('appearance.style.title')} subtitle={orgLocks.style ? t('appearance.setByOrg') : t('appearance.style.subtitle')}>
            <ToggleGroup
              value={normalizeSkin(skin)}
              onValueChange={(v) => onSkinChange?.(v)}
              disabled={orgLocks.style}
              aria-label={t('appearance.style.ariaLabel')}
              options={SKINS.map((s) => {
                // A deployment brand's own skin keeps its brand name.
                const label = t(`appearance.skins.${s.id}.label`, { defaultValue: s.label });
                return {
                  value: s.id,
                  label: s.icon && Ico[s.icon]
                    ? (<span className="inline-flex items-center gap-1.5">{Ico[s.icon](14)} {label}</span>)
                    : label,
                  'aria-label': t('appearance.style.optionAriaLabel', { name: label }),
                  title: t(`appearance.skins.${s.id}.title`, { defaultValue: s.title }),
                };
              })}
            />
          </Section>
        )}
        </>
        )}
        {orgLocks.theme ? orgSetsNote() : (
        <Section title={t('appearance.theme.title')} subtitle={orgLocks.theme ? t('appearance.setByOrg') : t('appearance.theme.subtitle')}>
          <ToggleGroup
            value={theme || 'dark'}
            onValueChange={(v) => onThemeChange?.(v)}
            disabled={orgLocks.theme}
            aria-label={t('appearance.theme.ariaLabel')}
            options={[
              {
                value: 'light',
                label: (<span className="inline-flex items-center gap-1.5">{Ico.sun(14)} {t('appearance.theme.light')}</span>),
                'aria-label': t('appearance.theme.lightAriaLabel'),
                title: t('appearance.theme.lightHint'),
              },
              {
                value: 'dark',
                label: (<span className="inline-flex items-center gap-1.5">{Ico.moon(14)} {t('appearance.theme.dark')}</span>),
                'aria-label': t('appearance.theme.darkAriaLabel'),
                title: t('appearance.theme.darkHint'),
              },
            ]}
          />
        </Section>
        )}
        {!orgLocks.style && normalizeSkin(skin) === 'custom' && customTheme && (
          <>
            <Section title={t('appearance.accent.title')} subtitle={t('appearance.accent.subtitle')}>
              <input
                type="color"
                value={customTheme.accent}
                onChange={(e) => onCustomThemeChange?.({ ...customTheme, accent: e.target.value })}
                disabled={orgLocks.style}
                aria-label={t('appearance.accent.ariaLabel')}
                className={COLOR_SWATCH_INPUT}
              />
            </Section>
            <Section title={t('appearance.background.lightTitle')} subtitle={t('appearance.background.lightSubtitle')}>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={customTheme.bgLight || stockBackground('light')}
                  onChange={(e) => onCustomThemeChange?.({ ...customTheme, bgLight: e.target.value })}
                  disabled={orgLocks.style || customTheme.bgLight === null}
                  aria-label={t('appearance.background.lightAriaLabel')}
                  className={COLOR_SWATCH_INPUT}
                  style={{ opacity: customTheme.bgLight === null ? 0.45 : 1 }}
                />
                <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
                  <Checkbox
                    checked={customTheme.bgLight === null}
                    onCheckedChange={(v) => onCustomThemeChange?.({ ...customTheme, bgLight: v ? null : stockBackground('light') })}
                    disabled={orgLocks.style}
                    aria-label={t('appearance.background.lightDefaultAriaLabel')}
                  />
                  {t('appearance.background.default')}
                </label>
              </div>
            </Section>
            <Section title={t('appearance.background.darkTitle')} subtitle={t('appearance.background.darkSubtitle')}>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={customTheme.bgDark || stockBackground('dark')}
                  onChange={(e) => onCustomThemeChange?.({ ...customTheme, bgDark: e.target.value })}
                  disabled={orgLocks.style || customTheme.bgDark === null}
                  aria-label={t('appearance.background.darkAriaLabel')}
                  className={COLOR_SWATCH_INPUT}
                  style={{ opacity: customTheme.bgDark === null ? 0.45 : 1 }}
                />
                <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
                  <Checkbox
                    checked={customTheme.bgDark === null}
                    onCheckedChange={(v) => onCustomThemeChange?.({ ...customTheme, bgDark: v ? null : stockBackground('dark') })}
                    disabled={orgLocks.style}
                    aria-label={t('appearance.background.darkDefaultAriaLabel')}
                  />
                  {t('appearance.background.default')}
                </label>
              </div>
            </Section>
            <Section title={t('appearance.corners.title')} subtitle={t('appearance.corners.subtitle')}>
              <ToggleGroup
                value={String(customTheme.radius)}
                onValueChange={(v) => onCustomThemeChange?.({ ...customTheme, radius: Number(v) })}
                disabled={orgLocks.style}
                aria-label={t('appearance.corners.ariaLabel')}
                options={[
                  { value: '0', label: t('appearance.corners.square'), 'aria-label': t('appearance.corners.squareAriaLabel'), title: t('appearance.corners.squareHint') },
                  { value: '6', label: t('appearance.corners.soft'), 'aria-label': t('appearance.corners.softAriaLabel'), title: t('appearance.corners.softHint') },
                  { value: '12', label: t('appearance.corners.round'), 'aria-label': t('appearance.corners.roundAriaLabel'), title: t('appearance.corners.roundHint') },
                ]}
              />
            </Section>
            <Section title={t('appearance.typeface.title')} subtitle={t('appearance.typeface.subtitle')}>
              <ToggleGroup
                value={customTheme.font}
                onValueChange={(v) => onCustomThemeChange?.({ ...customTheme, font: v })}
                disabled={orgLocks.style}
                aria-label={t('appearance.typeface.ariaLabel')}
                options={[
                  { value: 'standard', label: t('appearance.typeface.standard'), 'aria-label': t('appearance.typeface.standardAriaLabel'), title: t('appearance.typeface.standardHint') },
                  { value: 'mono', label: t('appearance.typeface.mono'), 'aria-label': t('appearance.typeface.monoAriaLabel'), title: t('appearance.typeface.monoHint') },
                ]}
              />
            </Section>
            <Section title={t('appearance.scanlines.title')} subtitle={t('appearance.scanlines.subtitle')}>
              <Switch
                checked={customTheme.scanlines}
                onCheckedChange={(v) => onCustomThemeChange?.({ ...customTheme, scanlines: v })}
                disabled={orgLocks.style}
                aria-label={t('appearance.scanlines.ariaLabel')}
              />
            </Section>
          </>
        )}
        {orgLocks.greeting ? orgSetsNote() : (
        <Section title={t('appearance.greeting.title')} subtitle={orgLocks.greeting ? t('appearance.setByOrg') : t('appearance.greeting.subtitle')}>
          <div className="flex items-center gap-1">
            <div className="flex-1">
              <TextInput
                value={orgLocks.greeting ? look.greeting : settings.greeting}
                onChange={(v) => autoSaveSetting('greeting', v, { debounceMs: 600 })}
                disabled={orgLocks.greeting}
                title={t('appearance.greeting.hint')}
                ariaLabel={t('appearance.greeting.ariaLabel')}
              />
            </div>
            <AutoSaveTag settingKey="greeting" />
          </div>
        </Section>
        )}
          {someLockedByOrg && (
            <div className="py-3 text-sm text-ink-2" data-testid="org-sets-rest">
              {t('appearance.yourStyle.orgSetsRest')}
              {changeInBranding}
            </div>
          )}
          {/* Hosted MindsHub has no per-person sidebar title, logo or tab icon. */}
          {!hostedMindsHub && (
            <>
        <Section title={t('appearance.sidebarTitle.title')} subtitle={t('appearance.sidebarTitle.subtitle', { product: productName(STOCK_WORDMARK) })}>
          <div className="flex items-center gap-1">
            <div className="flex-1">
              <TextInput
                value={settings.navTitle || ''}
                onChange={(v) => autoSaveSetting('navTitle', v, { debounceMs: 600 })}
                placeholder={productName(STOCK_WORDMARK)}
                title={t('appearance.sidebarTitle.hint', { product: productName(STOCK_WORDMARK) })}
                ariaLabel={t('appearance.sidebarTitle.ariaLabel')}
              />
            </div>
            <AutoSaveTag settingKey="navTitle" />
          </div>
        </Section>
        <Section title={t('appearance.sidebarTitleColor.title')} subtitle={t('appearance.sidebarTitleColor.subtitle')}>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={settings.navTitleColor || '#e8e8ec'}
              onChange={(e) => autoSaveSetting('navTitleColor', e.target.value, { debounceMs: 400 })}
              disabled={!settings.navTitleColor}
              aria-label={t('appearance.sidebarTitleColor.ariaLabel')}
              className={COLOR_SWATCH_INPUT}
              style={{ opacity: settings.navTitleColor ? 1 : 0.45 }}
            />
            <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
              <Checkbox
                checked={!settings.navTitleColor}
                onCheckedChange={(v) => autoSaveSetting('navTitleColor', v ? '' : '#e8e8ec')}
                aria-label={t('appearance.sidebarTitleColor.followAriaLabel')}
              />
              {t('appearance.sidebarTitleColor.follow')}
            </label>
            <AutoSaveTag settingKey="navTitleColor" />
          </div>
        </Section>
        <Section title={t('appearance.sidebarLogo.title')} subtitle={t('appearance.sidebarLogo.subtitle')}>
          <div className="flex items-center gap-3">
            {settings.navLogo && (
              <img
                src={settings.navLogo}
                alt=""
                className="w-8 h-8 object-contain rounded-md border border-solid border-line-2 bg-surface"
              />
            )}
            <Button
              variant="subtle"
              onClick={() => logoInputRef.current?.click()}
            >
              {settings.navLogo ? t('appearance.sidebarLogo.change') : t('appearance.sidebarLogo.upload')}
            </Button>
            {settings.navLogo && (
              <Button
                variant="danger"
                onClick={() => { autoSaveSetting('navLogo', ''); setLogoError(null); }}
              >
                {Ico.trash(14)}
                {t('appearance.sidebarLogo.remove')}
              </Button>
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={(e) => { handleLogoUpload(e.target.files?.[0]); e.target.value = ''; }}
            />
            <AutoSaveTag settingKey="navLogo" />
          </div>
          {logoError && (
            <div className="text-[12px] text-danger mt-1.5">{logoError}</div>
          )}
        </Section>
        {host.isWeb && (
          <Section title={t('appearance.favicon.title')} subtitle={t('appearance.favicon.subtitle')}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {settings.favicon && (
                <img src={settings.favicon} alt={t('appearance.favicon.previewAlt')} className="w-8 h-8 object-contain rounded-md border border-solid border-line-2 bg-surface" />
              )}
              <Button variant="subtle" className="whitespace-nowrap" onClick={() => faviconInputRef.current?.click()}>
                {settings.favicon ? t('appearance.favicon.change') : t('appearance.favicon.upload')}
              </Button>
              {settings.favicon && (
                <Button variant="danger" className="whitespace-nowrap" onClick={() => {
                  faviconReadRef.current?.abort();
                  faviconReadRef.current = null;
                  autoSaveSetting('favicon', '');
                  setFaviconError(null);
                }} aria-label={t('appearance.favicon.removeAriaLabel')}>
                  {Ico.trash(14)} {t('appearance.favicon.remove')}
                </Button>
              )}
              <input ref={faviconInputRef} type="file" accept={`${FAVICON_MIME_TYPES.join(',')},.ico`}
                aria-label={t('appearance.favicon.fileAriaLabel')} className="hidden"
                onChange={(e) => { handleFaviconUpload(e.target.files?.[0]); e.target.value = ''; }} />
              <AutoSaveTag settingKey="favicon" />
            </div>
            {faviconError && <div role="alert" className="text-[12px] text-danger mt-1.5">{faviconError}</div>}
          </Section>
        )}
            </>
          )}
        </>
        )}
        </SettingsGroup>
      </div>
      <div id={APPEARANCE_ANCHORS.display} className="scroll-mt-2">
        <SettingsGroup title={t('appearance.display.title')} description={t('appearance.display.description')}>
        {/* Gated on its own key. A server older than this setting does not
            serve the key and rejects a write to it with a 400, and it sends
            no figure sources to mark either. The renderer ships OTA and
            leads the installed server. */}
        {'showFigureSources' in settings && (
          <Section title={t('appearance.figureSources.title')} subtitle={t('appearance.figureSources.subtitle')}>
            <div className="flex items-center">
              <Switch
                checked={settings.showFigureSources !== false}
                onCheckedChange={(v) => autoSaveSetting('showFigureSources', v)}
                aria-label={t('appearance.figureSources.title')}
              />
              <AutoSaveTag settingKey="showFigureSources" />
            </div>
          </Section>
        )}
        <div className="settings-hide-mobile">
          <Section title={t('appearance.animatedBackground.title')} subtitle={t('appearance.animatedBackground.subtitle')}>
            <div className="flex items-center">
              <Switch
                checked={settings.showDots === true}
                onCheckedChange={(v) => autoSaveSetting('showDots', v)}
                aria-label={t('appearance.animatedBackground.title')}
              />
              <AutoSaveTag settingKey="showDots" />
            </div>
          </Section>
          <Section title={t('appearance.counters.title')} subtitle={t('appearance.counters.subtitle')}>
            <div className="flex items-center">
              <Switch
                checked={settings.showCounters === true}
                onCheckedChange={(v) => autoSaveSetting('showCounters', v)}
                aria-label={t('appearance.counters.ariaLabel')}
              />
              <AutoSaveTag settingKey="showCounters" />
            </div>
          </Section>
          <Section title={t('appearance.themeToggle.title')} subtitle={t('appearance.themeToggle.subtitle')}>
            <div className="flex items-center">
              <Switch
                checked={settings.showThemeToggle !== false}
                onCheckedChange={(v) => autoSaveSetting('showThemeToggle', v)}
                aria-label={t('appearance.themeToggle.title')}
              />
              <AutoSaveTag settingKey="showThemeToggle" />
            </div>
          </Section>
          {!SKIN_LOCKED && (
            <Section title={t('appearance.styleToggle.title')} subtitle={t('appearance.styleToggle.subtitle')}>
              <div className="flex items-center">
                <Switch
                  checked={settings.show8bitToggle !== false}
                  onCheckedChange={(v) => autoSaveSetting('show8bitToggle', v)}
                  aria-label={t('appearance.styleToggle.title')}
                />
                <AutoSaveTag settingKey="show8bitToggle" />
              </div>
            </Section>
          )}
        </div>
        </SettingsGroup>
      </div>
    </SettingsSectionPanel>
  );

  // Settings → Branding: the org's look, for org admins only.
  const renderBrandingSection = () => (canEditBranding ? (
    <SettingsSectionPanel>
      <SettingsGroup
        title={t('branding.title')}
        description={t('branding.description')}
      >
        <OrgBrandingFields branding={orgBranding} onSaved={onOrgBrandingSaved} onDraftChange={onOrgBrandingDraft} />
      </SettingsGroup>
    </SettingsSectionPanel>
  ) : null);
  const renderDesktopSection = () => (
    // How the app behaves on this computer. Desktop only (settingsNavigation
    // leaves it out on web). Every control here saves itself.
    <SettingsSectionPanel autoSaved>
      <SettingsGroup title={t('desktop.title')}>
        <Section
          title={t('desktop.keepAwake.title')}
          subtitle={t('desktop.keepAwake.subtitle')}
        >
          <div className="flex items-center">
            <Switch
              checked={settings.scheduleKeepAwake !== false}
              onCheckedChange={(v) => autoSaveSetting('scheduleKeepAwake', v)}
              aria-label={t('desktop.keepAwake.title')}
            />
            <AutoSaveTag settingKey="scheduleKeepAwake" />
          </div>
        </Section>
      </SettingsGroup>
    </SettingsSectionPanel>
  );

  const renderChannelsSection = () => (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <ChannelsView />
    </div>
  );

  const renderUpdatesSection = () => (
    <UpdatesSection
      footer={renderSaveFooter()}
      serverOnline={serverOnline}
      shellUpdate={shellUpdate}
      onDownloadShellUpdate={onDownloadShellUpdate}
      shellAutoUpdate={shellAutoUpdate}
      onDownloadShellAutoUpdate={onDownloadShellAutoUpdate}
      onInstallShellAutoUpdate={onInstallShellAutoUpdate}
      onRetryShellAutoUpdate={onRetryShellAutoUpdate}
    />
  );

  const renderBackendSection = () => (
    <BackendSection
      serverOnline={serverOnline}
      serverBusy={serverBusy}
      serverBusyKind={serverBusyKind}
      onStartServer={onStartServer}
      onStopServer={onStopServer}
    />
  );

  const renderAccountSection = () => (
    <AccountSection
      isSsoConnected={isSsoConnected}
      ssoError={ssoError}
      onSsoSignIn={onSsoSignIn}
    />
  );

  /* Usage (ENG-1782): the free MindsHub Air allowance, balance, auto top up.
     Reads the usage App polls (HubUsageContext); every action deep-links to
     the console. */
  const renderUsageSection = () => (
    <UsageSection
      isSsoConnected={isSsoConnected}
      // Only where Account is a section this host actually offers. `account`
      // is not in WEB_NAV_IDS, so on web the deep link resolves to the first
      // visible section (Agent) on desktop widths and pops back to the
      // section list on mobile — a button that silently goes somewhere else.
      onOpenAccount={!host.isWeb && onSectionChange ? () => onSectionChange('account') : undefined}
    />
  );


  // Mobile (ENG-990): master-detail. The surface is a list of the six
  // sections; tapping one drills into a focused full-screen page for just
  // that section (sub-groups render flat — see SettingsGroup — and no longer
  // collapse on either platform). The top-bar back control returns to the list; from
  // the list it closes Settings (onClose). Only the open section mounts, so
  // its effects/dropdowns don't all run at once.
  if (mobile) {
    const renderers = {
      agent: renderAgentSection,
      codingAgent: renderCodingAgentSection,
      computers: renderComputersSection,
      appearance: renderAppearanceSection,
      branding: renderBrandingSection,
      channels: renderChannelsSection,
      updates: renderUpdatesSection,
      backend: renderBackendSection,
      usage: renderUsageSection,
      account: renderAccountSection,
    };
    const activeItem = visibleNav.find((i) => i.id === shownSection) || null;
    const inDetail = Boolean(activeItem);
    return (
      <SettingsLayoutContext.Provider value={{ mobile: true }}>
        <header className="settings-mobile__top">
          <button
            type="button"
            className="settings-mobile__back"
            aria-label={inDetail ? t('mobile.back') : t('mobile.close')}
            onClick={() => (inDetail ? onSectionChange?.(null) : onClose?.())}
          >
            {Ico.chevLeft(20)}
          </button>
          <div className="settings-mobile__title" id="settings-mobile-title">
            {activeItem ? t(`nav.items.${activeItem.id}`) : t('nav.title')}
          </div>
          <span className="settings-mobile__spacer" aria-hidden="true" />
        </header>
        <div className="settings-mobile__body scroll-clean">
          {inDetail ? (
            <div className="settings-detail">
              {renderers[shownSection]?.()}
            </div>
          ) : (
            <nav className="settings-list" role="navigation" aria-label={t('nav.ariaLabel')}>
              {visibleNav.map((item, index, items) => {
                // Match the desktop nav: Backend can recover a dead local
                // server, while Coding agent owns a device-local opt-in and
                // remains actionable without the runtime.
                const disabled = !host.isWeb
                  && !serverOnline
                  && item.id !== 'backend'
                  && item.id !== 'codingAgent';
                const icon = Ico[item.icon] ? Ico[item.icon](16) : null;
                return (
                  <Fragment key={item.id}>
                  {(index === 0 || items[index - 1]?.group !== item.group) && (
                    <div className="section-label pt-4 px-1 pb-1.5">{t(`nav.groups.${item.group}`)}</div>
                  )}
                  <div className="mshell-accordion">
                    <button
                      type="button"
                      className="mshell-accordion__head"
                      aria-disabled={disabled || undefined}
                      disabled={disabled}
                      onClick={() => onSectionChange?.(item.id)}
                      style={disabled ? { opacity: 0.4, cursor: 'default' } : undefined}
                    >
                      {icon && (
                        <span aria-hidden="true" className="inline-flex shrink-0 text-ink-3">
                          {icon}
                        </span>
                      )}
                      <span className="mshell-accordion__label">{t(`nav.items.${item.id}`)}</span>
                      <span className="mshell-accordion__chev">{Ico.chevronRight(16)}</span>
                    </button>
                  </div>
                  </Fragment>
                );
              })}
            </nav>
          )}
        </div>
      </SettingsLayoutContext.Provider>
    );
  }

  // Hiding a nav row isn't enough on its own — `navigate('settings:backend')`
  // sets the section directly, so a deep link (or a stale persisted section)
  // could still render one this host doesn't offer. Resolve through the visible
  // set and fall back to its first entry (Agent).
  const effectiveSection = visibleNav.some((i) => i.id === shownSection)
    ? shownSection
    : visibleNav[0]?.id;

  return (
    <div className="flex-1 flex flex-row min-h-0">
      <SettingsNav section={effectiveSection} onSectionChange={onSectionChange} serverOnline={serverOnline} items={visibleNav} />

      {effectiveSection === 'agent' && renderAgentSection()}
      {effectiveSection === 'codingAgent' && renderCodingAgentSection()}
      {effectiveSection === 'computers' && renderComputersSection()}
      {effectiveSection === 'appearance' && renderAppearanceSection()}
      {effectiveSection === 'branding' && renderBrandingSection()}
      {effectiveSection === 'desktop' && renderDesktopSection()}
      {effectiveSection === 'channels' && renderChannelsSection()}
      {effectiveSection === 'updates' && renderUpdatesSection()}
      {effectiveSection === 'backend' && renderBackendSection()}
      {effectiveSection === 'usage' && renderUsageSection()}
      {effectiveSection === 'account' && renderAccountSection()}
    </div>
  );
}
