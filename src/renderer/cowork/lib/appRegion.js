// Electron builds the window's drag region from `-webkit-app-region` CSS,
// applied in DOM order, and ignores opacity and pointer-events. A
// full-window overlay (a drawer scrim) therefore opts out only while it is
// open, so clicks reach it, and sets nothing while closed: a closed `drag`
// would come after the titlebar and turn every titlebar button into a drag
// handle, and a closed `no-drag` would cancel the titlebar's drag region.
export function overlayAppRegion(open) {
  return open ? 'no-drag' : undefined;
}
