/*
 * Display modal — pick light/dark theme + style (Normal / 8-Bit). Opened
 * from the bottom-right corner button. Theme/style changes apply live (the
 * parent's setTheme/setSkin persist + repaint via App.jsx effects), so
 * there's no Apply/Cancel — close when you like the look.
 *
 * Coding mode has its own bare toggle next to this modal's corner button
 * (App.jsx) — not offered here, so there's one control for it, not two.
 *
 * "Custom" lives in Settings → Appearance (it needs the token recipe editor),
 * so it's intentionally not offered here — this is the quick theme + 8-bit
 * switch. Under a deployment brand's style lock it offers the theme alone,
 * and whatever an org has locked for its members (`orgLocks`) is
 * shown as set by the organization instead of offered.
 */

import { Modal, ModalHeader, ModalBody } from './ui/Modal';
import { SKINS, SKIN_LOCKED } from '../../lib/skins';

const STYLE_OPTIONS = SKINS.filter((s) => s.id !== 'custom'); // Normal / 8-Bit

function Choice({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex-1 py-[10px] px-3 rounded-[10px] cursor-pointer text-[13px] font-semibold tracking-[0.02em] [transition:background_var(--dur-hover),border-color_var(--dur-hover),color_var(--dur-hover)]"
      style={{
        // Theme tokens, so a custom background's derived ink and accent
        // (lib/customTheme.ts) keep these readable.
        border: active ? '1px solid var(--accent)' : '1px solid var(--line-2)',
        background: active ? 'var(--accent-bg)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--ink)',
      }}
    >
      {children}
    </button>
  );
}

function Group({ label, children }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-ink-2">
        {label}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export default function ThemeModal({
  open, onClose, theme, onThemeChange, skin, onSkinChange, orgLocks = null,
}) {
  const themeLocked = orgLocks?.theme === true;
  const styleLocked = orgLocks?.style === true;
  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="theme-modal-title">
      <ModalHeader id="theme-modal-title" title="Display Settings" subtitle={SKIN_LOCKED ? 'Theme — applied live' : 'Theme and style — applied live'} onClose={onClose} />
      <ModalBody>
        <div className="flex flex-col gap-[18px]">
          {!themeLocked && (
            <Group label="Theme">
              <Choice active={theme === 'light'} onClick={() => onThemeChange('light')}>Light</Choice>
              <Choice active={theme === 'dark'} onClick={() => onThemeChange('dark')}>Dark</Choice>
            </Group>
          )}
          {(themeLocked || (styleLocked && !SKIN_LOCKED)) && (
            <p className="m-0 text-sm text-ink-3">
              {themeLocked && (styleLocked || SKIN_LOCKED) ? 'Theme and style are' : themeLocked ? 'Theme is' : 'Style is'} set by your organization.
            </p>
          )}
          {!SKIN_LOCKED && !styleLocked && (
            <Group label="Style">
              {STYLE_OPTIONS.map((s) => (
                <Choice key={s.id} active={skin === s.id} onClick={() => onSkinChange(s.id)}>
                  {s.label}
                </Choice>
              ))}
            </Group>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}
