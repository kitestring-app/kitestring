# ADR 003 — Resume or Reset stale Pomodoro round progress on reopen

- **Status:** Accepted (shipped in PR #43, commit `eea13e0`, merged `194de27`)
- **Date:** 2026-11-17
- **Deciders:** `/llm-council` design council + 4/5 diff council (5th parked on rate limit, no REJECT)

## Context
`TimerState.round` persists across sessions. A carried-over `round = 3` with `longEvery = 4` means the next completed focus becomes round 4 and wrongly triggers a long break after a single focus. Users reported seeing "3 of 4 clocks completed from days back" and wanted a reset option plus a themed prompt on reopen.

## Decision
Add a `stale-round` recovery offer, shown only when Pomodoro + `round > 0` + a >24h device gap token is pending + not already acknowledged for that token + no higher-priority recovery + not running focus. The themed card offers:
- **Resume pomodoro** — keeps the tally, acknowledges the prompt.
- **Reset progress** — sets `timer.round = 0` only (midway give-up of the stale set), guarded against running/hard-lock/boundary/reentry; ack-before-mutate; no stats/credit/segment side effects.
- **Dismiss/close** — resume-equivalent ack.

Priority: `missed-end > re-entry > (running focus suppresses) > stale-round > gap-return > parking-review`. The gap token is preserved so "Welcome back" can follow. New internal `acknowledgedRound` (v1-compatible, not backed up/synced).

## Consequences
- Fixes the reported bug without fabricating history or touching stats.
- Two sequential prompts possible (stale-round → gap-return) — documented tradeoff.
- Sub-24h stale carry-over does not prompt — documented v1 limitation.

## Alternatives considered
- New backed-up timestamp in `TimerState`: rejected — higher blast radius, backup schema change.
- Combine with gap-return into one card: rejected — conflates set tally with next-action choice.

## Verification
Unit 1640+/0, browser 107/107, 4/5 council APPROVE (5th unavailable, not a REJECT), fresh-context validator ACCEPT, installed-app smoke PASS.
