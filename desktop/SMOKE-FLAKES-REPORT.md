I found and fixed smoke-harness bugs in both paths. I did not find a production cooldown or parking bug. The exact trigger of the old second-banner timeout was not captured, so I cannot say whether that particular run involved occlusion, a display change, or something else.

The banner assertion confused native visibility with readiness. Electron 45’s macOS `IsVisible()` also checks whether the window is occluded. A banner can finish painting and be ordered onto the desktop while that live visibility value is false. The old assertion would keep waiting for it. This behavior is explicit in [Electron 45’s native window implementation](https://github.com/electron/electron/blob/v45.0.0/shell/browser/native_window_mac.mm#L455). A controlled unit regression reproduces the rejected, fully prepared banner by simulating native occlusion. An attempted live cover-window experiment did not make macOS report it occluded; I am not counting that experiment as a reproduction of the historical timeout.

The controller now records whether each banner passed `ready-to-show` and `showInactive()`. The smoke checks that state, the current display count, the banner renderer’s actual content, and the real banner click. It still fails if an expected banner never paints or is never shown. Native visibility remains in diagnostics. A separate regression covers the extra display disappearing between reminders: zero banners is correct when only one display remains.

The cooldown check now reads the actual main-process deadline and sends the next request once. It verifies acceptance before waiting for banners. Polling uses a monotonic clock. The old wall-clock polling fails a controlled clock-jump regression. I also reproduced three earlier snapshot-comparison failures: a native `hide` cleared attention during the sampling window while the immediate repeat was correctly rate limited. Rate-limit checks now compare the accepted native timestamp instead of requiring unrelated window and timer state to stay identical.

The parking failure was a native focus setup problem in the disposable peer app. I reproduced repeated “Blur destroys capture” failures and later captured “Native focus on the test app” failures. Renderer `document.hasFocus()` disagreed with native focus. One trace showed native focus arriving and disappearing about 15 ms later; another showed a ready peer that never became visible or active. The fixture could request focus before its native window was ready and unoccluded. Electron’s macOS `Focus()` returns immediately when `IsVisible()` is false. Nonactivating capture panels also borrow key focus without activating their owner, so asking an already-active peer to activate again is not a reliable blur action. These details are visible in [Electron’s focus and panel code](https://github.com/electron/electron/blob/v45.0.0/shell/browser/native_window_mac.mm#L372).

The peer now waits for `ready-to-show` and native visibility, follows the current workspace, and floats above ordinary windows. Each focus setup makes one fresh activation, awaits the native resignation event when necessary, and checks native application activity plus native window focus. The first capture now uses this controlled setup too. Enter, Escape, blur, text delivery, timer continuity, dashboard visibility and return to the peer are still asserted. No blind retry or longer timeout was added. The readiness, visibility and already-active-peer regressions fail with the old behavior and pass with the fixes.

A smoke-only trusted probe retains the last 40 attention decisions. Failures print that trace, the native window snapshot and the peer’s native event history. Normal and mini renderers do not get the probe. Temporary capture-panel instrumentation was removed after its trace showed the normal show/focus/close order.

Final checks passed:

- Three consecutive `npm run smoke` runs, with no code or package changes between them: 105.6 s, 60.3 s and 60.4 s. All used the two physical displays, exercised the actual banner click and passed the native parking and restart/restore checks. Logs: [run 1](dist/job27-smoke-verified-1.log), [run 2](dist/job27-smoke-verified-2.log), [run 3](dist/job27-smoke-verified-3.log).
- Desktop `node --test`: 115 passed, no failures or skips.
- `npx tsc -p tsconfig.app.json --noEmit`: passed.
- `npm run build`, run by desktop `npm run dist`: passed; the package signature and requested fuses also passed the smoke checks.
- `npx vitest run`: 488 passed, 16 existing tests skipped.
- `git diff --check -- desktop`: passed.

The earlier failing sequences were stopped at the first failure and are not counted toward these three passes. Each restart followed a concrete fixture change, rather than retrying unchanged code until it happened to pass.

Files changed:

- `desktop/attention.cjs`, `desktop/main.cjs`, `desktop/preload.cjs`: the existing cooldown constant and smoke-only diagnostics.
- `desktop/multi-monitor.cjs`: banner paint/show readiness metadata.
- `desktop/scripts/smoke.cjs`, `desktop/scripts/attention-smoke.cjs`, `desktop/scripts/cdp.cjs`: native cooldown, banner assertions and monotonic polling.
- `desktop/scripts/parking-smoke.cjs`, `desktop/scripts/focus-peer.cjs`: the controlled native peer fixture.
- `desktop/test/cdp.cjs`, `desktop/test/multi-monitor.cjs`, `desktop/test/smoke-environment.cjs`, `desktop/test/smoke-preload.cjs`: regressions and probe isolation.
- `desktop/SMOKE-FLAKES-REPORT.md`: this report.

The icon PNGs were already modified when I started; packaging regenerates them, and I did not restore them to HEAD. I left the other existing work alone. No dependencies were added, and nothing was committed, installed or deployed.

Still unconfirmed: the exact environmental trigger of the original second-banner failure. The incorrect readiness assumptions are fixed and covered; that does not prove which one affected the old run.
