/**
 * The org's branding (ENG-4020), the first part of Settings → Appearance →
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
import { productName } from '../../../lib/deploymentBrand';
import { STOCK_WORDMARK } from '../../../../shared/product-name';
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
const ADMIN_ONLY = 'Set by your organization admin.';

/** The draft the form edits: the saved look, with the style spelled out. */
function draftFrom(appearance) {
  const hasRecipe = appearance.accent !== null || appearance.background !== null
    || appearance.font !== null || appearance.radius !== null;
  return { ...appearance, skin: appearance.skin ?? (hasRecipe ? 'custom' : null) };
}

/** What to save: recipe fields only for the custom style, blanks as unset. */
export function appearanceToSave(draft) {
  const custom = draft.skin === 'custom';
  return appearancePayload({
    ...draft,
    // null = "Use company name": the server follows the org's current name,
    // so a rename in the console updates the title. A custom one stays fixed.
    sidebarTitle: draft.sidebarTitle === null ? null : (draft.sidebarTitle.trim() || null),
    accent: custom ? (draft.accent ?? DEFAULT_CUSTOM_THEME.accent) : null,
    background: custom ? draft.background : null,
    font: custom ? draft.font : null,
    radius: custom ? draft.radius : null,
    greeting: draft.greeting?.trim() || null,
    guidelines: draft.guidelines?.trim() || null,
  });
}

export default function OrgBrandingFields({ branding, onSaved }) {
  const canEdit = branding.canEdit === true;
  const saved = branding.appearance;
  const [draft, setDraft] = useState(() => draftFrom(saved));
  const [status, setStatus] = useState({ state: 'idle', message: null });
  const [dirty, setDirty] = useState(false);
  const accountUser = useAccountUser(true);

  // A fresh read (Settings opening, another admin's save) replaces the draft
  // until this admin starts editing.
  useEffect(() => {
    if (!dirty) setDraft(draftFrom(saved));
  }, [saved, dirty]);

  const edit = (patch) => {
    if (!canEdit) return;
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setStatus({ state: 'idle', message: null });
  };

  const save = async () => {
    setStatus({ state: 'saving', message: null });
    try {
      const response = await updateOrgAppearance(appearanceToSave(draft));
      const next = onSaved?.(response);
      if (next?.appearance) setDraft(draftFrom(next.appearance));
      setDirty(false);
      setStatus({ state: 'saved', message: null });
    } catch (err) {
      setStatus({
        state: 'error',
        message: err?.status === 403
          ? 'Only an organization admin can change the branding.'
          : "Couldn't save the branding. Try again.",
      });
    }
  };

  const consoleLink = consoleUrlFor(MINDS_GENERAL_URL, {
    organizationId: accountUser?.orgId ?? null,
    subject: accountUser?.sub ?? null,
  });

  const locked = !canEdit;
  const custom = draft.skin === 'custom';
  const sub = (text) => (canEdit ? text : `${text} ${ADMIN_ONLY}`);
  const companyTitle = companySidebarTitle(branding.orgName, productName(STOCK_WORDMARK));
  const useCompanyName = draft.sidebarTitle === null;
  const shownTitle = useCompanyName ? companyTitle : (draft.sidebarTitle.trim() || companyTitle);

  return (
    <>
      <Section title="Sidebar title" subtitle={sub('Shown at the top of the sidebar for everyone in your organization. The company name follows renames in the console; a custom title stays as you type it.')}>
        <div className="flex flex-col gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
            <Checkbox
              checked={useCompanyName}
              onCheckedChange={(v) => edit({ sidebarTitle: v ? null : (branding.appearance.sidebarTitle ?? companyTitle) })}
              disabled={locked}
            />
            Use company name
          </label>
          {!useCompanyName && (
            <Input
              value={draft.sidebarTitle}
              onChange={(v) => edit({ sidebarTitle: v })}
              placeholder={companyTitle}
              maxLength={CUSTOM_SIDEBAR_TITLE_MAX_LENGTH}
              disabled={locked}
              aria-label="Custom sidebar title"
            />
          )}
          <div className="text-[12px] text-ink-3" data-testid="sidebar-title-preview">
            Sidebar shows: <span className="font-semibold text-ink-2">{shownTitle}</span>
          </div>
        </div>
      </Section>

      <Section
        title="Logo and icon"
        subtitle="The logo is the sidebar logo and the icon is the browser tab icon, for everyone in your organization. They are set in the console."
      >
        <div className="flex flex-wrap items-center gap-3">
          {branding.iconUrl && (
            <img src={branding.iconUrl} alt="Organization icon" className="w-8 h-8 object-contain rounded-md border border-solid border-line-2 bg-surface" />
          )}
          {branding.logoUrl && <img src={branding.logoUrl} alt="Organization logo" className={IMAGE_PREVIEW} />}
          {branding.logoDarkUrl && (
            <img src={branding.logoDarkUrl} alt="Organization logo for dark backgrounds" className={`${IMAGE_PREVIEW} bg-[#111]`} />
          )}
          {!branding.iconUrl && !branding.logoUrl && !branding.logoDarkUrl && (
            <span className="text-sm text-ink-3">None set.</span>
          )}
          <Button variant="subtle" className="whitespace-nowrap" onClick={() => openExternal(consoleLink)} title="Opens in your browser">
            Edit in console {Ico.arrowUpRight(12)}
          </Button>
        </div>
      </Section>

      {SKIN_LOCKED ? (
        <Section title="Organization style" subtitle="Set by this deployment, for every organization on it." />
      ) : (
        <Section title="Organization style" subtitle={sub('The look everyone in your organization starts from. Custom lets you pick the color, background, corners and typeface.')}>
          <ToggleGroup
            value={draft.skin ?? NOT_SET}
            onValueChange={(v) => edit({ skin: v === NOT_SET ? null : v })}
            disabled={locked}
            aria-label="Organization style"
            options={[
              { value: NOT_SET, label: 'Not set', 'aria-label': 'No organization style', title: "Members keep the app's standard look." },
              ...SKINS.map((s) => ({ value: s.id, label: s.label, 'aria-label': `${s.label} organization style`, title: s.title })),
            ]}
          />
        </Section>
      )}

      {!SKIN_LOCKED && custom && (
        <>
          <Section title="Accent color" subtitle="Buttons, highlights and focus rings.">
            <input
              type="color"
              value={draft.accent ?? DEFAULT_CUSTOM_THEME.accent}
              onChange={(e) => edit({ accent: e.target.value })}
              disabled={locked}
              aria-label="Organization accent color"
              className={COLOR_SWATCH_INPUT}
            />
          </Section>
          <Section title="Background" subtitle="Tints the app in light and dark; text adjusts to stay readable. Or keep each theme's default.">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={draft.background ?? '#fafafa'}
                onChange={(e) => edit({ background: e.target.value })}
                disabled={locked || draft.background === null}
                aria-label="Organization background color"
                className={COLOR_SWATCH_INPUT}
                style={{ opacity: draft.background === null ? 0.45 : 1 }}
              />
              <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
                <Checkbox
                  checked={draft.background === null}
                  onCheckedChange={(v) => edit({ background: v ? null : '#fafafa' })}
                  disabled={locked}
                  aria-label="Default organization background"
                />
                Default
              </label>
            </div>
          </Section>
          <Section title="Corners" subtitle="How sharp the surfaces feel.">
            <ToggleGroup
              value={String(draft.radius ?? DEFAULT_CUSTOM_THEME.radius)}
              onValueChange={(v) => edit({ radius: Number(v) })}
              disabled={locked}
              aria-label="Organization corner radius"
              options={[
                { value: '0', label: 'Square', 'aria-label': 'Square organization corners' },
                { value: '6', label: 'Soft', 'aria-label': 'Soft organization corners' },
                { value: '12', label: 'Round', 'aria-label': 'Round organization corners' },
              ]}
            />
          </Section>
          <Section title="Typeface" subtitle="Standard UI font, or mono everywhere.">
            <ToggleGroup
              value={draft.font ?? DEFAULT_CUSTOM_THEME.font}
              onValueChange={(v) => edit({ font: v })}
              disabled={locked}
              aria-label="Organization typeface"
              options={[
                { value: 'standard', label: 'Standard', 'aria-label': 'Standard organization font' },
                { value: 'mono', label: 'Mono', 'aria-label': 'Mono organization font' },
              ]}
            />
          </Section>
        </>
      )}

      <Section title="Organization theme" subtitle={sub('Light or dark for everyone, or leave it to each member.')}>
        <ToggleGroup
          value={draft.defaultTheme ?? NOT_SET}
          onValueChange={(v) => edit({ defaultTheme: v === NOT_SET ? null : v })}
          disabled={locked}
          aria-label="Organization theme"
          options={[
            { value: NOT_SET, label: 'Not set', 'aria-label': 'No organization theme' },
            { value: 'light', label: (<span className="inline-flex items-center gap-1.5">{Ico.sun(14)} Light</span>), 'aria-label': 'Light organization theme' },
            { value: 'dark', label: (<span className="inline-flex items-center gap-1.5">{Ico.moon(14)} Dark</span>), 'aria-label': 'Dark organization theme' },
          ]}
        />
      </Section>

      <Section title="Organization greeting" subtitle={sub('The line members see when they start a new task. Leave blank for the standard one.')}>
        <Input
          value={draft.greeting ?? ''}
          onChange={(v) => edit({ greeting: v })}
          maxLength={GREETING_MAX_LENGTH}
          disabled={locked}
          aria-label="Organization greeting"
        />
      </Section>

      <Section
        title="Let members choose their own style"
        subtitle={sub('On: the organization style is where members start, and they can change it under Your style. Off: everyone sees the organization style.')}
      >
        <Switch
          checked={draft.membersCanChoose}
          onCheckedChange={(v) => edit({ membersCanChoose: v })}
          disabled={locked}
          aria-label="Let members choose their own style"
        />
      </Section>

      <Section
        title="Brand guidelines for Anton"
        subtitle={sub('How Anton should use your brand in decks, documents, apps and charts: voice, words to use or avoid, where the logo goes. Anton also gets your colors, typeface and logo from above.')}
      >
        <Textarea
          value={draft.guidelines ?? ''}
          onChange={(v) => edit({ guidelines: v })}
          rows={6}
          maxLength={GUIDELINES_MAX_LENGTH}
          disabled={locked}
          aria-label="Brand guidelines for Anton"
          placeholder={canEdit ? 'Markdown. For example:\n- Headlines in sentence case\n- Put the logo top left on title slides' : 'None set.'}
        />
        {canEdit && (
          <div className="text-[11.5px] text-ink-4 mt-1">
            {(draft.guidelines ?? '').length} / {GUIDELINES_MAX_LENGTH}
          </div>
        )}
      </Section>

      {canEdit && (
        <div className="flex items-center gap-3 py-3">
          <div role="status" aria-live="polite" className="flex-1 text-[13px] font-medium text-ink-3">
            {status.state === 'error' ? <span className="text-danger">{status.message}</span>
              : status.state === 'saving' ? 'Saving…'
                : status.state === 'saved' ? 'Saved. Members see it the next time they open the app or Settings.'
                  : dirty ? 'Changes apply to everyone in your organization on save.' : 'No unsaved branding changes'}
          </div>
          <Button variant="primary" onClick={save} disabled={!dirty || status.state === 'saving'}>
            Save branding
          </Button>
        </div>
      )}
    </>
  );
}
