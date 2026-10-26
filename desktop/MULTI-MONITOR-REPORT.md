# Job 14: multi-monitor reminders

Implemented and checked on 24 October 2026. Changes are in the working tree. I did not commit or touch Applications. Job 12 was not running when I built or ran smoke. I preserved the existing attention-policy edits and unrelated work.

The menu-bar timer now starts with 🎯 during focus and ☕ during breaks. Status sanitising still removes control and bidi override characters and caps the text at 64 characters.

Accepted reminders center the dashboard on the cursor's display before showing it. If it was in full screen, the alert waits for full-screen exit; release during that wait cannot show it afterward. Other displays get a silent 64px banner. Clicking a banner opens the dashboard on that display and destroys all banners. Release, hide, timeout and replacement also destroy them. Display listeners exist only while a reminder is active. Added, removed and resized displays are handled without polling.

The banner uses static HTML, CSS and a small external script, with no React or audio. Its single pulse lasts 2.4 seconds and respects reduced motion. Its isolated, sandboxed preload exposes only frozen `banner.open()`. IPC checks the live banner window, its main frame and the exact local banner document. Navigation, popups and webviews are locked down.

Files changed for this job:

- `desktop/main.cjs`, `desktop/multi-monitor.cjs`, `desktop/banner-preload.cjs`
- `desktop/scripts/smoke.cjs`
- `desktop/test/multi-monitor.cjs`, `desktop/test/lifecycle.cjs`, `desktop/test/security.cjs`
- `public/banner.html`, `public/banner.css`, `public/banner.js`
- `src/ui/TitleSync.tsx`
- `desktop/README.md`, this report, and the new `docs/PARITY.md`

The parity document is an additive file outside the job's main ownership area, required by the project's standing parity rule. No dependencies or third-party assets were added. I restored the generated source PNGs after packaging to avoid leaving timestamp-only binary changes.

Checks completed:

| Check | Result |
| --- | --- |
| `npx tsc -p tsconfig.app.json --noEmit` | Passed |
| `npm run build` | Passed, also run by desktop packaging |
| `npx vitest run` | 291 passed; four optional tooltip browser tests skipped by their existing opt-in setting |
| `npm test --prefix desktop` | All 59 passed |
| `npm run dist --prefix desktop` | Passed; built the arm64 DMG |
| `hdiutil verify` on the DMG | Passed |
| `npm run smoke --prefix desktop` | Passed with two detected displays and one banner |
| `npm run smoke --prefix desktop -- --single-display-test` | Passed with a simulated one-display layout and zero banners |
| Packaged signature and five Electron fuses | Passed in both smoke runs |
| Syntax and whitespace checks on the changed desktop code | Passed |

The packaged two-display check verified both banner labels, the banner-only frozen bridge, no renderer Node access, reduced-motion CSS, a real banner click, dashboard placement on the clicked display, and cleanup on release. Both smoke runs also checked the existing local protocol, YouTube filtering and hidden timer tick. Placement, IPC rejection, display changes, replacement, hide, timeout, full-screen exit ordering and stale callbacks are covered by Node tests.

I sampled only the throwaway app and its child processes with `ps -o pid,rss,%cpu`. RSS below is the sum for those processes; CPU is the lifetime average reported by `ps`, sampled after the pulse ended.

| Display layout | State | Processes | RSS | CPU |
| --- | --- | ---: | ---: | ---: |
| Two detected displays | Idle before attention | 4 | 452.63 MiB | 0.0% |
| Two detected displays | One banner showing | 5 | 577.23 MiB | 0.1% |
| Two detected displays | After release | 4 | 480.52 MiB | 0.1% |
| Simulated single display | Idle before attention | 4 | 445.94 MiB | 0.0% |
| Simulated single display | Attention, no banner | 4 | 471.14 MiB | 0.0% |
| Simulated single display | After release | 4 | 463.16 MiB | 0.0% |

The banner renderer was destroyed and process count returned to baseline in both runs. Shared app/GPU caches remained above the cold RSS baseline; this is not a claim of zero retained memory. No banner renderer or banner display listeners remain idle.

Raw smoke output is in the ignored build folder: `desktop/dist/job14-native.log` and `desktop/dist/job14-single.log`. Each smoke process exited and its temporary profile was removed.

I did not physically unplug a monitor or inspect another app's full-screen Space. Those display-change and window-flag paths have automated coverage, not a manual visual pass. The single-display check simulates the app's display list. The four optional tooltip browser tests belong to the concurrent tooltip job and were not part of this job's packaged checks.
