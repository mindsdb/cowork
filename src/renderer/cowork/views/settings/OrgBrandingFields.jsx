/**
 * The org's branding, the first part of Settings → Appearance →
 * Branding in hosted MindsHub: the sidebar title, the logo and icon (set in
 * the console), the org's style (the skins with "Design your own", light or
 * dark, the greeting), whether members may choose their own style, and the
 * notes Anton's Brand guidelines skill is built from.
 *
 * An org admin (`canEdit`) edits it; everyone else sees the same fields
 * read-only. Unlike the personal controls on this page it has a Save button:
 * a change reaches every member, so it is one deliberate step, not a
 * debounce. A save applies in this window at once (onSaved) and in other
 * members' windows the next time they start the app or open Settings.
 */
import { useEffect, useState } from 'react';
import Ico from '../../components/Icons';
import { ToggleGroup } from '../../components/ui/ToggleGroup';
import { Switch } from '../../components/ui/Switch';
import { Button, Checkbox, Input, Textarea } from '../../components/ui';
import { Section } from './settingsLayout';
import { updateOrgAppearance } from '../../api';
import { openExternal } from '../../../platform/host';
import { useAccountUser } from '../../hooks/useAccountUser';
import { MINDS_GENERAL_URL, consoleUrlFor } from '../../../lib/mindsUrls';
import { SKINS, SKIN_LOCKED } from '../../../lib/skins';
import { DEFAULT_CUSTOM_THEME } from '../../../lib/customTheme';
import { stockBackground } from '../../../lib/stockThemeTokens';
import { productName } from '../../../lib/deploymentBrand';
import { STOCK_WORDMARK } from '../../../../shared/product-name';
import { sharedTranslator, useTranslation } from '../../../lib/i18n';
import {
  GREETING_MAX_LENGTH,
  GUIDELINES_MAX_LENGTH,
  CUSTOM_SIDEBAR_TITLE_MAX_LENGTH,
  appearancePayload,
  companySidebarTitle,
} from '../../../lib/orgBranding';

const COLOR_SWATCH_INPUT =
  'w-[64px] h-[32px] p-0.5 border border-solid border-line-2 rounded-md bg-surface cursor-pointer disabled:cursor-not-allowed';
const IMAGE_PREVIEW =
  'h-8 max-w-[160px] object-contain rounded-md border border-solid border-line-2 bg-surface p-1';
const NOT_SET = 'none';
// For saveErrorMessage, which runs outside a component.
const tr = sharedTranslator('settings');

/** The draft the form edits: the saved look, with the style spelled out. */
function draftFrom(appearance) {
  const hasRecipe = appearance.accent !== null || appearance.backgroundLight !== null || appearance.backgroundDark !== null
    || appearance.font !== null || appearance.radius !== null;
  return { ...appearance, skin: appearance.skin ?? (hasRecipe ? 'custom' : null) };
}

/** What to save: recipe fields only for the custom style, blanks as unset. */
export function appearanceToSave(draft) {
  const custom = draft.skin === 'custom';
  return appearancePayload({
    ...draft,
    // Only a custom title is sent; "company" follows the org's current name
    // on the server, so a rename in the console updates the title.
    sidebarTitle: draft.sidebarTitleMode === 'custom' ? (draft.sidebarTitle?.trim() || null) : null,
    accent: custom ? (draft.accent ?? DEFAULT_CUSTOM_THEME.accent) : null,
    backgroundLight: custom ? draft.backgroundLight : null,
    backgroundDark: custom ? draft.backgroundDark : null,
    font: custom ? draft.font : null,
    radius: custom ? draft.radius : null,
    greeting: draft.greeting?.trim() || null,
    guidelines: draft.guidelines?.trim() || null,
  });
}

/**
 * Only the fields the admin changed against the look the form was loaded
 * with, so the save is a partial update: another admin's change to a field
 * this admin didn't touch stays.
 */
export function changedFields(draft, loaded) {
  const next = appearanceToSave(draft);
  const before = appearanceToSave(loaded);
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => before[key] !== value));
}

/**
 * The message for a refused save: the server's own words (it says whether
 * the admin lacks the permission, has to sign in to MindsHub again, or sent
 * a value auth refused), else a plain fallback.
 */
export function saveErrorMessage(err) {
  const detail = typeof err?.message === 'string' && err.message && !/^API \//.test(err.message) ? err.message : null;
  if ((err?.status === 403 || err?.status === 422) && detail) return detail;
  if (err?.status === 403) return tr('branding.saveError.forbidden');
  return tr('branding.saveError.generic');
}

/** Same look? Compared as what would be saved, so a no-op edit isn't a change. */
function sameLook(a, b) {
  return JSON.stringify(appearanceToSave(a)) === JSON.stringify(appearanceToSave(b));
}

export default function OrgBrandingFields({ branding, onSaved, onDraftChange }) {
  const { t } = useTranslation('settings');
  const canEdit = branding.canEdit === true;
  const saved = branding.appearance;
  const [draft, setDraft] = useState(() => draftFrom(saved));
  const [status, setStatus] = useState({ state: 'idle', message: null });
  const [editing, setEditing] = useState(false);
  const [titleError, setTitleError] = useState(null);
  const accountUser = useAccountUser(true);
  const changed = editing && !sameLook(draft, draftFrom(saved));

  // A fresh read (Settings opening, another admin's save) replaces the draft
  // until this admin starts editing.
  useEffect(() => {
    if (!editing) setDraft(draftFrom(saved));
  }, [saved, editing]);

  // The live preview: the draft takes the org-look slot in this window while
  // it differs from the saved look. Leaving this page (another Settings page,
  // closing Settings) unmounts it and puts the saved look back.
  useEffect(() => {
    onDraftChange?.(changed ? draft : null);
  }, [changed, draft, onDraftChange]);
  useEffect(() => () => onDraftChange?.(null), [onDraftChange]);

  const edit = (patch) => {
    if (!canEdit) return;
    setDraft((current) => ({ ...current, ...patch }));
    setEditing(true);
    setTitleError(null);
    setStatus({ state: 'idle', message: null });
  };

  const cancel = () => {
    setDraft(draftFrom(saved));
    setEditing(false);
    setTitleError(null);
    setStatus({ state: 'idle', message: null });
  };

  const save = async () => {
    if (draft.sidebarTitleMode === 'custom' && !draft.sidebarTitle?.trim()) {
      setTitleError(t('branding.sidebarTitle.required'));
      return;
    }
    setStatus({ state: 'saving', message: null });
    try {
      const response = await updateOrgAppearance(changedFields(draft, draftFrom(saved)));
      const next = onSaved?.(response);
      if (next?.appearance) setDraft(draftFrom(next.appearance));
      setEditing(false);
      setStatus({ state: 'saved', message: null });
    } catch (err) {
      setStatus({ state: 'error', message: saveErrorMessage(err) });
    }
  };

  const consoleLink = consoleUrlFor(MINDS_GENERAL_URL, {
    organizationId: accountUser?.orgId ?? null,
    subject: accountUser?.sub ?? null,
  });

  const locked = !canEdit;
  const custom = draft.skin === 'custom';
  const sub = (text) => (canEdit ? text : `${text} ${t('branding.adminOnly')}`);
  const companyTitle = companySidebarTitle(branding.orgName, productName(STOCK_WORDMARK));
  const titleMode = draft.sidebarTitleMode;
  const shownTitle = titleMode === 'none' ? t('branding.sidebarTitle.logoOnly')
    : titleMode === 'custom' ? (draft.sidebarTitle?.trim() || t('branding.sidebarTitle.noTitle'))
      : companyTitle;
  const titleBlank = titleMode === 'custom' && !draft.sidebarTitle?.trim();

  return (
    <>
      <Section title={t('branding.sidebarTitle.title')} subtitle={sub(t('branding.sidebarTitle.subtitle'))}>
        <div className="flex flex-col gap-2">
          <ToggleGroup
            value={titleMode}
            onValueChange={(v) => edit({
              sidebarTitleMode: v,
              sidebarTitle: v === 'custom' ? (draft.sidebarTitle ?? saved.sidebarTitle ?? companyTitle) : draft.sidebarTitle,
            })}
            disabled={locked}
            aria-label={t('branding.sidebarTitle.ariaLabel')}
            options={[
              { value: 'company', label: t('branding.sidebarTitle.company'), 'aria-label': t('branding.sidebarTitle.company'), title: t('branding.sidebarTitle.companyHint') },
              { value: 'custom', label: t('branding.sidebarTitle.custom'), 'aria-label': t('branding.sidebarTitle.custom'), title: t('branding.sidebarTitle.customHint') },
              { value: 'none', label: t('branding.sidebarTitle.none'), 'aria-label': t('branding.sidebarTitle.noneAriaLabel'), title: t('branding.sidebarTitle.noneHint') },
            ]}
          />
          {titleMode === 'custom' && (
            <>
              <Input
                value={draft.sidebarTitle ?? ''}
                onChange={(v) => edit({ sidebarTitle: v })}
                placeholder={companyTitle}
                maxLength={CUSTOM_SIDEBAR_TITLE_MAX_LENGTH}
                disabled={locked}
                required
                aria-invalid={titleBlank || undefined}
                aria-describedby={titleError || titleBlank ? 'org-sidebar-title-error' : undefined}
                aria-label={t('branding.sidebarTitle.customAriaLabel')}
              />
              {(titleError || titleBlank) && (
                <div id="org-sidebar-title-error" role="alert" className="text-[12px] text-danger">
                  {titleError || t('branding.sidebarTitle.required')}
                </div>
              )}
            </>
          )}
          <div className="text-[12px] text-ink-3" data-testid="sidebar-title-preview">
            {t('branding.sidebarTitle.preview')} <span className="font-semibold text-ink-2">{shownTitle}</span>
          </div>
        </div>
      </Section>

      <Section
        title={t('branding.logo.title')}
        subtitle={t('branding.logo.subtitle')}
      >
        <div className="flex flex-wrap items-center gap-3">
          {branding.iconUrl && (
            <img src={branding.iconUrl} alt={t('branding.logo.iconAlt')} className="w-8 h-8 object-contain rounded-md border border-solid border-line-2 bg-surface" />
          )}
          {branding.logoUrl && <img src={branding.logoUrl} alt={t('branding.logo.logoAlt')} className={IMAGE_PREVIEW} />}
          {branding.logoDarkUrl && (
            <img src={branding.logoDarkUrl} alt={t('branding.logo.logoDarkAlt')} className={`${IMAGE_PREVIEW} bg-[#111]`} />
          )}
          {!branding.iconUrl && !branding.logoUrl && !branding.logoDarkUrl && (
            <span className="text-sm text-ink-3">{t('branding.logo.noneSet')}</span>
          )}
          <Button variant="subtle" className="whitespace-nowrap" onClick={() => openExternal(consoleLink)} title={t('branding.logo.opensInBrowser')}>
            {t('branding.logo.editInConsole')} {Ico.arrowUpRight(12)}
          </Button>
        </div>
      </Section>

      <Section title={t('branding.theme.title')} subtitle={sub(t('branding.theme.subtitle'))}>
        <ToggleGroup
          value={draft.defaultTheme ?? NOT_SET}
          onValueChange={(v) => edit({ defaultTheme: v === NOT_SET ? null : v })}
          disabled={locked}
          aria-label={t('branding.theme.ariaLabel')}
          options={[
            { value: NOT_SET, label: t('branding.theme.notSet'), 'aria-label': t('branding.theme.notSetAriaLabel') },
            { value: 'light', label: (<span className="inline-flex items-center gap-1.5">{Ico.sun(14)} {t('appearance.theme.light')}</span>), 'aria-label': t('branding.theme.lightAriaLabel') },
            { value: 'dark', label: (<span className="inline-flex items-center gap-1.5">{Ico.moon(14)} {t('appearance.theme.dark')}</span>), 'aria-label': t('branding.theme.darkAriaLabel') },
          ]}
        />
      </Section>

      {SKIN_LOCKED ? (
        <Section title={t('branding.style.title')} subtitle={t('branding.style.deploymentLocked')} />
      ) : (
        <Section title={t('branding.style.title')} subtitle={sub(t('branding.style.subtitle'))}>
          <ToggleGroup
            value={draft.skin ?? NOT_SET}
            onValueChange={(v) => edit({
              skin: v === NOT_SET ? null : v,
              // Choosing Custom starts both backgrounds on the stock themes' own
              // colors, Default unticked, so they are there to adjust. A saved
              // custom style keeps what it saved.
              ...(v === 'custom' && draft.skin !== 'custom' && draft.backgroundLight === null && draft.backgroundDark === null
                ? { backgroundLight: stockBackground('light'), backgroundDark: stockBackground('dark') }
                : {}),
            })}
            disabled={locked}
            aria-label={t('branding.style.ariaLabel')}
            options={[
              { value: NOT_SET, label: t('branding.style.notSet'), 'aria-label': t('branding.style.notSetAriaLabel'), title: t('branding.style.notSetHint') },
              ...SKINS.map((s) => {
                // A deployment brand's own skin keeps its brand name.
                const label = t(`appearance.skins.${s.id}.label`, { defaultValue: s.label });
                return {
                  value: s.id,
                  label,
                  'aria-label': t('branding.style.optionAriaLabel', { name: label }),
                  title: t(`appearance.skins.${s.id}.title`, { defaultValue: s.title }),
                };
              }),
            ]}
          />
        </Section>
      )}

      {!SKIN_LOCKED && custom && (
        <>
          <Section title={t('appearance.accent.title')} subtitle={t('branding.accent.subtitle')}>
            <input
              type="color"
              value={draft.accent ?? DEFAULT_CUSTOM_THEME.accent}
              onChange={(e) => edit({ accent: e.target.value })}
              disabled={locked}
              aria-label={t('branding.accent.ariaLabel')}
              className={COLOR_SWATCH_INPUT}
            />
          </Section>
          <Section title={t('appearance.background.lightTitle')} subtitle={t('branding.background.lightSubtitle')}>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={draft.backgroundLight ?? stockBackground('light')}
                onChange={(e) => edit({ backgroundLight: e.target.value })}
                disabled={locked || draft.backgroundLight === null}
                aria-label={t('branding.background.lightAriaLabel')}
                className={COLOR_SWATCH_INPUT}
                style={{ opacity: draft.backgroundLight === null ? 0.45 : 1 }}
              />
              <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
                <Checkbox
                  checked={draft.backgroundLight === null}
                  onCheckedChange={(v) => edit({ backgroundLight: v ? null : stockBackground('light') })}
                  disabled={locked}
                  aria-label={t('branding.background.lightDefaultAriaLabel')}
                />
                {t('appearance.background.default')}
              </label>
            </div>
          </Section>
          <Section title={t('appearance.background.darkTitle')} subtitle={t('branding.background.darkSubtitle')}>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={draft.backgroundDark ?? stockBackground('dark')}
                onChange={(e) => edit({ backgroundDark: e.target.value })}
                disabled={locked || draft.backgroundDark === null}
                aria-label={t('branding.background.darkAriaLabel')}
                className={COLOR_SWATCH_INPUT}
                style={{ opacity: draft.backgroundDark === null ? 0.45 : 1 }}
              />
              <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
                <Checkbox
                  checked={draft.backgroundDark === null}
                  onCheckedChange={(v) => edit({ backgroundDark: v ? null : stockBackground('dark') })}
                  disabled={locked}
                  aria-label={t('branding.background.darkDefaultAriaLabel')}
                />
                {t('appearance.background.default')}
              </label>
            </div>
          </Section>
          <Section title={t('appearance.corners.title')} subtitle={t('appearance.corners.subtitle')}>
            <ToggleGroup
              value={String(draft.radius ?? DEFAULT_CUSTOM_THEME.radius)}
              onValueChange={(v) => edit({ radius: Number(v) })}
              disabled={locked}
              aria-label={t('branding.corners.ariaLabel')}
              options={[
                { value: '0', label: t('appearance.corners.square'), 'aria-label': t('branding.corners.squareAriaLabel') },
                { value: '6', label: t('appearance.corners.soft'), 'aria-label': t('branding.corners.softAriaLabel') },
                { value: '12', label: t('appearance.corners.round'), 'aria-label': t('branding.corners.roundAriaLabel') },
              ]}
            />
          </Section>
          <Section title={t('appearance.typeface.title')} subtitle={t('branding.typeface.subtitle')}>
            <ToggleGroup
              value={draft.font ?? DEFAULT_CUSTOM_THEME.font}
              onValueChange={(v) => edit({ font: v })}
              disabled={locked}
              aria-label={t('branding.typeface.ariaLabel')}
              options={[
                { value: 'standard', label: t('appearance.typeface.standard'), 'aria-label': t('branding.typeface.standardAriaLabel') },
                { value: 'mono', label: t('appearance.typeface.mono'), 'aria-label': t('branding.typeface.monoAriaLabel') },
              ]}
            />
          </Section>
        </>
      )}

      <Section title={t('branding.greeting.title')} subtitle={sub(t('branding.greeting.subtitle'))}>
        <Input
          value={draft.greeting ?? ''}
          onChange={(v) => edit({ greeting: v })}
          maxLength={GREETING_MAX_LENGTH}
          disabled={locked}
          aria-label={t('branding.greeting.ariaLabel')}
        />
      </Section>

      <Section
        title={t('branding.membersChoose.title')}
        subtitle={sub(t('branding.membersChoose.subtitle'))}
      >
        <Switch
          checked={draft.membersCanChoose}
          onCheckedChange={(v) => edit({ membersCanChoose: v })}
          disabled={locked}
          aria-label={t('branding.membersChoose.title')}
        />
      </Section>

      <Section
        title={t('branding.guidelines.title')}
        subtitle={sub(t('branding.guidelines.subtitle'))}
      >
        <Textarea
          value={draft.guidelines ?? ''}
          onChange={(v) => edit({ guidelines: v })}
          rows={6}
          maxLength={GUIDELINES_MAX_LENGTH}
          disabled={locked}
          aria-label={t('branding.guidelines.title')}
          placeholder={canEdit ? t('branding.guidelines.placeholder') : t('branding.logo.noneSet')}
        />
        {canEdit && (
          <div className="text-[11.5px] text-ink-4 mt-1">
            {(draft.guidelines ?? '').length} / {GUIDELINES_MAX_LENGTH}
          </div>
        )}
      </Section>

      {canEdit && (
        changed ? (
          <div
            className="sticky bottom-0 flex items-center gap-3 py-3 px-3 my-2 rounded-lg border border-solid border-line-2 bg-surface-2"
            role="region"
            aria-label={t('branding.footer.ariaLabel')}
          >
            <div role="status" aria-live="polite" className="flex-1 text-[13px] font-medium text-ink-2">
              {status.state === 'error' ? <span className="text-danger">{status.message}</span>
                : status.state === 'saving' ? t('branding.footer.saving')
                  : t('branding.footer.unsaved')}
            </div>
            <Button variant="subtle" onClick={cancel} disabled={status.state === 'saving'}>{t('branding.footer.cancel')}</Button>
            <Button variant="primary" onClick={save} disabled={status.state === 'saving'}>{t('branding.footer.save')}</Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 py-3">
            <div role="status" aria-live="polite" className="flex-1 text-[13px] font-medium text-ink-3">
              {status.state === 'saved' ? t('branding.footer.saved') : t('branding.footer.clean')}
            </div>
            <Button variant="primary" disabled>{t('branding.footer.save')}</Button>
          </div>
        )
      )}
    </>
  );
}
