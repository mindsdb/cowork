/**
 * Settings → Branding (ENG-4020): the org's look, edited by an org admin.
 *
 * The same controls Appearance gives a member for their own look (style, the
 * "Design your own" color, background, corners and typeface, light or dark,
 * greeting), here for everyone in the org, plus whether members may change
 * it for themselves and the notes Anton's Brand guidelines skill is built
 * from. The logo and icon are uploaded in the console, which stores them, so
 * this page only shows them and links there.
 *
 * Unlike Appearance this page has a Save button: a change reaches every
 * member, so it should be one deliberate step, not a debounce. A save applies
 * in this window at once (onSaved) and in other members' windows the next
 * time they start the app or open Settings.
 */
import { useEffect, useState } from 'react';
import Ico from '../../components/Icons';
import { ToggleGroup } from '../../components/ui/ToggleGroup';
import { Switch } from '../../components/ui/Switch';
import { Button, Checkbox, Input, Textarea } from '../../components/ui';
import { SettingsGroup, Section, SettingsSectionPanel } from './settingsLayout';
import { updateOrgAppearance } from '../../api';
import { openExternal } from '../../../platform/host';
import { useAccountUser } from '../../hooks/useAccountUser';
import { MINDS_GENERAL_URL, consoleUrlFor } from '../../../lib/mindsUrls';
import { SKINS, SKIN_LOCKED } from '../../../lib/skins';
import { DEFAULT_CUSTOM_THEME } from '../../../lib/customTheme';
import {
  GREETING_MAX_LENGTH,
  GUIDELINES_MAX_LENGTH,
  appearancePayload,
} from '../../../lib/orgBranding';

const COLOR_SWATCH_INPUT =
  'w-[64px] h-[32px] p-0.5 border border-solid border-line-2 rounded-md bg-surface cursor-pointer';
const IMAGE_PREVIEW =
  'h-8 max-w-[160px] object-contain rounded-md border border-solid border-line-2 bg-surface p-1';
const NOT_SET = 'none';

/** The draft the form edits: the saved look, with the style spelled out. */
function draftFrom(appearance) {
  const hasRecipe = appearance.accent !== null || appearance.background !== null
    || appearance.font !== null || appearance.radius !== null;
  return { ...appearance, skin: appearance.skin ?? (hasRecipe ? 'custom' : null) };
}

/** What to save: recipe fields only for the custom style, blanks as unset. */
export function appearanceToSave(draft) {
  const custom = draft.skin === 'custom';
  const greeting = draft.greeting?.trim() || null;
  const guidelines = draft.guidelines?.trim() || null;
  return appearancePayload({
    ...draft,
    accent: custom ? (draft.accent ?? DEFAULT_CUSTOM_THEME.accent) : null,
    background: custom ? draft.background : null,
    font: custom ? draft.font : null,
    radius: custom ? draft.radius : null,
    greeting,
    guidelines,
  });
}

export default function BrandingSection({ branding, onSaved }) {
  const saved = branding.appearance;
  const [draft, setDraft] = useState(() => draftFrom(saved));
  const [status, setStatus] = useState({ state: 'idle', message: null });
  const accountUser = useAccountUser(true);

  // A fresh read (Settings opening, another admin's save) replaces the draft
  // until this admin starts editing.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(draftFrom(saved));
  }, [saved, dirty]);

  const edit = (patch) => {
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

  const custom = draft.skin === 'custom';
  const footer = (
    <>
      <div role="status" aria-live="polite" className="flex-1 text-[13px] font-medium text-ink-3">
        {status.state === 'error' ? <span className="text-danger">{status.message}</span>
          : status.state === 'saving' ? 'Saving…'
            : status.state === 'saved' ? 'Saved. Members see it the next time they open the app or Settings.'
              : dirty ? 'Changes apply to everyone in your organization on save.' : 'No unsaved changes'}
      </div>
      <Button variant="primary" onClick={save} disabled={!dirty || status.state === 'saving'}>
        Save
      </Button>
    </>
  );

  return (
    <SettingsSectionPanel footer={footer}>
      <SettingsGroup title="Organization branding">
        <Section
          title="Logo and icon"
          subtitle="Logo and icon are set in the console."
        >
          <div className="flex flex-wrap items-center gap-3">
            {branding.iconUrl && (
              <img src={branding.iconUrl} alt="Organization icon" className="w-8 h-8 object-contain rounded-md border border-solid border-line-2 bg-surface" />
            )}
            {branding.logoUrl && <img src={branding.logoUrl} alt="Organization logo" className={IMAGE_PREVIEW} />}
            {branding.logoDarkUrl && (
              <img src={branding.logoDarkUrl} alt="Organization logo for dark backgrounds" className={`${IMAGE_PREVIEW} bg-[#111]`} />
            )}
            <Button variant="subtle" className="whitespace-nowrap" onClick={() => openExternal(consoleLink)} title="Opens in your browser">
              Edit in console {Ico.arrowUpRight(12)}
            </Button>
          </div>
        </Section>

        {SKIN_LOCKED ? (
          <Section title="Style" subtitle="Set by this deployment, for every organization on it." />
        ) : (
          <Section title="Style" subtitle="The look everyone in your organization starts from. Custom lets you pick the color, background, corners and typeface.">
            <ToggleGroup
              value={draft.skin ?? NOT_SET}
              onValueChange={(v) => edit({ skin: v === NOT_SET ? null : v })}
              aria-label="Organization style"
              options={[
                { value: NOT_SET, label: 'Not set', 'aria-label': 'No organization style', title: "Members keep the app's standard look." },
                ...SKINS.map((s) => ({ value: s.id, label: s.label, 'aria-label': `${s.label} style`, title: s.title })),
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
                aria-label="Organization accent color"
                className={COLOR_SWATCH_INPUT}
              />
            </Section>
            <Section title="Background" subtitle="A base color for both light and dark; surfaces and text shades derive from it. Or keep each theme's default.">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={draft.background ?? '#fafafa'}
                  onChange={(e) => edit({ background: e.target.value })}
                  disabled={draft.background === null}
                  aria-label="Organization background color"
                  className={COLOR_SWATCH_INPUT}
                  style={{ opacity: draft.background === null ? 0.45 : 1 }}
                />
                <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
                  <Checkbox
                    checked={draft.background === null}
                    onCheckedChange={(v) => edit({ background: v ? null : '#fafafa' })}
                    aria-label="Default background"
                  />
                  Default
                </label>
              </div>
            </Section>
            <Section title="Corners" subtitle="How sharp the surfaces feel.">
              <ToggleGroup
                value={String(draft.radius ?? DEFAULT_CUSTOM_THEME.radius)}
                onValueChange={(v) => edit({ radius: Number(v) })}
                aria-label="Organization corner radius"
                options={[
                  { value: '0', label: 'Square', 'aria-label': 'Square corners' },
                  { value: '6', label: 'Soft', 'aria-label': 'Soft corners' },
                  { value: '12', label: 'Round', 'aria-label': 'Round corners' },
                ]}
              />
            </Section>
            <Section title="Typeface" subtitle="Standard UI font, or mono everywhere.">
              <ToggleGroup
                value={draft.font ?? DEFAULT_CUSTOM_THEME.font}
                onValueChange={(v) => edit({ font: v })}
                aria-label="Organization typeface"
                options={[
                  { value: 'standard', label: 'Standard', 'aria-label': 'Standard font' },
                  { value: 'mono', label: 'Mono', 'aria-label': 'Mono font' },
                ]}
              />
            </Section>
          </>
        )}

        <Section title="Theme" subtitle="Light or dark for everyone, or leave it to each member.">
          <ToggleGroup
            value={draft.defaultTheme ?? NOT_SET}
            onValueChange={(v) => edit({ defaultTheme: v === NOT_SET ? null : v })}
            aria-label="Organization theme"
            options={[
              { value: NOT_SET, label: 'Not set', 'aria-label': 'No organization theme' },
              { value: 'light', label: (<span className="inline-flex items-center gap-1.5">{Ico.sun(14)} Light</span>), 'aria-label': 'Light theme' },
              { value: 'dark', label: (<span className="inline-flex items-center gap-1.5">{Ico.moon(14)} Dark</span>), 'aria-label': 'Dark theme' },
            ]}
          />
        </Section>

        <Section title="Greeting" subtitle="The line members see when they start a new task. Leave blank for the standard one.">
          <Input
            value={draft.greeting ?? ''}
            onChange={(v) => edit({ greeting: v })}
            maxLength={GREETING_MAX_LENGTH}
            aria-label="Organization greeting"
          />
        </Section>

        <Section
          title="Let members choose their own look"
          subtitle="On: this look is where members start, and they can change it for themselves. Off: everyone sees this look, and their own Appearance choices for what you set here are turned off."
        >
          <Switch
            checked={draft.membersCanChoose}
            onCheckedChange={(v) => edit({ membersCanChoose: v })}
            aria-label="Let members choose their own look"
          />
        </Section>
      </SettingsGroup>

      <SettingsGroup title="Brand guidelines for Anton">
        <Section
          title="Guidelines"
          subtitle="How Anton should use your brand in decks, documents, apps and charts: voice, words to use or avoid, where the logo goes. Anton also gets your colors, typeface and logo from the settings above."
        >
          <Textarea
            value={draft.guidelines ?? ''}
            onChange={(v) => edit({ guidelines: v })}
            rows={8}
            maxLength={GUIDELINES_MAX_LENGTH}
            aria-label="Brand guidelines for Anton"
            placeholder={'Markdown. For example:\n- Headlines in sentence case\n- Put the logo top left on title slides'}
          />
          <div className="text-[11.5px] text-ink-4 mt-1">
            {(draft.guidelines ?? '').length} / {GUIDELINES_MAX_LENGTH}
          </div>
        </Section>
      </SettingsGroup>
    </SettingsSectionPanel>
  );
}
