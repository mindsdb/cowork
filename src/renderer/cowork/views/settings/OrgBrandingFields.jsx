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
import { stockBackground } from '../../../lib/stockThemeTokens';
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

/** Same look? Compared as what would be saved, so a no-op edit isn't a change. */
function sameLook(a, b) {
  return JSON.stringify(appearanceToSave(a)) === JSON.stringify(appearanceToSave(b));
}

export default function OrgBrandingFields({ branding, onSaved, onDraftChange }) {
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
      setTitleError('Enter a sidebar title, or choose Company name or None.');
      return;
    }
    setStatus({ state: 'saving', message: null });
    try {
      const response = await updateOrgAppearance(appearanceToSave(draft));
      const next = onSaved?.(response);
      if (next?.appearance) setDraft(draftFrom(next.appearance));
      setEditing(false);
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
  const titleMode = draft.sidebarTitleMode;
  const shownTitle = titleMode === 'none' ? 'logo only'
    : titleMode === 'custom' ? (draft.sidebarTitle?.trim() || '(no title)')
      : companyTitle;
  const titleBlank = titleMode === 'custom' && !draft.sidebarTitle?.trim();

  return (
    <>
      <Section title="Sidebar title" subtitle={sub('Shown at the top of the sidebar for everyone in your organization. Company name follows renames in the console; a custom title stays as typed; None shows the logo only.')}>
        <div className="flex flex-col gap-2">
          <ToggleGroup
            value={titleMode}
            onValueChange={(v) => edit({
              sidebarTitleMode: v,
              sidebarTitle: v === 'custom' ? (draft.sidebarTitle ?? saved.sidebarTitle ?? companyTitle) : draft.sidebarTitle,
            })}
            disabled={locked}
            aria-label="Sidebar title"
            options={[
              { value: 'company', label: 'Company name', 'aria-label': 'Company name', title: 'Follows the company name, including renames.' },
              { value: 'custom', label: 'Custom', 'aria-label': 'Custom', title: 'A title you type, kept through renames.' },
              { value: 'none', label: 'None', 'aria-label': 'None (logo only)', title: 'No title: the logo alone.' },
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
                aria-label="Custom sidebar title"
              />
              {(titleError || titleBlank) && (
                <div id="org-sidebar-title-error" role="alert" className="text-[12px] text-danger">
                  {titleError || 'Enter a sidebar title, or choose Company name or None.'}
                </div>
              )}
            </>
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

      {SKIN_LOCKED ? (
        <Section title="Organization style" subtitle="Set by this deployment, for every organization on it." />
      ) : (
        <Section title="Organization style" subtitle={sub('The look everyone in your organization starts from. Custom lets you pick the color, background, corners and typeface.')}>
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
          <Section title="Light background" subtitle="Used in light theme. A dark pick becomes a light tint of its hue; text adjusts to stay readable. With Default, the dark background tints it, or the stock light look applies.">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={draft.backgroundLight ?? stockBackground('light')}
                onChange={(e) => edit({ backgroundLight: e.target.value })}
                disabled={locked || draft.backgroundLight === null}
                aria-label="Organization light background color"
                className={COLOR_SWATCH_INPUT}
                style={{ opacity: draft.backgroundLight === null ? 0.45 : 1 }}
              />
              <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
                <Checkbox
                  checked={draft.backgroundLight === null}
                  onCheckedChange={(v) => edit({ backgroundLight: v ? null : stockBackground('light') })}
                  disabled={locked}
                  aria-label="Default organization light background"
                />
                Default
              </label>
            </div>
          </Section>
          <Section title="Dark background" subtitle="Used in dark theme. A light pick becomes a dark shade of its hue; text adjusts to stay readable. With Default, the light background tints it, or the stock dark look applies.">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={draft.backgroundDark ?? stockBackground('dark')}
                onChange={(e) => edit({ backgroundDark: e.target.value })}
                disabled={locked || draft.backgroundDark === null}
                aria-label="Organization dark background color"
                className={COLOR_SWATCH_INPUT}
                style={{ opacity: draft.backgroundDark === null ? 0.45 : 1 }}
              />
              <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
                <Checkbox
                  checked={draft.backgroundDark === null}
                  onCheckedChange={(v) => edit({ backgroundDark: v ? null : stockBackground('dark') })}
                  disabled={locked}
                  aria-label="Default organization dark background"
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
        changed ? (
          <div
            className="sticky bottom-0 flex items-center gap-3 py-3 px-3 my-2 rounded-lg border border-solid border-line-2 bg-surface-2"
            role="region"
            aria-label="Unsaved branding changes"
          >
            <div role="status" aria-live="polite" className="flex-1 text-[13px] font-medium text-ink-2">
              {status.state === 'error' ? <span className="text-danger">{status.message}</span>
                : status.state === 'saving' ? 'Saving…'
                  : 'Unsaved branding changes. You see them now; everyone else sees them once you save.'}
            </div>
            <Button variant="subtle" onClick={cancel} disabled={status.state === 'saving'}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={status.state === 'saving'}>Save branding</Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 py-3">
            <div role="status" aria-live="polite" className="flex-1 text-[13px] font-medium text-ink-3">
              {status.state === 'saved' ? 'Saved. Members see it the next time they open the app or Settings.' : 'No unsaved branding changes'}
            </div>
            <Button variant="primary" disabled>Save branding</Button>
          </div>
        )
      )}
    </>
  );
}
