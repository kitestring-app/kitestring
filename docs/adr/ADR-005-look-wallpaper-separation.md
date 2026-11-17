# ADR 005 — Keep Look and Wallpaper as separate, explicitly-linked concepts

- **Status:** Accepted (architecture invariant, reinforced in PR #44)
- **Date:** 2026-11-17
- **Deciders:** council conflict resolution (evidence-based)

## Context
The Chessboard defect arose from conflating a wallpaper (`ThemeRef` in `src/data/themes.ts`) with a Look (`LookId` in `src/state/settings.ts`). A wallpaper paints only the background; a Look changes the whole app through `[data-look]` tokens, typography, surfaces, icons and motion, and (for paper looks) its own backdrop.

## Decision
Maintain the two systems as separate registries. A Look is never implemented as a wallpaper-only entry. A wallpaper may be linked to a timer preset via `themeTimerPatch` (`ThemesTab.pickLibrary`), but it must not pretend to be a Look. New Looks join `LOOKS` and (if they own a backdrop) `PAPER_LOOKS`; all look-matrix tests and scripts are updated at the same time. Golden-baseline capture remains intentionally at the historical five Looks while its Chrome-version drift is parked.

## Consequences
- Clear ownership: Looks change identity; wallpapers change atmosphere; presets are linked explicitly.
- Adding a Look requires updating every hardcoded look list (tracked by centralising on `LOOKS`/`PAPER_LOOKS` and by this ADR).
- The Chessboard Look and the Chessboard wallpaper coexist by design (different settings surfaces).

## Alternatives considered
- Collapse wallpapers into Looks: rejected — would break wallpaper categories, custom uploads, credits and persistence.
- Make Chessboard a non-paper Look: rejected by evidence (`Background.tsx` backdrop gate).

## Verification
`docs/PARITY.md` rows; ADR-001/004 verification; council conflict ruling recorded in `.superpowers/sdd/chessboard-look/PLAN.md`.
