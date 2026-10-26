# Job 34: Calm foundation

Implemented on `feat/calm-foundation`, based on `ef352ac`. Changes are uncommitted. Browser and installed-Mac verification are incomplete for the reasons below.

## Changes

- Added Calm and Strong reminder presets with a durable, once-only device restore point, exact field restoration and customised labels. Calm silences legacy and per-event sounds plus ticking. Both preserve Hard mode, lengths, appearance, accessibility, ambient mixes and Mac-only preferences.
- Fresh initialization requires successful storage reads and an empty profile. Existing data, remote settings, delayed edits and read errors prevent an automatic Calm write. Failed snapshot/apply transactions retain the current setup and restore point. Concurrent edits win over stale preset publication.
- Quiet sessions never arm reminder channels. Switching to Calm cancels active speech, pending companion/native alarms, attention, banners and repeats, including a future auto-run alarm after Stop sound. Native false/rejected arm results produce an inline status while the ticker still settles expiry. Native disarm also closes its notification.
- Added optional next-action text, task/subtask selection and a why note beside Start. Task selection copies its text, so deleting the source leaves the saved action. Neither field gates starting. One validated intent document syncs through client, Worker and the nine-entry Mac bridge. Reserved cue/reward fields survive edits with no new UI. Local stamps advance monotonically; equal server timestamps preserve the server copy. Old clients uploading their eight keys leave intent intact.
- Extended v1 backups additively. A golden v1 import/export/re-import preserves raw history, settings, tasks and notes. Missing intent preserves the independent current document; an explicit empty intent clears it. Restore excludes concurrent sync until its transaction and stamps commit.
- Removed normal score/streak displays and the dashboard streak toggle, retaining raw history, legacy preferences and compute functions. Strong takeover has Dismiss and Escape plus its persistent Settings switch. Interruption capture remains optional. 25/5 remains one preset. Fresh ambient playback is silent.
- Replaced unsupported sound-efficacy copy in the existing Sounds panel and research page. No slice 2 flows or slice 3 evidence page were added. Updated SPEC and parity documentation for real optional accounts/sync and this slice.

## Checks

| Check | Command | Result |
| --- | --- | --- |
| App types | `npx tsc -p tsconfig.app.json --noEmit` | Pass |
| Worker types | `npx tsc -p worker/tsconfig.json --noEmit` | Pass |
| Full serial unit suite | `npx vitest run --no-file-parallelism` | Pass: 697 tests, 69 files. 24 opt-in tests in 8 files skipped. |
| Desktop suite | `cd desktop && node --test` | Pass: 148 tests |
| Production build | `npm run build` | Pass |
| Whitespace | `git diff --check` | Pass |
| Disposable Chrome | `CALM_BROWSER=1 npx vitest run src/ui/CalmFoundation.browser.test.ts --no-file-parallelism` | Blocked before browser launch: `listen EPERM: operation not permitted 127.0.0.1` |
| Installed Mac | `scripts/install-latest.sh` | Not run: its installation/Downloads writes are outside the sandbox's writable paths. |

C1, C2, C6 and C7 automated coverage all ran in the passing full serial suite above:

| Gate | Fixtures and result |
| --- | --- |
| C1, V1/V2 | `src/state/calmFoundation.test.ts`: fresh/existing/empty profiles, custom lengths, explicit false, delayed hydration, remote legacy settings, failed reads, snapshot/apply failure, crash/relaunch, once-only restore points, concurrent edits and customised labels all pass. |
| C2, V3 intent subset | `src/lib/sync.transport.test.ts`, `src/lib/sync.test.ts`, `worker/index.test.ts`, `desktop/test/cloud.cjs`: nine dirty keys, equal stamps, 401/413, invalid shape, whole-document transport and old eight-key uploads all pass. |
| C6, V13 | `src/lib/backup.calm.test.ts`, `src/lib/fixtures/backup-v1.json`, existing backup tests and the delayed-pull import test: golden v1 round-trip, missing/empty intent, validation, preserved history and concurrent-sync exclusion pass. |
| C7, V11 | `src/state/quietSession.test.ts`, `src/audio/companion.test.ts`, `desktop/test/native-services.cjs`: web/native bridge full block, break, pause, last-moment cancellation, late companion requests, repeats, false/rejected native arms and saved-alarm disarm/relaunch all pass. These are simulated channel/service tests, not installed-app observations. |

## Remaining verification

Run the opt-in disposable-browser test where loopback listeners are allowed. Then build/install with `scripts/install-latest.sh` in an environment allowed to write the installation paths, and verify the actual Mac app, quiet relaunch/sleep, notification/banner behavior and audible silence. No own-browser or desktop control was used here. Source/unit results do not establish those live outcomes, so the live release checks remain open.

No dependencies were added. Tooling used an unchanged temporary copy of the existing dependencies because the worktree's original dependency symlink points outside the writable sandbox. The original symlink was restored after verification. The pre-existing `.agents/jobs/34-calm-foundation.md` and `.agents/plan/` inputs were left untouched.

## Files touched

- `SPEC.md`
- `desktop/cloud.cjs`
- `desktop/native-services.cjs`
- `desktop/test/cloud.cjs`
- `desktop/test/native-services.cjs`
- `docs/CALM-FOUNDATION-REPORT.md`
- `docs/PARITY.md`
- `public/research.html`
- `src/App.tsx`
- `src/lib/backup.calm.test.ts`
- `src/lib/backup.ts`
- `src/lib/fixtures/backup-v1.json`
- `src/lib/intent.ts`
- `src/lib/store.ts`
- `src/lib/sync.transport.test.ts`
- `src/lib/sync.ts`
- `src/main.tsx`
- `src/state/calmFoundation.test.ts`
- `src/state/intent.test.ts`
- `src/state/intent.ts`
- `src/state/parked.ts`
- `src/state/quietSession.test.ts`
- `src/state/settings.ts`
- `src/state/timer.ts`
- `src/ui/AmbientTimer.browser.test.ts`
- `src/ui/AmbientTimer.test.tsx`
- `src/ui/CalmFoundation.browser.test.ts`
- `src/ui/ClockView.tsx`
- `src/ui/FocusView.tsx`
- `src/ui/NextAction.css`
- `src/ui/NextAction.test.tsx`
- `src/ui/NextAction.tsx`
- `src/ui/panels/SoundsPanel.tsx`
- `src/ui/settings/ClockTab.tsx`
- `src/ui/settings/StatsTab.tsx`
- `src/ui/settings/TimerTab.tsx`
- `src/ui/timer/TransitionControls.test.tsx`
- `src/ui/timer/TransitionScreen.tsx`
- `worker/index.test.ts`
- `worker/index.ts`
