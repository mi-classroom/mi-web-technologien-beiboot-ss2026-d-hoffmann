# ADR-005: Weg A — Gesture-controlled image gallery viewer

**Status:** Draft (finalise after implementation)

**Date:** 2026-08-17

**Deciders:** David Hoffmann

## Context

Task 5 is deliberately open: choose either Weg A (build a polished "vision" application that shows what the gesture library can do with real time invested — thought-through interaction, clean UX, a result worth showing outside the class) or Weg B (deep-dive on a real weakness surfaced while building the library, with before/after measurement).

Both are explicitly equally valid; the choice should follow personal interest and available time rather than perceived scoring value.

## Considered Options

### Option A: Weg B — Vertiefung on the static-pose detection weakness

`flat-hand`/`fist` detection (ADR-002) is a documented, self-flagged weakness: binary y-coordinate comparisons with no tolerance band, no handling for non-orthogonal hand orientation, thumb excluded from both checks. This would have been a bounded, well-scoped deep-dive with an existing "before" state to measure against (accuracy/false-positive rate across hand orientations or lighting conditions, before vs. after a tolerance-band or angle-based rewrite).

**Rejected** — not because it's a weaker option, but because the available time (a few days) and personal interest favoured building something end-to-end and demoable over an isolated measurement-driven fix. A gallery app also gives the chance to finally implement gestures (navigation) that were designed in `docs/gestures.md` back in Assignment 2 but never built, closing an existing gap in the library's own documentation.

### Option B: Weg A — Gesture-controlled image gallery viewer — *selected*

Build a small image gallery/viewer application, controlled entirely through the gesture library's public API (`register`, `on`, `off`, `process`, `isActive`, `activationHand`), themed around the project's long-term goal (an IPTC metadata management tool for images). The app has two states — a thumbnail grid and a single-image detail view — navigated and manipulated purely by hand gestures.

## Decision

**Weg A is selected.** The application is a gesture-controlled image gallery viewer with two views:

- **Grid view** — thumbnails of user-supplied images (loaded via a file input, no backend/persistence), with a gesture-driven cursor highlighting the selected thumbnail.
- **Detail view** — a single enlarged image, gesture-zoomable, with gesture-driven pagination to the next/previous image.

### Gesture set

| Gesture | Shape | Role in app |
|---|---|---|
| `pinch-activate` (existing) | hold-to-activate, debounced | Global gesture-mode on/off (activation hand) |
| `pan` (new) | pinch-armed, continuous stream `{dx, dy, originX, originY}`, direct 1:1 pinch-point tracking | Command hand — grid cursor movement / detail-view pagination |
| `fist` (existing) | one-shot, held 1000 ms | Open detail view for the currently selected/highlighted image |
| `flat-hand` (existing) | one-shot, held 1000 ms | Close detail view → back to grid |
| `zoom` (existing) | curl-to-wrist-armed, continuous stream `value` | Zoom into the image, detail view only |

Four of the five gestures are reused unmodified from the existing library; only `pan` is new. This satisfies the library's own "at least 4 gestures" requirement without inventing gesture semantics beyond what `docs/gestures.md` already speced for an image-navigation use case (its "Navigate forward/back" and "Scroll up/down" rows, previously undetected/unimplemented, are unified into the single continuous `pan` gesture rather than four separate detectors).

### `pan` gesture design

Modelled deliberately on `zoom`'s arm-then-stream pattern rather than introducing a third gesture "shape":

- **Arming pose**: thumb tip (landmark 4) + index fingertip (landmark 8) pinch on the *command* hand — the same finger pair and detection formula (`dist3d`/`handSize` ratio) as `pinch-activate`, but a fully independent, separately tunable config (`PAN_CONFIG`), since the command hand's natural pinch distance-from-camera may differ from the activation hand's. Armed via `holdGate()` with a short hold delay (tens–low hundreds of ms) to filter out fleeting accidental pinches while staying responsive.
- **Streaming value**: while armed, the gesture tracks the **pinch point itself** (the midpoint of `fingerA`/`fingerB`), smoothed via a short rolling average (5 frames) to reduce landmark jitter. The pinch point's position at the moment of arming is captured once as `{originX, originY}`; every armed frame emits the **raw** (not hand-size-normalised) movement since that origin as `{dx, dy}`, in the same normalised video-frame coordinate space as MediaPipe landmarks. A consumer reconstructs the tracked point directly as `origin + delta` and maps it onto its own coordinate space with a plain multiply — no accumulation, no sensitivity constant. This was a direct response to manual testing feedback: an earlier iteration streamed a hand-size-normalised, accumulated "joystick" offset multiplied by a sensitivity constant on the consumer side, which felt hypersensitive and made the cursor's start point and speed not correspond intuitively to the actual pinch location/hand speed on screen. Tracking the literal pinch point in raw video-frame units, with the consumer directly reconstructing `origin + delta`, makes the cursor start exactly where the fingertips touch and move at the same speed the hand moves in the video — matching what a user visually expects on first try, with one fewer tunable (no sensitivity constant needed).
- A **radial deadzone** (`deadzone`, a ratio of hand size, converted to an absolute value in raw units for the comparison) is applied on top: offsets below the deadzone are reported as `{dx:0, dy:0}` and offsets beyond it are rescaled so movement starts smoothly at the boundary. This was added after initial manual testing showed a still hand still produces a small but constant nonzero offset from landmark jitter alone, which — because `pan` is a *held* offset rather than a discrete or self-cancelling per-frame delta like `zoom`'s — accumulates into a visible drift in any consumer that tracks the point continuously, rather than being averaged away over time.
- **Disarming**: releasing the pinch immediately stops streaming and discards the origin/smoothing buffer, so the next arm sequence always starts clean and re-anchored wherever the next pinch happens to start (same principle as `zoom`'s reset-on-disarm).
- **Consumer-side reuse**: the same `{dx, dy, originX, originY}` stream drives two different behaviours depending on app state — direct cursor tracking in grid view, and threshold-triggered (then reset) 1-D pagination in detail view, using `dx` alone. One detection algorithm, two consumption strategies.

### Alternatives considered for `pan` specifically

- **Discrete one-shot swipe** (velocity-threshold-triggered, similar to `flat-hand`/`fist`'s hold pattern): rejected as less responsive/precise for quickly scanning many images, and would have introduced a third distinct gesture "shape" into the library instead of reusing the existing continuous-stream pattern.
- **Hand-size-normalised, accumulated "joystick" offset with a consumer-side sensitivity multiplier** (the first implementation attempt): rejected after manual testing — it felt hypersensitive and disconnected from the actual hand position/speed on screen, since the reported offset scaled inversely with distance from the camera and required an extra tunable (sensitivity) to feel usable at all. Direct, raw, origin-relative tracking of the pinch point removes that indirection entirely.
- **No arming gate at all** (stream raw hand position continuously while pinch-activate is held): rejected because it would make ordinary hand repositioning (e.g. moving the command hand back to a comfortable resting position) indistinguishable from an intentional navigation input.

## Consequences

### Positive
- Demonstrates the gesture library's continuous-value contract (introduced for `zoom` per ADR-003) generalises to a second, differently-shaped use case, rather than being a one-off special case.
- Closes a real gap between `docs/gestures.md`'s Assignment 2 design and what was actually implemented (navigation/scroll gestures were speced but never built).
- Keeps the new application's own code free of any gesture-detection logic — all detection lives in `src/gestures/pan.js`, the app only consumes events via the public API, satisfying the Weg A acceptance criterion of using the library "exclusively via its public API."

### Negative / Risks
- `pan`'s joystick-style, held-offset semantics required an additional **radial deadzone**, discovered through manual testing (a still hand still drifted visibly): the smoothing/threshold values (arm hold time, `touchThreshold`, `smoothingFrames`, `deadzone`) are, like every other gesture in this library, starting points expected to need empirical tuning per user/camera setup — same caveat documented for `pinch-activate`/`zoom`.
- Two gestures (`pinch-activate`, `pan`) now use the identical thumb+index pinch pose, just on different hands. The library's existing per-role hand resolution (`resolveLandmarks()` in `src/gestures/index.js`) should keep these from colliding, but this is a slightly denser overlap in gesture vocabulary than the library has had before and is worth a deliberate sanity check during implementation and manual testing.
- Reusing `dx`/`dy` for two different consumer behaviours (continuous cursor vs. threshold-triggered pagination) pushes some interpretation complexity into the gallery application rather than the gesture module — an intentional trade-off (keeps the gesture generic/reusable) but worth naming explicitly.

## Open items (to resolve before finalising this ADR)

- Final tuned values for `PAN_CONFIG` (`touchThreshold`, `armHoldMs`, smoothing window size), determined empirically during testing.
- Whether the grid-cursor sensitivity/pagination-threshold constants need per-device tuning, once tested on more than one camera setup.
- Reflection section (what makes the app special, biggest challenge) — to be written once the app is functionally complete.
