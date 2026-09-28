// Which app the user is in, said out loud (ENG-2172), and why their work from
// the other one is not here (ENG-2169).
//
// The web and desktop apps look the same, but they are not talking to the same
// server: desktop runs its own local cowork-server and web uses the hosted one.
// Tasks and artifacts live in whichever server made them, so each app shows
// only its own. The product already branches on `host.isWeb` everywhere; this
// is the one place the answer is turned into words. One module, so the label,
// its hint and the empty-state notes cannot drift apart.

/** Copy that names the current app and points at the other one. */
export function surfaceCopy(isWeb) {
  const here = isWeb ? 'web app' : 'desktop app';
  const other = isWeb ? 'desktop app' : 'web app';
  return {
    label: isWeb ? 'Web app' : 'Desktop app',
    detail: `Tasks and artifacts made here stay in the ${here}. The ${other} keeps its own.`,
    tasksNote: `Tasks made in the ${other} stay there.`,
    artifactsNote: `Artifacts made in the ${other} stay there.`,
  };
}
