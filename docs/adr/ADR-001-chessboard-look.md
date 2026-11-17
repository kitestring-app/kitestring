# ADR 001 — Chessboard as a full Look with whole-app UI identity

- **Status:** Accepted (shipped in PR #44, commit `fd6ba5f`, merged `fedbc05`)
- **Date:** 2026-11-17
- **Deciders:** `/plan-ceo-review` SCOPE EXPANSION + 3-model `/llm-council` design council (all free models)

## Context
Chessboard originally shipped only as a wallpaper entry in `src/data/themes.ts` (category `abstract`, conic-gradient board). The five real Looks each change the entire app through a `:root[data-look="…"]` token block plus typography, surfaces, icon stroke, motion, and (for paper looks) their own backdrop. Users could not see Chessboard in Settings > Themes > Look, and picking the wallpaper did not change the UI identity. This was a defect in the product contract, not a missing feature.

## Decision
Chessboard is a genuine **6th paper Look** (`LOOKS`, `PAPER_LOOKS`), not a wallpaper-only theme:
- Full day/night token sets (`:root[data-look="chessboard"]`, `html.paper-dark[data-look="chessboard"]`) covering colours, surfaces, borders, accent, state colours, radii, typography (`--timer-font` = system monospace chess-clock digits), icon stroke and press motion.
- CSS board-square motif on panels/drawer bodies, crisp corners, brass-green accent, CSS-only board backdrop (`.look-bg-chessboard`).
- 6th tile in the Look picker (`LOOK_INFO`), grid widened to six columns.
- Every look-matrix unit test, browser suite and `scripts/browser/*.mjs` updated to six looks; `scripts/golden.mjs` intentionally left at five (parked on Chrome-version drift).
- WCAG AA verified for the floating timer on both Mac glass types, in day and night, for both schemes and both OS appearances (`floatingScheme.test.ts`).

## Consequences
- **Positive:** whole-app identity matches the other Looks; consistent with the Flocus-style design contract; parity Web + Mac from shared `src/`.
- **Negative:** adding a Look now touches ~35 files and every hardcoded look-list; maintained by centralising on `LOOKS`/`PAPER_LOOKS` where possible.
- **Neutral:** the wallpaper entry remains; the 45·12 preset still applies when that wallpaper is picked (`themeTimerPatch`).

## Alternatives considered
- **Recolour Classic / wallpaper-only patch:** rejected — does not satisfy the whole-app identity contract (2x effort, ~3x product quality gap).
- **Non-paper Look with `theme-light`:** rejected by evidence — `Background.tsx:136,142` renders `LookBackdrop` only for `PAPER_LOOKS`, so the board backdrop would never appear.

## Verification
`tsc` 0, `npm run build` 0, serial `vitest` 1640 passed / 0 failed, `npm run test:browser` 107/107, 3/3 council APPROVE after one fixed `names`-array defect.
