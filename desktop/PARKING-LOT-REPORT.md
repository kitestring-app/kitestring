The parking lot is built for the web and Mac app. P and the timer button open a one-line capture field. Enter saves, Escape cancels, and focus returns to the previous control. Capturing does not pause or reset the timer. The running Focus dashboard shows only the open count.

Break reminders, cycle completion, the idle/break count chip and Notepad provide review. Each thought can become a task, be marked done or stay open for later. Notepad can also show finished items. The store keeps up to 500 items, removing the oldest done items first, and participates in local persistence, backups and the existing account sync.

On Mac, ⌥⌘P opens a separate 520×64 capture panel on the cursor display. Its restricted preload accepts only save and close. Main-process IPC checks the sender and frame, limits input to 500 characters and strips control characters. Enter, Escape and blur destroy the window. Settings reports shortcut registration failure.

The packaged smoke run confirmed that capture does not raise a hidden dashboard or hide a visible one. Enter and Escape returned keyboard focus to a separate disposable test app in both cases. IPC delivered the text, the timer stayed running, and capture renderers were released. The checks used temporary profiles and did not inspect the user's apps or browser tabs.

These checks passed:

- App and Worker TypeScript checks, and `npm run build`.
- `PARKING_BROWSER=1 npx vitest run`: 346 passed; four unrelated tooltip browser tests remained opt-in and skipped.
- Desktop `node --test`: 105 passed.
- Desktop `npm run dist` and `npm run smoke`, including the existing restart/restore check.
- `git diff --check`. Shared capture/review screenshots and the native capture screenshot were also inspected.

The files changed for this job are:

- Data: `src/lib/parked.ts`, `src/state/parked.ts`, `src/state/parked.test.ts`, `src/lib/backup.ts`, `src/lib/backup.test.ts`, `src/lib/sync.ts`, `src/lib/sync.test.ts`, `worker/index.ts`, `worker/index.test.ts`.
- Shared UI and integration: `src/App.tsx`, `src/desktop.d.ts`, `src/ui/FocusView.tsx`, `src/ui/ParkCapture.tsx`, `src/ui/ParkingLot.tsx`, `src/ui/ParkingLot.css`, `src/ui/parking.browser.test.ts`, `src/ui/panels/NotepadPanel.tsx`, `src/ui/timer/TransitionScreen.tsx`, `src/ui/settings/AboutTab.tsx`, `src/ui/settings/ExtrasTab.tsx`.
- Mac capture and verification: `desktop/main.cjs`, `desktop/preload.cjs`, `desktop/parking.cjs`, `desktop/parking-preload.cjs`, `desktop/test/parking.cjs`, `desktop/test/preload.cjs`, `desktop/scripts/smoke.cjs`, `desktop/scripts/parking-smoke.cjs`, `public/park.html`, `public/park.css`, `public/park.js`.
- Documentation: `docs/PARITY.md` and this report.

The extra files support the job's capture controls, review surfaces, native bridge, settings and verification. Existing uncommitted work was preserved. No dependencies were added, and nothing was committed or deployed. The app was packaged but not installed. Electron's package entry point automatically fetched its local development binary during the first focus-peer check; the smoke script now uses the existing binary directly. Generated tracked icon changes from packaging were restored. No requested feature work remains unfinished.
