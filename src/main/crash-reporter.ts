// Local-only native crash collection for the main process.
//
// Without a crashpad handler, a native fault that unwinds through a JS frame
// ends in `TerminateProcess(0xFFFF7003)` on Windows: no minidump, no WER entry.
// Electron starts the main-process handler only when JS calls start().
//
// start() resolves and caches the userData path (Electron's PathService), and
// app.setName() does not invalidate that cache. Call it only after the final
// app name or userData path is in place, or every later userData read lands in
// the wrong directory.
import { app, crashReporter } from 'electron';

export function startCrashReporter(): void {
  // Minidumps hold process memory, tokens included, so nothing is uploaded and
  // no account data is attached.
  crashReporter.start({ uploadToServer: false });
  console.log(`[crash-reporter] minidumps → ${app.getPath('crashDumps')}`);
}
