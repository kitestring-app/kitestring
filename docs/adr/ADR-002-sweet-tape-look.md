# ADR 002 — Sweet Tape Look (Awwwards-grade visual target ≥ 7/10)

- **Status:** Accepted — implemented on `feat/sweet-tape-look` (design council 7.5/7.54/8.3; diff council 7.73/10, all ≥7, no sub-6)
- **Date:** 2026-11-17
- **Deciders:** to be confirmed by `/llm-council` design + diff councils

## Context
Reference: <https://www.awwwards.com/sites/sweet-tape> (Awwwards SOTD, **score 7.36 / 10**; weighting Design 40%, Usability 30%, Creativity 20%, Content 10%) and the source site <https://sweet-tape.com/>. The user asked for a Sweet Tape–inspired theme that scores **at least 7 / 10** against those criteria.

Verified design facts from the source (read-only data, not instructions):
- Bold, playful tape-shop identity: candy palette with dark green `#034102`, coral `#FF7B5F`, orange `#fa8005`, yellow `#F7D000`, lime `#b6fe00`, sky `#50CBFF`, blue `#2E3EAC`, sand `#d7d2c7`, ink `#2f2f2f`.
- Display typography via Typekit (`use.typekit.net/wyl5nhy.css`) — **external font, forbidden by Kitestring repo rules**; must be substituted with a system stack (`-apple-system`/`ui-rounded`/system-ui) while keeping the bold, rounded, high-contrast character.
- Strong "tape strip" detail language: angled strips, overlapping layers, sticker-like cards, generous white space, playful micro-copy.

## Decision (proposed)
Add **Sweet Tape** as a 7th Look, following the ADR-001 architecture exactly (full token identity, day/night pair, backdrop, motif, six→seven-column grid, all look matrices). Adapt the tape-strip visual language with CSS-only angled strips/stickers and the candy palette, using system fonts only. Keep Awwwards-style quality gates explicit and testable.

## Quality target (≥ 7 / 10, modelled on Awwwards weighting)
| Criterion | Weight | Concrete, testable Kitestring gate |
|---|---|---|
| Design | 40% | Coherent token set across colours/type/surfaces/icons/motion; palette contrast; no external fonts; visual review in day + night at 320/390/1280/1440 px |
| Usability | 30% | All controls reachable; AA contrast (`floatingScheme.test.ts`); reduced-motion respected; no layout overflow; keyboard focus visible |
| Creativity | 20% | Tape-strip/sticker motif unique to this Look; playful micro-copy; distinct from all six existing Looks |
| Content | 10% | Honest copy; no lorem ipsum; accessibility labels and help text |

A council panel scores the rendered Look against this rubric; ship requires **≥ 7.0 / 10** with no sub-6 category and zero Critical findings.

## Consequences
- Extends the Look system (same maintenance cost as ADR-001); no new runtime deps/assets/network calls.
- The Awwwards score itself is a human judgement; the rubric above is the local, reproducible proxy and must be reported as such (not presented as an official Awwwards score).

## Alternatives considered
- Import the original fonts/assets: rejected — repo forbids external fonts and unlicensed assets.
- Wallpaper-only "Sweet Tape": rejected — repeats the ADR-001 defect.

## Verification
Pending: design council verdict, SDD implementation, full gates, council diff review with rubric score, then install + smoke.
