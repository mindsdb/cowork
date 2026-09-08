// Display modal — pick light/dark theme + style (Normal / 8-Bit). Opened
// from the bottom-right corner button. Theme/style changes apply live (the
// parent's setTheme/setSkin persist + repaint via App.jsx effects), so
// there's no Apply/Cancel — close when you like the look.
//
// Coding mode has its own bare toggle next to this modal's corner button
// (App.jsx) — not offered here, so there's one control for it, not two.
//
// "Custom" lives in Settings → Appearance (it needs the token recipe editor),
// so it's intentionally not offered here — this is the quick theme + 8-bit
// switch.

import { Modal, ModalHeader, ModalBody } from './ui/Modal';
import { SKINS } from '../../lib/skins';

const STYLE_OPTIONS = SKINS.filter((s) => s.id !== 'custom'); // Normal / 8-Bit

function Choice({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex-1 py-[10px] px-3 rounded-[10px] cursor-pointer text-[13px] font-semibold tracking-[0.02em] [transition:background_120ms,border-color_120ms,color_120ms]"
      style={{
        // Active-state accent uses the 8-bit skin's --gf-* vars, so it stays inline.
        border: active
          ? '1px solid var(--gf-accent, #1F9CB0)'
          : '1px solid var(--gf-line, rgba(128,128,128,0.3))',
        background: active
          ? 'color-mix(in srgb, var(--gf-accent, #1F9CB0) 16%, transparent)'
          : 'transparent',
        color: active ? 'var(--gf-accent, #1F9CB0)' : 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function Group({ label, children }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.08em] opacity-60 mb-2">
        {label}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export default function ThemeModal({
  open, onClose, theme, onThemeChange, skin, onSkinChange,
}) {
  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="theme-modal-title">
      <ModalHeader id="theme-modal-title" title="Display Settings" subtitle="Theme and style — applied live" onClose={onClose} />
      <ModalBody>
        <div className="flex flex-col gap-[18px]">
          <Group label="Theme">
            <Choice active={theme === 'light'} onClick={() => onThemeChange('light')}>Light</Choice>
            <Choice active={theme === 'dark'} onClick={() => onThemeChange('dark')}>Dark</Choice>
          </Group>
          <Group label="Style">
            {STYLE_OPTIONS.map((s) => (
              <Choice key={s.id} active={skin === s.id} onClick={() => onSkinChange(s.id)}>
                {s.label}
              </Choice>
            ))}
          </Group>
        </div>
      </ModalBody>
    </Modal>
  );
}
