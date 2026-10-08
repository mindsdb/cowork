// Why the user's work from the other app is not here.
//
// The web and desktop apps look the same, but they are not talking to the same
// server: desktop runs its own local cowork-server and web uses the hosted one.
// Tasks and artifacts live in whichever server made them, so each app shows
// only its own. The product already branches on `host.isWeb` everywhere; this
// is the one place the answer is turned into words. One module, so the
// empty-state notes cannot drift apart.

/** Empty-state copy that points at the other app. */
export function surfaceCopy(isWeb) {
  const other = isWeb ? 'desktop app' : 'web app';
  return {
    tasksNote: `Tasks made in the ${other} stay there.`,
    artifactsNote: `Artifacts made in the ${other} stay there.`,
  };
}
