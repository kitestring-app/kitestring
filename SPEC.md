# Kitestring spec (v1)

A free, local-first focus dashboard with Flocus Plus-level features. No paywall or tracking. Optional sign-in syncs selected data between devices.
Runs at `localhost:4747` (companion), on Cloudflare Workers, and as an Electron Mac app.

## Goals
- Everything Flocus Plus offers that makes sense offline, free.
- Data stays in IndexedDB unless the user exports it or signs in and chooses account sync. Mac credentials stay in the main process using safeStorage.
- YouTube only via allowlisted channel live embeds.

## Non-goals (v1)
- Payments and analytics.
- Bundling third-party media whose license forbids redistribution.

## Stack
Vite + React + TypeScript, no UI kit, no state library (one store module with `useSyncExternalStore`).
Minimal runtime deps (react, react-dom). Persistence: IndexedDB via a ~60-line wrapper.

## Layout (mirrors Flocus)
- Full-bleed theme background per dashboard mode: **Home** (clock + greeting), **Focus** (timer), **Ambient** (clean clock).
- Focus view: "What do you want to focus on?" (current task), mode tabs FOCUS / SHORT BREAK / LONG BREAK, session tallies, big timer, controls: play/pause, reset segment, Picture-in-Picture.
- Bottom-left dock: Tasks, Sounds & Music, Notepad. Top-right: settings, fullscreen, dashboard mode switch.
- Settings drawer tabs: Themes, Clock, Focus Timer, Stats, Quotes, Extras, Data (replaces Account), About.

## Features
1. **Timer modes**: Pomodoro, Countdown, Stopwatch (count-up), Animedoro (focus = Pomodoro length, long break = "watch time"), 52/17. Task-ETA mode (timer follows the current task's estimate).
   Lengths editable; long break every N sessions; auto-start next segment; reset current segment only; partial credit (time counts even if reset/closed).
   Alerts: chime choice + volume, browser notification. End chime scheduled on the AudioContext clock (background-tab safe).
2. **Timer styles**: Default, Flip, Progress Bar, Gauge, Dot Matrix, Pie; show/hide numbers; optional progress bar under timer. Sizes Small/Regular/Huge. Fonts: several local/system stacks.
3. **Tasks**: unlimited, subtasks (parent shows 0/2 and summed ETA), emoji, colour tags, ETA (5–120 min), drag reorder, duplicate, ⋯ menu, progress bar, total time + estimated finish, confetti when all done. Current task feeds the focus header.
4. **Sounds**: layerable mixer, per-sound volume + master, save combos. Procedural (Web Audio): white/pink/brown noise, binaural alpha/beta/gamma/theta/delta, 16 Hz mid-band pulse, room fan, AC hum, rain (synthesized), clock tick. Recorded CC0 loops where license is clean.
5. **Music**: Stations (Claude FM, Lofi Girl, Chillhop via `embed/live_stream?channel=`), custom URLs (Spotify, Apple Music, Amazon Music, YouTube) with up to 5 favourites.
6. **Notepad**: autosaved, word/character count.
7. **Themes**: per dashboard mode; library by category (Gradients & Colors — generated; Animated — CSS; Scenic/Nature/Urban — curated Unsplash CDN links, not bundled); custom image upload (stored in IndexedDB); randomizer; apply to all modes; disable animated themes.
8. **Clock**: 12/24 h, seconds, flip clock, size, dynamic greetings + display name.
9. **Stats**: Today/Week/Month/3M/6M/1Y/All; plain daily or Monday-based weekly records of focused time (including partial sessions) and recorded task/subtask completions. Neutral empty periods; no graded calendar. Hide stats in Extras removes entry points without changing the timer or saved history; the choice persists in settings backups and sync.
10. **Compatibility history**: raw sessions and legacy score/streak functions stay available for old data and backups. Score and streak are absent from normal stats and dashboard/return flows.
11. **Quotes**: categories, show in Focus and/or Home.
12. **Extras**: clear mode (hide UI when mouse idle/outside), prevent sleep (Screen Wake Lock), default settings tab, theme randomizer, reduce motion.
13. **Data**: export/import JSON, reset. Keyboard shortcuts (Space, R, N, T, M, S, F).

## Quality gates
- `npm run build`, `npx tsc -p tsconfig.app.json --noEmit`, `npx vitest run --no-file-parallelism`, and `cd desktop && node --test` clean. Legacy score functions retain their compatibility tests.
- gitleaks + trufflehog on full history; `npm audit` clean before any public release.
- Works offline after first load; no third-party requests except user-chosen embeds and theme images.

## Calm foundation (slice 1)
- Calm changes only takeover, speech, bring-to-front, notifications, interruption prompts, legacy and per-event alert sounds, ticking, auto-run and countdown repeat. Strong applies the corresponding reminder defaults. Neither changes Hard mode, lengths, themes, accessibility or ambient mixes.
- Try Calm commits the original reminder fields once, on this device, before applying the patch. Restore writes back those exact fields. Later edits to preset fields show “Calm, customised” or “Strong, customised”. Restore points and preset labels stay outside cloud sync and backups.
- Only a successfully read, empty IndexedDB profile starts Calm. Any existing profile data, incoming remote settings, pre-hydration edits, read failures or volatile storage prevents fresh initialization. Existing profiles keep their settings.
- Calm sessions and pauses produce no automatic reminder, takeover, interruption prompt, ticking, companion announcement, native alarm, attention, banner or repeat sound. Strong takeover has immediate dismissal and a persistent Settings switch. Interruption capture is optional and never gates resume.
- One optional next action and optional why note sit beside Start. A selected task/subtask copies its text, so deleting a task does not lose the pin. Starting requires neither field. The intent document `{ action, why, cue?, reward?, rev, updatedAt }` persists and syncs as one key using whole-document last-write-wins; cue/reward are optional fields in the same editor (slice 2b). Equal timestamps keep the server copy; local write stamps advance monotonically. V1 backups accept the key being absent and preserve any current independent intent; explicit empty documents clear it. Exports that include Focus data include a persisted intent.
- 25/5 is one editable preset. Fresh ambient playback stays silent. Copy describes choices without treatment, dopamine or attention-measurement claims.

## Start cues, parking review and rewards (slice 2b)
- Tiny first block sits beside the normal Start controls: 5 minutes selected initially, 10 minutes and custom (1 to 1440 minutes) available together. It freezes a one-off duration without changing mode lengths or task ETA. Only a finished block explicitly started as tiny counts, including a recovered missed end. Skips, resets, pauses, opens and gaps do not count or reset the two-block tally. Two finished tiny blocks unlock one optional usual-length offer. Accepting or dismissing it sticks on this device. Normal Start always remains available.
- The pinned action editor includes an optional one-line if-then cue and a self-chosen small reward, each up to 500 characters. They persist and sync with action and why as one intent document using whole-document last-write-wins. The cue appears near Start and is snapshotted with the saved re-entry context. A remote document replacement cannot silently save an older editor draft onto a new action.
- Parking review is opt-in: never automatically (default), end of a focus block, or end of a session. A session ends at explicit Stop, a completed cycle's final break, a completed single-session countdown, or explicit stopwatch finish. Review snapshots the existing open thought IDs and offers Keep / Make a task / Drop, plus Review later. Keep leaves the thought open for another review; Drop has the existing short Undo. New captures wait for a later snapshot. Cursor, boundary choice and deferral persist only on this device. Conversion, item status and cursor commit together.
- Parking review uses the existing recovery selector after settled end, re-entry and gap return. It never interrupts running focus. Review commands guard the review/item identity, segment and intent revision so a stale card cannot act on a newer session.
- Finish action is an explicit button independent of timer completion and task completion. It clears the finished pin and shows the chosen reward plainly until dismissed, with a durable device-only acknowledgement. Finishing without a reward needs no extra step. Breaks and rest remain available regardless of completion.
- Intent cue/reward fields export with Focus data and import as a unit. Version 1 files remain compatible. Old v1 backups without intent preserve the current independent intent. Tiny-start progression, review cursor/preferences and reward display acknowledgement stay out of cloud sync and backups. The running tiny marker stays with the existing timer snapshot.
- Shared source serves both web and Mac. All five looks use the same controls and tokens; long content scrolls inside the focus area on smaller windows. No new runtime dependency or runtime network request is added.

## Portable settings file (format v2)
- Settings > Your data has Export settings… and Import settings…. Export opens a section picker. Settings is always included; Sounds and mixes (mixer/radio), This device’s options (devicePreferences/floatingGlass), Focus data (tasks/focusPick/stats/intent/parked/notes and the unlocked timer), and Images are optional. Full backup selects sounds, device and focus together; images remain opt-in.
- Files download as `kitestring-settings-YYYY-MM-DD.json`. The envelope exports `format: "kitestring-backup"` and imports both it and `custom-pomodoro-backup`, adds `version: 2` and a `sections` array, and retains `exportedAt`, `data`, and optional `images`. Include my name is off by default; exported settings use the default display name unless enabled. Other user content can contain personal text.
- Import validates the whole file, then previews its date, version, sections, task/session/parked counts, notes character count and image count. Every present section starts ticked and can be unticked, including Settings. Only selected sections apply. Missing keys preserve existing values. Version 1 files retain their migrations and restore behavior; their sections are inferred. Undated files say the date was not recorded.
- Sync account/metadata, Calm restore state, returnActivity, tinyStarts, parkingReview and rewardMoment never export or import. A locked Hard mode timer never exports and cannot be overwritten by import. Device options stay outside cloud sync even when explicitly moved in a file.
- Import pauses sync and uses the existing atomic transaction, metadata stamps and live-store rollback. Images retain raster validation, 5 MB each / 10 MB total within a 20 MB file, decode/resize and merging without deleting unrelated uploads.
- `STORE_CLASS` in `src/lib/backup.ts` classifies every persistent store as shared, device, content or internal and assigns its section. Source enumeration fails for an unclassified store. A generated every-leaf settings test checks export/import persistence against defaults; schema-shaped merging rejects unknown input fields while sanitizer overrides retain future default-defined fields.
- Web and Mac use the same picker, preview, validation and transaction code. Native powers remain native; this adds no runtime dependency or network request.

## Timer display (slice 3)
- Remaining is the default. Elapsed counts active time up, including overtime; Stopwatch stays a count-up. Timer settings offers Remaining / Elapsed / Hidden. Tapping the timer face cycles the same setting.
- Hidden removes the timer digits and progress faces from Focus, Ambient, Document PiP, the native floating timer, tab title, menu bar and transition reminders. Segment and running/paused status remain visible. Automatic screen-reader time updates stop; a manual timer query remains available. Recovery cards keep their choices without showing the current recorded duration.
- The choice is part of shared settings, syncs, persists and travels in settings exports and backups. Existing profiles and v1 files without it use Remaining. All five looks share the same controls; hidden faces unmount their animations.

## Optional breathing inside breaks (slice 3)
- Short and long breaks offer a silent, optional 1 or 5 minute guide in the existing card slot. In/out and cyclic sigh (two short inhales, one long exhale) offer gentle or slower pacing without holds. Static guidance respects system and app reduced motion. Hidden display removes the guide countdown.
- Start, Pause and Skip remain available. Pause preserves the guide behind higher-priority recovery content; Resume restores it. Active guidance stays visible in Clear mode. Close or Escape leaves without changing the timer, awarding anything or writing a new record. Segment changes, navigation and reload discard the guide. Copy describes the controls without efficacy claims. Shared source serves web and Mac.

## Evidence page (slice 3)
- About and footer link to a bundled, static “Why it works this way” page. Each feature has a conservative evidence-strength link, sources and population/intervention limits. None is rated strong; no app efficacy is inferred from other programs.
- Explanations work offline from built files, without scripts, fonts or network requests. External papers are optional. System light/dark and reduced motion are respected. Both entry links open a modal reader inside the app while the dashboard, timer and audio stay mounted. The reader embeds the same static document with scripts disabled; Close, Escape and its return links restore the dashboard.

## Task estimates and recorded time (slice 3)
- Task ETA is an optional whole-task guess, entered through preset minutes or a custom number. Completed tasks show the guess beside saved active focus time, including partial blocks and subtask work. Pauses, breaks and gaps are excluded. Missing guesses and missing recorded work are labelled plainly.
- The estimate picker and completed rows offer up to three similar completed tasks, matched locally by title, with their guesses and recorded active time. There is no score or judgement. These records use the existing task ETA and raw history, so old data, v1/v2 backups and mixed-version sync retain them without new keys.
- Hidden display removes the task summary's live remaining-time and finish-time projection. Completed records remain readable. Shared controls serve web and Mac across all five looks.

## Sufficient-finish compatibility (N1a)
- Intent and its immutable session context accept one optional single-line `sufficientFinish` (500 characters). No visible control is enabled in this contract change.
- Whole-document LWW stays unchanged. A legacy upload/import omitting the field preserves it only for the identical action; a replacement action drops it. Upgraded clients clear with an explicit empty string. Equal sync timestamps keep the server document. Focus backups retain every intent leaf; absent intent preserves the current pin.

## Sufficient finish (N1b)
- Optional details in the pin editor offers one sufficient-finish line. Blank adds no work-view content. Start, Finish action and task completion remain independent; there is no grade or proof step.
- Enter on an input and Escape save and return focus to Edit. A rejected or conflicting transaction retains the draft and editor, with retry or Use saved action. Only a committed, revision-guarded IndexedDB write closes the editor; unavailable storage keeps the draft.
- The saved line appears as plain text beside the action and in the interrupted context. All five looks, Hidden time, phone widths and web/Mac share these controls. The bundled evidence page labels the adaptation weak and untested. Practical benefit and pressure remain unvalidated without voluntary observation.

## Transition allowance compatibility (N2a)
- A leaf task accepts an optional integer `transitionAllowanceMin` from 0 to 240. Null explicitly clears it; omission by a legacy writer/import preserves a matching leaf's allowance by stable task id. Deleted tasks stay deleted; a task gaining children loses its own allowance.
- Focus backups, shared task sync and the Worker retain the field without a new key or changed whole-document LWW. Equal timestamps keep the server copy. No control is enabled in this contract change, and estimates, ETA-mode duration and recorded focus stay unchanged.
- Upgraded task uploads identify writer version 1 in the existing sync request. Legacy uploads retain valid stored leaf allowances even if an old client carries an obsolete value; parent observations always clear. Known-writer documents still use the existing whole-task timestamp rule. Null task rows are removed before extension merging, matching the task store's legacy migration.

## Optional transition allowance (N2b)
- The leaf task's estimate picker offers a collapsed transition allowance, blank or integer 0-240 minutes. Blank clears explicitly; zero remains visible. A static line labels Work guess and transition allowance separately, including Hidden time. No parent rollup or finish projection includes the allowance.
- Set and Enter close only after a guarded durable save. Invalid values, changed tasks and unavailable/failed storage retain the draft for retry or cancel. The picker ignores queued scroll events without position changes; real outside scrolling still closes it. Hidden disclosure controls stay outside the Tab cycle.
- Work estimate, ETA-mode length, recorded active-time comparisons, credited time and completion stay unchanged. Shared source serves web and Mac in all five looks and at phone widths. The bundled evidence entry calls this optional app adaptation weak and untested.

N3a: an authorized Stop can retain a device-local attempt token. An optional durable, idempotent label records that attempt as deliberately stopped without changing raw time, tasks or the pin. Undo/deletion removes only the label. Hard mode still requires its existing held end path. Expiry and Finish create no annotation. Labels travel only in selected Focus backups, never cloud sync; old files preserve omitted labels. No controls are added in this contract PR.

N3b: ordinary Stop remains independent of annotation. After an authorized focus Stop, an optional card beneath existing recovery/reward messages offers “Record as deliberately stopped.” Close durably dismisses that attempt across recovery/navigation/reload without removing an existing label. Undo and the paginated Log label list remove only labels, preserving raw focus credit, tasks and the pin. Hide stats hides both label entry points; Hidden keeps the static label without live time. The five looks share the same controls on web and Mac. Labels remain device-local and included only in Focus data exports. Practical benefit remains unvalidated.
