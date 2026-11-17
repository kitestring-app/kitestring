# ADR 004 — Surface the 45 · 12 "Chess rhythm" preset without breaking presets

- **Status:** Accepted (shipped in PR #44, commit `fd6ba5f`)
- **Date:** 2026-11-17
- **Deciders:** 3-model `/llm-council` design council (unanimous) + CEO expansion review

## Context
The `45-12-25` preset (`45 · 12`: 45 min focus, 12 min short break, 25 min long break, longEvery 4) existed but was buried as the sixth of seven identical small buttons in Timer settings. Users could not find it.

## Decision
Add an **additive featured callout** in `src/ui/settings/TimerTab.tsx` above the existing preset row: eyebrow "Chess rhythm", title "45 · 12", copy explaining the rhythm, and a "Use 45 · 12" button wired to the same preset action (reads lengths from the `PRESETS` row via `CHESS_PRESET_ID`, so it cannot drift). The existing `PRESETS.map` row is left intact; `themeTimerPatch` (wallpaper pick applies the preset once, preserving mode/countdown) is unchanged. `ThemesTab` message now names both the wallpaper and its 45 · 12 rhythm.

## Consequences
- The preset is discoverable; no behavior/API change to existing presets.
- Two "45 · 12" controls exist (featured + row) by design.
- `src/ui/settings/TimerTab.css` added (scoped, additive) — repo rule satisfied (named-file edits plus additive new file, reported).

## Alternatives considered
- Auto-apply 45/12 when the Chessboard *Look* is picked: rejected — surprising, and the look and wallpaper are distinct concepts.
- Reorder/replace the preset row: rejected — would break existing behavior and tests.

## Verification
`presets.test.ts` + `TimerTab.test.tsx` added; full gates green; council APPROVE.
