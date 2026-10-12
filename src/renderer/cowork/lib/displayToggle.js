// What the corner display button does, from the two Appearance switches
// (ENG-3201). Each switch gates only its own control: with both on, the
// button opens Display settings (theme + style); with one on, it flips that
// one directly; with both off, there is no button.
export function displayToggleMode({ showThemeToggle, show8bitToggle }) {
  const theme = showThemeToggle !== false;
  const style = show8bitToggle !== false;
  if (theme && style) return 'menu';
  if (theme) return 'theme';
  if (style) return 'style';
  return null;
}

// The style the direct 8-Bit toggle switches to. Custom counts as "not 8-Bit".
export function nextToggledSkin(skin) {
  return skin === '8bit' ? 'normal' : '8bit';
}
