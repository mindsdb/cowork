import path from 'node:path';

// Since Electron 43 a dialog without `defaultPath` opens in Downloads and the
// OS no longer remembers the last folder, so main tracks it for this run.
export function folderPickerDefaultPath(lastPicked: string | null, home: string): string {
  return lastPicked ? path.dirname(lastPicked) : home;
}
