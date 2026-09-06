// Synced sidebar branding applies to every skin/theme; custom-theme recipes are local and
// skin-specific.

/** Apply or clear the inline sidebar wordmark color independently of skin. */
export function applyNavTitleColor(color: string | null | undefined): void {
  if (color) document.body.style.setProperty('--nav-title-color', color);
  else document.body.style.removeProperty('--nav-title-color');
}
