I continued the interrupted job 16 implementation and kept the uncommitted work from jobs 13–15. Nothing was committed or installed to Applications, and no dependencies were added.

The Mac floating-timer button now uses a native window. It opens one small, rounded, frameless timer with draggable background, start/pause, skip, close and clickable digits that bring the dashboard forward. Bounds are saved per display and clamped to the work area. Closing from either window destroys the mini renderer and removes its display listeners. Its restricted preload cannot set tray status, arm alarms or use other native powers. The dashboard remains the only timer leader; the mini follows shared state and sends controls to the dashboard. A late crash event from an old mini cannot close its replacement. Web Document PiP keeps its existing behavior.

Main-window, banner and mini-window workspace calls all use skipTransformProcessType. Native alarms now own the Mac's segment-end sound, speech, notification and foreground attention. They use fixed afplay/say arguments, bounded volume, wall-clock checks and a resume check. Live alarms survive sleep; pending alarms persist for restart, while stale saved alarms are discarded. Speech follows the sound, including auto-run announcements, and can be cancelled. The renderer does not duplicate those effects or start a needless silent Web Audio clock. Native display-sleep blocking remains active when the dashboard is hidden and is released on disable, navigation, crash or Quit. Mac settings describe those native capabilities.

I reproduced the stale-timer bug in the old packaged app with a throwaway profile. A running short break was saved, an IndexedDB transaction was held open, then the timer was reset to Focus and app.quit was called immediately. Relaunch returned to a running short break at 04:59. The continued implementation waits for hydration and committed store writes before quitting, with a two-second escape for an unresponsive renderer. The same packaged regression now restores paused Focus. The shorter takeover layout also keeps the sun icon and buttons inside a 1280×540 viewport; I inspected the captured render.

The job's files are desktop main/preload, floating/native-services/quit modules, their Node tests and smoke scripts; src/ui/pip.tsx, MiniTimer.tsx and its CSS; src/main.tsx, src/desktop.d.ts, src/state/timer.ts, src/audio/companion.ts and native timer/PiP tests; Timer settings, Extras settings and useExtras; the additive flushReadyStores export in src/lib/store.ts; and the shared takeover CSS. docs/PARITY.md and desktop/README.md describe the resulting behavior. The desktop build regenerated its icon PNGs. Existing auto-run, tooltip and multi-monitor work was retained.

The checks passed:

- npx tsc -p tsconfig.app.json --noEmit.
- npm run build, also run by the desktop distribution build.
- npx vitest run: 305 passed. Four optional headless tooltip-browser tests were skipped by their existing opt-in gate.
- node --test from desktop: 95 passed.
- npm run dist from desktop: built the arm64 app and DMG.
- npm run smoke from desktop: passed with both detected displays. It checked native attention across a paused renderer, placement and banner clicks, mini state/control sync, one leader with no mini lock request, both close paths, return to the four-process baseline, native power blocking, Mac alert copy, short-window layout, URL filtering, hidden ticking and reset/quit/relaunch.
- The single-display smoke variant also passed, including zero banners and the restart regression.
- Package signature verification, all five Electron fuse checks, hdiutil verify and git diff --check passed.

The package is out/Kitestring-1.0.0-arm64.dmg. Render captures are dist/job16-mini.png and dist/job16-takeover-1280x540.png. The final smoke and build logs are in dist/job16-native.log and dist/job16-dist.log. All paths here are relative to desktop.

I did not listen-confirm sound or speech, inspect macOS notification presentation, test placement above another app's full-screen Space, or physically hot-plug monitors. Automated tests cover native invocation, ordering, cancellation and display-change logic. The existing hosted-only sync boundary, Gap C1, remains as documented: it needs an approved authenticated sync design and is outside this job's native desktop fixes.
