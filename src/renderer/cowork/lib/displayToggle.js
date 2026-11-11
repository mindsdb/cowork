import { DEFAULT_SKIN, SKIN_LOCKED, skinLabel } from '../../lib/skins';

/*
 * What the corner display button does, from the two Appearance switches
 * (ENG-3201). Each switch gates only its own control: with both on, the
 * button opens Display settings (theme + style); with one on, it flips that
 * one directly; with both off, there is no button. A deployment brand's style
 * lock turns the style control off, whatever its switch says, and so does an
 * org's locked style or theme (`orgLocks`, the resolver's lockedByOrg). When
 * an org lock removes one of two switched-on controls, the button still
 * opens Display settings, which then offers only the other.
 */
export function displayToggleMode({ showThemeToggle, show8bitToggle }, orgLocks = null) {
  const themeSwitch = showThemeToggle !== false;
  const styleSwitch = !SKIN_LOCKED && show8bitToggle !== false;
  // An org that turned member choice off and set a field takes its control
  // away; with both set there is no button.
  const theme = themeSwitch && !orgLocks?.theme;
  const style = styleSwitch && !orgLocks?.style;
  if (theme && style) return 'menu';
  // The org took the other control: the menu, offering just this one's choices.
  if ((theme && styleSwitch && orgLocks?.style) || (style && themeSwitch && orgLocks?.theme)) return 'menu';
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
