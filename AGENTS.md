# Working on Kitestring (brief for coding agents)

Read SPEC.md first. This is a free, local-first Flocus-style focus dashboard: Vite + React 19 + TypeScript 6, no UI kit, no state library.

## Hard rules
- Only edit the files your task names. If you truly need a change elsewhere, keep it additive (new exports) and say so in your report.
- No new runtime dependencies. Dev dependencies only if unavoidable, and say why.
- `npx tsc -p tsconfig.app.json --noEmit` and `npm run build` must pass. `npx vitest run` must pass; add tests for non-trivial logic.
- `erasableSyntaxOnly` + `verbatimModuleSyntax` are on: no `enum`, no `namespace`, use `import type` for types.
- No network calls at runtime except user-chosen embeds (YouTube/Spotify/Apple/Amazon) and Unsplash theme images. No analytics, no external fonts.
- Never commit secrets, tokens, emails or personal paths. Assets you add must be CC0 or allow redistribution; record source + license in `public/LICENSES.md`.
- Do not commit; leave changes in the working tree. The lead reviews and commits.
- Never drive or request access to the user's own browser or desktop (no CDP to their Chrome, no computer-use). Verify with tests, or a headless Chrome you launch yourself with a throwaway --user-data-dir.

## Web and Mac app parity (standing rule)
One codebase serves the web app (localhost companion + Cloudflare) and the Mac app (Electron). The Mac app is the more powerful one, on purpose.
- Shared features are built once in `src/` and must work in BOTH in the same change.
- Never hold the Mac app back to the browser's limits. If a browser API is missing or weaker in Electron (Document PiP, wake lock, notifications, focus stealing, multi-monitor), implement the strongest native version through a `window.desktop.*` bridge method (declared in `src/desktop.d.ts`, implemented in `desktop/`). Prefer the bridge over the web API whenever `window.desktop` has it.
- Never show a browser-limitation message ("the browser didn't allow X") in the Mac app. If it appears there, that's a bug.
- Mac-only powers (menu bar, bring to front, multi-monitor banners, native floating window, login item, native alarms) stay Mac-only. Do NOT build web versions of them or add web-only workarounds; just keep the web app working without them.
- Keep `docs/PARITY.md` current: one row per feature, Web and Mac columns, "Mac only" where it applies, and the test that covers it. Update it in the same change as the feature.

## Testing
- `npm run test:browser` requires Chrome and the existing desktop dev dependencies (`npm --prefix desktop ci`, then `node desktop/node_modules/electron/install.js` for the Electron 45 executable), enables all twelve opt-in browser suites, runs them serially with a private TMPDIR, and launches only disposable headless Chrome profiles; set `SHOTS_DIR` to keep runner screenshots in a chosen directory.

## Testing the Mac app (standing rule)
Every hands-on or smoke test of the installed Mac app starts with `scripts/install-latest.sh` (or `SKIP_BUILD=1 scripts/install-latest.sh` right after a fresh `npm run dist`). It quits every copy, installs the current build, verifies the installed bytes match it, and proves the only running copy is the new one. Never test a copy you did not just install with it.

## Architecture
- Persistence: `src/lib/store.ts` → `createStore(key, initial)`, `useStore(store, selector?)`. Values persist to IndexedDB automatically. Binary blobs: `dbSet/dbGet` from `src/lib/db.ts`.
- Settings: `src/state/settings.ts` (`settings`, `settingsUpdate(key, patch)`). Types there are the contract.
- Timer: `src/state/timer.ts` (`useTimerView`, `timerActions`), pure engine in `timerEngine.ts`.
- Tasks: `src/state/tasks.ts`. Stats: `src/state/stats.ts`. Audio: `src/audio/core.ts` (`getCtx`, `masterOut`, `setMasterVolume`).
- Icons: `src/ui/icons.tsx` (`Icon.*`). Add icons there if needed (additive).
- Shared settings UI: `Toggle`, `Choices` from `src/ui/settings/SettingsDrawer.tsx`.

## Look and feel
Dark navy glass panels over a full-bleed theme, like Flocus. Use the CSS variables in `src/index.css`:
`--fg --fg-dim --fg-faint --panel --panel-2 --line --accent (#7c5cff) --accent-soft --radius` and classes
`.panel .panel-head .panel-body .ptabs .btn .btn.primary .btn.small .input .switch .range .card .opt .grid3 .choice .iconbtn .row .muted .faint .small`.
Put module CSS in a sibling `.css` file imported by your component. Respect `prefers-reduced-motion` and the `.reduce-motion` root class.
Accessibility: real buttons, labels, `aria-pressed` for toggles, visible focus, keyboard reachable.

## Report
End with a short plain-language report: what you built, files touched, checks run and their results, anything left undone. One human to another, no filler.
