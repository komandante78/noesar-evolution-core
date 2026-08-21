# Visual design for live indicators — alive, not decorative

Applies **only** to NOESAR EVOLUTION. Subordinate to `CLAUDE10.md`; where they conflict,
`CLAUDE10.md` wins. Owner instruction, 2026-08-21 (verbatim, after the voice window was called
*"squallida e statica... sembra un gioco per bambini"*): *"fai qualcosa che dia sensazione di
vivo, di unico... salvati su skills come devi fare le immagini"*.

## The failure this repairs

The voice window (`apps/webui-static/index.html`/`styles.css`/`app.js`, `#voiceFace`) was
already driven by real audio data — a 12-band spectrum, logarithmic, fast-attack/slow-decay
smoothed. It still read as dead, because the data was drawn as a **left-right row of rectangles**
— the exact shape of a media-player equaliser, the single most generic visual a "sound
indicator" can have. Correct data, generic geometry: the geometry is what a person sees first.

## The rule

**Never reach for the most common shape for the thing being drawn.** A waveform for audio, a
speedometer for a rate, a thermometer for a level — each is the first idea everyone has, which
is exactly why it reads as decoration even when it is accurate. Ask: what is the least generic
truthful geometry for this exact data? For a spectrum: not a bar row (linear, media-player) but
a radial arrangement (circular, reacts from a centre) plus an organic silhouette through the
same points (a closed spline, not a second data source) — one thing looks alive, not a chart.

**Real data only, still means silence.** `noesar-evolution` already carries this invariant for
the voice window specifically (`app.js` comment above `paintVoiceFace`): nothing is animated on
a fixed timer to fake presence. A state-driven CSS animation (a breathing ring while
`listening`/`thinking`, D-0372) is the one deliberate exception, and it exists **because there is
no amplitude to show in that state** — not as decoration layered on top of real data. Before
adding any motion, ask which of the two it is, and say so in a comment.

**One dataset, redrawn once, not two signals.** The aura around the voice bars is a spline
through the *exact same* 12 values the bars use — never a second animation that could show
something the real data does not. A "unique" visual built from invented values is a lie with
good production values; this project has already paid for that mistake once (`F-MODEL-001`
class: a surface implying more than the data supports).

**Glow and gradient carry mood; motion carries fact.** `currentColor` + a radial gradient +
`feGaussianBlur` (already the pattern for `voiceFaceHalo`/`voiceFaceAura`) give visual richness
for free, reusing the state-colour language this project already committed to (blue open, amber
working, green speaking, red wrong — `styles.css` around `.voice-face[data-state=...]`). Do not
invent a second colour language per component.

## The checklist, before writing markup

1. What is the real data behind this indicator? If the honest answer is "none yet, it is a
   placeholder", say so — do not draw motion to imply data that is not there (rule 73, "capability
   not element").
2. What is the least generic truthful shape for *this* data's structure (one number → arc/orb;
   a spectrum → radial bands; a timeline → causality, not a progress bar)?
3. Does any motion added run on a timer? If yes, name in a comment exactly why silence cannot be
   the state it represents (the `listening` breathing ring is the reference case).
4. Reuse the project's existing colour-for-state and glow/gradient technique before inventing a
   new one — consistency reads as intentional; a new visual language per screen reads as unowned.
5. Preserve every DOM id/class a test already depends on (`grep -rn` the id/class across
   `services/reference-control-plane/test/*.mjs` and `tools/browser-e2e.mjs` before renaming
   anything) — a richer visual that breaks its own test coverage is a regression with better
   production values.

## Worked example — `#voiceFace`, 2026-08-21 (`git log --oneline -1`: *"redesign the voice
window as a radial, spectrum-lit indicator"*)

Before: 9 DOM bars in a row (silently short of the `VOICE_FACE_BARS=12` the JS already computed
— 3 bands were calculated and never drawn, a second, unrelated defect this fix also closed).
After: 12 bars arranged radially (`transform="rotate(<i*30> 60 60)"`, static in markup — only
`height`/`y` move per frame), a `<path id="voiceFaceAura">` traced through the same 12 tip
points via a closed Catmull-Rom spline, `feGaussianBlur` for glow. Zero new external
dependency, zero new secret, zero new network call — the opposite direction from reaching for an
external image/video generation API (evaluated and rejected for this exact task in session:
pre-rendered generative video cannot react to live input in real time, which is what an
*interactive* indicator is for).

## What this skill does not cover

Static assets (a logo, marketing imagery) are a different problem — no live data to be honest
about, so the constraints above do not bind the same way. If asked for one, that is a distinct,
smaller decision (tooling, licensing of the output, whether it enters the tracked repository at
all) — do not stretch this skill to justify it.
