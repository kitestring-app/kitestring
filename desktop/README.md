# Kitestring for macOS

An Apple Silicon desktop app that runs the bundled dashboard locally at
`app://custom-pomodoro/`. It needs no localhost server. Tasks, settings and audio
remain available offline; user-selected online music and Unsplash images still
need a connection. Desktop data is separate from browser data; use the dashboard's
Data export/import to move it.

## Build

On an Apple Silicon Mac, install Node.js/npm and ImageMagick (`magick`); macOS
provides `iconutil`. From this folder:

```sh
npm ci
node node_modules/electron/install.js
npm test
npm run dist
npm run smoke
```

`npm run dist` builds the parent web app and packages the checked-in icon assets with
Electron as `out/Kitestring-1.0.0-arm64.dmg`. The unpacked app is
`out/mac-arm64/Kitestring.app`. Electron and electron-builder are pinned dev
dependencies; there are no desktop runtime npm dependencies.

`npm run build:web` runs the root `npm run build`. After that, `npm start` runs
the same local protocol in development. Run the parent checks with:

```sh
cd ..
npx tsc -p tsconfig.app.json --noEmit
npm run build
npx vitest run
```

## Install and use

Open the DMG and drag **Kitestring.app** to Applications. There is no signing
certificate or notarization. The bundle is ad-hoc signed with the stable identifier
`local.custom-pomodoro.desktop`; its Info.plist and resources are sealed. Hardened
runtime remains off.

On first launch, right-click the app and choose **Open**, then confirm **Open**.
Depending on macOS policy, the first attempt may require allowing the app in
System Settings → Privacy & Security before repeating this step.

Closing the window hides it; the timer, audio and menu-bar status keep running.
Click the Dock icon or choose **Show Kitestring** in the menu-bar menu to
return. **Start/Pause** brings the window forward and sends the page's Space
shortcut, first moving focus out of text fields or embedded players. **Open at
login** controls macOS login-item registration; it is unchanged until clicked.
The menu is rebuilt immediately before each popup. The checkbox means macOS
reports the item as enabled, rather than merely registered (older Electron
versions without a status field fall back to `openAtLogin`). If approval is
pending, the menu says **Approve in System Settings → General → Login Items**
and offers **Open Login Items Settings** to open that pane. If the page never
answers Start/Pause, the request expires after two seconds; late replies cannot toggle a later request.
Quit with **⌘Q** or **Quit** in the application/menu-bar menu.

When the dashboard calls `attention('focus-done')` or `attention('break-over')`,
the app restores and raises its window, asks macOS for focus, and bounces the Dock
icon. The window floats across workspaces, including over full-screen apps.
`release()`, hiding the window, or a two-minute timeout clears that state and
stops the bounce. A new eligible request raises the window again even while
attention is active and refreshes the two-minute hold. Accepted requests must
be at least 45 seconds apart, even after release or hide. This allows every
one-minute segment end to bring the app forward without repeated page calls
continually raising the window. An old timeout cannot clear a refreshed hold.

At each accepted reminder, the dashboard moves to the display containing the
cursor and is centered inside its work area. It restores from minimized or
maximized state and exits full screen. Every other display gets a silent,
non-focusable banner at the top of its work area. It says “Break time · click to
open” or “Back to focus · click to open”. Clicking it moves the dashboard to that
display, focuses it, and destroys every banner. A single display gets no banner.
Display additions, removals and work-area changes are handled while reminders
are active. Banners are destroyed on release, hide, timeout, replacement or quit;
there are no hidden banner windows or banner display listeners left after release.
The banner has one 2.4-second pulse, then stays still; reduced-motion preferences
disable the pulse. The menu-bar status uses 🎯 for focus and ☕ for breaks.

Segment-end alerts belong to the main process. A wall-clock alarm plays the
bundled WAV with `afplay`, then the fixed reminder with `say` when enabled, posts
a silent native Electron notification and uses the same foreground/banner path.
The timer page suppresses its own chime, speech and notification for that alarm.
Pending alarms persist in userData across app restarts; live alarms recheck on
resume and fire once after sleep. Saved alarms more than a minute overdue are
discarded at launch. Enable notifications in Focus Timer settings; macOS
notification settings and Focus mode still control their presentation. Settings
report native support and observed delivery failures. Camera/microphone policy remains blocked by the web app's
Permissions Policy; Electron's permission handlers allow only `notifications`
and `media` requests from the app origin and deny all other origins/types.

## Local content and security

The `app:` scheme is registered as standard, secure, fetch/CORS capable and
streaming capable. It serves `Contents/Resources/web` from the packaged web
build, with SPA route fallback, explicit MIME types, HEAD and audio byte ranges.
It rejects traversal and symlinks outside the web root. Missing assets return
404 rather than HTML. The handler reads the CSP directly from the packaged
`_headers` and sends it unchanged with `X-Content-Type-Options: nosniff` and the web security headers (including
Permissions Policy).

The renderer is sandboxed and isolated, without Node integration, with web
security enabled and background throttling disabled. Its only exposed native
API is the frozen `window.desktop` object. The main dashboard receives:

- `setStatus(text)` updates the menu-bar timer text, capped at 64 characters.
- `attention('focus-done' | 'break-over')` brings a segment-end alert forward,
  including when the window was hidden.
- `release()` removes the floating/all-workspace state and stops the Dock bounce
  when the transition is dismissed.

- `floatTimer(open)` creates or destroys one native mini window;
  `onFloatTimer(callback)` reports native close/open changes.
- `armAlarm({ at, kind, volume, speak, notify?, attention?, announcement? })` and
  `disarmAlarm()` schedule/cancel native alerts. Kinds and structured speech
  phases are allowlisted, volume is clamped, and executable/file arguments are fixed.
- `speak(input)`, `cancelSpeech()` and `notificationStatus()` handle structured
  native announcements and notification availability.
- `preventSleep(on)` owns a native display-sleep blocker, including while hidden.
- `onTimerAction(callback)` receives mini-window controls;
  `onFlush(callback)` acknowledges Quit only after IndexedDB commits finish.

The mini window loads `app://custom-pomodoro/?mini=1` with the same sandbox,
isolation and no-Node settings. Its preload exposes only `mini`, close-only
`floatTimer(false)`, `showMain()` and allowlisted `timerControl('toggle' | 'skip')`.
It never calls setStatus or acquires the timer leader lock. It follows committed
state through the same origin's BroadcastChannel/IndexedDB; only the dashboard
writes timer changes and owns alerts and stats. Both close controls destroy the
mini renderer and remove its display listeners. Bounds persist per display and
clamp into the work area when displays change. The background is draggable;
buttons are not. Native workspace calls use `skipTransformProcessType: true` to
avoid Electron changing the app process type and hiding its windows.

Quit asks the dashboard to finish hydration and flush its stores, then waits for
its matching acknowledgement before calling app.quit again. A two-second limit
allows exit if the renderer is hung. The sleep blocker is released on disable,
main navigation, renderer crash or Quit.

These methods let the renderer, which owns the timer and transition UI, request
only those native actions. The main process owns the window state and deadlines.
Main-process IPC verifies the sending main frame, validates attention kinds,
and strips control and bidi override characters from status text. New
windows are denied; only credential-free HTTPS links may open in the default
browser. The one non-HTTPS exception is the exact Login Items Settings URL
`x-apple.systempreferences:com.apple.LoginItems-Settings.extension`; other
System Settings URLs and altered versions of that URL are rejected. Main-frame
navigation remains on the app origin. Banners use a separate sandboxed preload
that exposes only frozen `window.banner.open()`. Their navigation is locked to
their exact banner URL, popups and webviews are denied, and banner IPC requires
membership in the live banner-window set, the sending main frame, and the exact
local banner document with a valid kind. Destroying a banner revokes that trust.
The banner's own CSP allows only its local script and stylesheet. A renderer crash destroys and recreates
the window while keeping the tray alive.
Byte ranges reject zero-length suffixes and numbers outside JavaScript's safe
integer range before clamping to the file length.

Fresh installs use system DNS. Settings > Extras > DNS on this Mac accepts an
optional HTTPS DNS-over-HTTPS endpoint, including a profile URL you supply.
Leave it empty to return to system DNS. The main process stores it only in
`secure-dns.json` inside userData, outside account sync and settings exports.
There is no bundled DNS profile or device identifier.

Frame navigation to YouTube is separately filtered in `youtube-policy.cjs`:

- `youtube.com`/`www.youtube.com` live embeds for Claude FM, Lofi Girl and Chillhop.
- The pinned embeds `rFZHOHl-L8A` and `5yx6BWlEVcY`, plus the older `jfKfPfyJRdk` share link.

Both embed forms allow only `autoplay`, `start`, `rel`, `mute`, `modestbranding`,
`playsinline`, and `origin` query keys. Live embeds also require exactly one
allowlisted `channel`. Playlist, player API, loop, and all other query keys are
rejected. The URLs generated by `src/data/stations.ts` are covered by tests.

The existing HTTPS exception for `music.youtube.com` remains in the native
filter, but the web CSP does not allow it and the dashboard does not generate it.

Allowlisted embed subframes initiated by `app://custom-pomodoro` receive
`Referer: https://local.custom-pomodoro.desktop/`, the installed bundle identity
required by [YouTube](https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity). This does not change Origin,
XHR/media requests, other providers, or the frame allowlist. YouTube Music track
share links normalize to the same standard YouTube embeds; the full Music site
is not an embedded player.

Other YouTube frame URLs, including shortened and nocookie URLs, are blocked.
Player scripts/media are not treated as frame navigation. The web CSP may further
restrict which providers can be embedded.

Electron fuses disable RunAsNode, NODE_OPTIONS, and Node CLI inspection, and
require loading from ASAR with embedded ASAR integrity validation. The build
ad-hoc signs the app, runs `scripts/after-sign.cjs` to seal the full bundle with
its app id, and checks it with `codesign --verify --deep --strict`.

## Verification

`npm test` uses Node's built-in test runner for the YouTube rules, permission and
URL boundaries, status validation, attention deadlines and rate limits, native
lifecycle/menu callbacks, preload isolation, debug command handling, and the local
file handler. Multi-monitor tests cover placement, display changes, banner IPC,
replacement and destruction, and the banner-only preload. Tests stay under
`test/` with `.cjs` filenames so the parent Vitest suite does not collect them.

`npm run smoke` starts only the packaged binary, with a temporary profile inside
`dist/`, an initially hidden window, and a temporary loopback debugging port for
the renderer. It first verifies the bundle signature and all five requested
fuses. It waits for page readiness, records load events,
retries readiness checks, and gives each debug command 20 seconds. Failures name
the step and command. The main smoke run has a three-minute deadline; a separate bounded restart check follows it.

The smoke check verifies the rendered app, secure local origin, exact frozen
bridge, packaged JS/audio, security headers, notification permission, rejected
traversal paths, attention with an invalid and a valid kind, and native release.
It checks the packaged CSP for the YouTube/radio hosts and checks that actual
iframe requests block a YouTube watch page and all four reviewed query bypasses
while allowing the pinned embed through the native filter. It also checks cursor-display placement, the tray prefix, one banner per other
display, reduced-motion CSS, banner click behavior, and destruction on release.
It samples the app process tree with `ps -o pid,rss,%cpu`, waits for the process
count to return to baseline after release, and reports memory/CPU totals.
It then closes the native window and watches the
timer tick while that window stays hidden.

For machines with multiple displays, `npm run smoke -- --single-display-test`
checks a simulated one-display layout and requires zero banner windows.
`npm run smoke -- --banner-test` adds a simulated extra display backed by a real
banner renderer, which lets a one-monitor machine measure banner cost and click
behavior. These switches are honored only together with `--smoke-test`; neither
changes the real display configuration. Run smoke variants sequentially.

Only `--smoke-test` enables `__desktopSmokeState()` (read-only),
`__desktopSmokeClose()` (native close) and `__desktopSmokeQuit()` (app.quit), all
guarded by trusted-main-frame IPC and absent from mini windows. Normal launches
expose no smoke probes or smoke IPC. The close probe calls
`BrowserWindow.close()` so the test exercises close-to-hide with Node inspection
disabled. Renderer `window.close()` and CDP `Page.close` bypass the cancellable
native close event in this Electron build. The check reads native visibility:
with background throttling disabled, Electron keeps the DOM visibility state
`visible` even while the window is hidden ([Electron documentation](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility)).

It terminates its child process and removes the test profile. It does not use the
user's browser or installed app profile. The normal app enables no debugging
port. A real macOS desktop session is needed to launch Electron; no sandbox
bypass is configured or required by the script. This check does not prove live
stream playback or macOS notification presentation.

Icon masters live in `brand/`. Run `npm run build:icon` when the artwork changes;
it needs librsvg, ImageMagick and macOS iconutil. It regenerates web, tray, ICNS,
maskable and share-card assets. `build/Kitestring.icon` uses solid kite and line
layers, with the existing gradient background in icon.json.

## Rename compatibility

The bundle ID and `app://custom-pomodoro/` origin stay unchanged. At startup,
`identity.cjs` selects the existing Application Support folder named
`Custom Pomodoro` when present, or the historical package-name folder
`custom-pomodoro-desktop`, before the single-instance lock or storage access.
Fresh installs use `Kitestring`; explicit test profiles always take precedence.
The original package name remains an internal Keychain encryption identity during early
Electron startup; menus and windows use Kitestring once ready. This preserves
existing encrypted sign-in files as well as all IndexedDB stores and native state.

Install the current build with `../scripts/install-latest.sh`. It quits both
names, installs Kitestring.app, retires the old Applications bundle, refreshes
LaunchServices and the Dock, and verifies the running executable and web bytes.
The cloud bridge prefers the new Worker and falls back to the old fixed origin
on service/network failure. Authentication refusals do not trigger fallback.

## Earlier job 14 checks

Checked on 24 October 2026 for job 14: TypeScript and the web build passed.
The parent Vitest run passed 291 tests and skipped four optional tooltip browser
tests. All 59 desktop Node tests passed. `npm run dist` built the DMG;
`hdiutil verify`, the packaged signature check, and all five fuse checks passed.

Packaged smoke passed with both detected displays and with the single-display
simulation. It checked cursor-display placement, one banner on the other display,
real banner clicks, reduced motion, release cleanup, and zero banners in the
single-display run. The process count returned to its four-process baseline
after release in both runs. In the two-display run, total process RSS was
452.63 MiB idle, 577.23 MiB with the banner, and 480.52 MiB after release;
`ps` reported 0–0.1% aggregate CPU. The banner renderer was gone after release;
shared app/GPU memory did not return to the cold baseline.

See [the full job 14 report](MULTI-MONITOR-REPORT.md) for files, commands,
measurements and limits. Nothing was installed to Applications or committed.

The checks do not prove appearance over another app's full-screen Space,
physical monitor hot-plug behavior, live stream playback, or macOS notification
presentation. Display changes and full-screen exit ordering are covered by the
Node tests. The single-display run simulates the app's display list; it does not
disconnect a physical display. Login-item settings were not changed.

## Job 16 checks

See [the floating timer report](FLOATING-TIMER-REPORT.md) for the current checks,
the reproduced quit race, files and remaining device checks. The smoke now also
exercises native attention while the renderer is paused, one mini-window leader,
shared controls, both destroy-on-close paths, native sleep blocking and the
1280×540 takeover layout. It saves mini/takeover screenshots in `dist/` and runs
`scripts/restore-smoke.cjs`, which holds an IndexedDB transaction, resets and
immediately quits, then relaunches the same throwaway profile.

The native window and power calls follow Electron's
[BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) and
[powerSaveBlocker](https://www.electronjs.org/docs/latest/api/power-save-blocker)
APIs. Native notification support is distinct from successful delivery; the
[Notification API](https://www.electronjs.org/docs/latest/api/notification)
reports platform support and emits delivery failures.

### Live YouTube playback check

After `scripts/install-latest.sh`, relaunch the installed app with a loopback
debugging port, or launch your own disposable Chrome profile. Run:

```sh
node desktop/scripts/youtube-smoke.cjs --port 9332
# For a specific web tab in that disposable browser:
node desktop/scripts/youtube-smoke.cjs --port 9333 --url http://localhost:4747/
```

This opt-in network test selects all three actual station buttons, reads the
YouTube frame through CDP, and requires playing state 1, decoded media, and more
than one second of clock advancement. A loaded iframe alone never passes.
It stops music at the end. Never use a personal Chrome debugging endpoint.
