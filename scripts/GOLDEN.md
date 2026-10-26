# Desktop visual guard

Run from the repository root with Node 22 or newer and Chrome/Chromium installed.
Set `CHROME_BIN` if Chrome is outside the usual macOS/Linux locations. No new
packages are needed. The script launches its own headless Chrome, disposable
profile, and Vite server on a free loopback port. It never connects to your
browser or the installed Mac app. Processes and temporary profiles are cleaned
up on success, failure, Ctrl-C, or SIGTERM.

```sh
node scripts/golden.mjs capture .agents/golden/candidate
node scripts/golden.mjs compare .agents/golden/base .agents/golden/candidate
```

Capture requires an empty directory so it cannot silently replace a baseline.
There are **100 PNGs**: five looks, ten views, and 1280x820 / 1440x900 at scale 1.
Paths look like `1280x820/glass/focus-reentry.png`. The ten views are Home,
Focus idle, Focus running, Focus re-entry, Ambient, Settings Themes, Settings
Clock with flip enabled, Settings Timer, Tasks, and Sounds. The Clock settings
capture scrolls to the flip control and colour previews; other views start at
the top. Every scene gets fresh storage and the same tasks, pinned next action,
cue, reward, and paused two-layer sound mix. Running and re-entry show 20:42;
idle shows 25:00. Clock time is 09:24 UTC on 26 October 2026.

The harness freezes Date and a seeded random generator before app code runs,
fixes locale/timezone/viewport, enables reduced motion, disables wallpaper
motion, uses software compositing/rasterisation with LCD text disabled,
suppresses CSS animations/transitions and the text caret, waits for
fonts/images/layout and native scrollbar fade after scrolling, then requires
three consecutive byte-identical frames. Raster work is serial and compositor
stages finish before drawing.
It adds no layout masks, pixel tolerance, or app-source hooks. A manifest records
the fixture, browser/platform, image hashes, and blocked external origins.

Comparison decodes every PNG through canvas in the same isolated Chrome and
compares all RGBA channels at zero tolerance. Every image reports its changed
pixel count and bounding box (`null` means no difference). Dimensions, missing
images, and extra images also fail. Changed images get red overlays under the
candidate's `diffs/` directory, plus a machine-readable `diffs/report.json`.
The generated `diffs/` directory is excluded from future comparisons.

To allow an intended change, quote a relative image glob. Repeat `--allow` for
more than one pattern:

```sh
node scripts/golden.mjs compare .agents/golden/base .agents/golden/candidate \
  --allow '*/glass/settings-themes.png' \
  --allow '*/glass/settings-clock.png'
```

`*` matches inside one path segment, `**` crosses directories, `**/` also matches
zero directories, and `?` matches one non-slash character. Patterns match the
whole relative PNG path. Allowed images are still measured and get overlays.
The exit status is 1 if any unallowed image differs or an input fails validation.
Allows cover entire images, so inspect every changed bounding box and overlay
against the job's owned area before accepting one. Keep the original baseline.

For a stability proof, capture two empty directories and compare them without
allows. All 100 counts must be zero; the manifest hashes must also agree.

Use the same Chrome version, operating system, architecture, and installed fonts
as the baseline. Font rasterisation can differ across machines. This guard covers
the shared desktop renderer using an inert signed-out native bridge. It does not
verify Electron's native windows, fullscreen, menu bar, IPC, sound, or account
transport. External network requests are blocked, including Unsplash thumbnails;
default wallpapers here use local CSS and bundled fonts. No app assets are added.
