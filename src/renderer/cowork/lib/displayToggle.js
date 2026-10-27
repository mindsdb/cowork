import { DEFAULT_SKIN, SKIN_LOCKED, skinLabel } from '../../lib/skins';

/*
 * What the corner display button does, from the two Appearance switches
 * (ENG-3201). Each switch gates only its own control: with both on, the
 * button opens Display settings (theme + style); with one on, it flips that
 * one directly; with both off, there is no button. A deployment brand's style
 * lock turns the style control off, whatever its switch says.
 */
export function displayToggleMode({ showThemeToggle, show8bitToggle }) {
  const theme = showThemeToggle !== false;
  const style = !SKIN_LOCKED && show8bitToggle !== false;
  if (theme && style) return 'menu';
  if (theme) return 'theme';
  if (style) return 'style';
  return null;
}

// The style the direct 8-Bit toggle switches to: out of 8-Bit, back to the
// default style (a deployment brand's style when it has one, else Normal).
// Custom counts as "not 8-Bit".
export function nextToggledSkin(skin) {
  return skin === '8bit' ? DEFAULT_SKIN : '8bit';
}

// The direct toggle's label, naming the style it switches to.
export function styleToggleLabel(skin) {
  return `Switch to ${skinLabel(nextToggledSkin(skin))} style`;
}
