// What a Share button shows: "Share" while only the owner has access,
// "Shared" once anyone else does, with an icon for how it's shared
// (everyone at the org, specific teams and people, a public link, a password).
// The state comes from `skillShareState` / `artifactShareState` in
// lib/orgSharing; the tooltip saying who is the caller's, from `hint`.

import Ico from './Icons';

const ICONS = {
  private: Ico.userPlus,
  org: Ico.building,
  specific: Ico.people,
  public: Ico.globe,
  password: Ico.lock,
};

/** The icon for a share state's `kind`. */
export function shareStateIcon(kind, size = 14) {
  return (ICONS[kind] || ICONS.private)(size);
}

/** The icon and "Share" / "Shared", for inside a button. */
export function ShareStateLabel({ state, size = 14, icon = true }) {
  return (
    <>
      {icon && <span aria-hidden="true" className="inline-flex">{shareStateIcon(state?.kind, size)}</span>}
      {state?.shared ? 'Shared' : 'Share'}
    </>
  );
}

export default ShareStateLabel;
