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

**Weg A is selected.** The application is a gesture-controlled image/video gallery viewer, driven end-to-end by a virtual mouse metaphor: a gesture-controlled on-screen cursor plus a click gesture operate the same buttons and thumbnails a mouse user would, rather than each app state needing bespoke gesture wiring. It has three states:

- **Source selection** — choose bundled demo images or upload personal images/videos (mouse/keyboard only — see limitation below).
- **Grid view** — thumbnails, with a gesture-driven cursor and hover/click to open an item.
- **Detail view** — a single enlarged image or video, gesture-zoomable (images), with click-driven next/previous/close controls.

### Gesture set

| Gesture | Shape | Role in app |
|---|---|---|
| `pinch-activate` (existing) | hold-to-activate, debounced | Global gesture-mode on/off (activation hand) |
| `cursor` (new, replaces the earlier `pan` design below) | pinch-armed (thumb+index), continuous stream of the **absolute** pinch-point position | Command hand — moves an on-screen cursor to the exact screen position where the pinch visually appears |
| `click` (new) | short thumb+pinky touch, one-shot | Clicks whatever's under the cursor — drives all navigation (thumbnail open, next/prev, close, back) |
| `swipe` (new) | velocity-triggered, one-shot with cooldown | Detail view: left = next, right = previous — a quick shortcut alongside the click-driven prev/next buttons |
| `flat-hand` (existing) | one-shot, held 1000 ms | Video play shortcut, detail view |
| `fist` (existing, repurposed) | one-shot, held 1000 ms | Detail view: pauses a playing video first, closes the view on a second fist (or immediately for images) |
| `zoom` (existing) | curl-to-wrist-armed, continuous stream `value` | Zoom into the image, detail view only |

This is a deliberate simplification over an earlier design (see "Superseded design" below): rather than building bespoke gesture-driven navigation for every app state (grid-cursor snapping, swipe/pagination thresholds, etc.), a generic cursor + click pair drives ordinary buttons and thumbnails exactly like a mouse would. Prev/next, close-detail, and back-to-grid/back-to-select no longer need any gesture-specific logic at all — they're just `<button>` elements that `click` can trigger via `document.elementFromPoint()` + a dispatched click, identical to how a sighted mouse user would operate them.

### `cursor` gesture design

- **Arming pose**: thumb tip (landmark 4) + index fingertip (landmark 8) pinch, same formula (`dist3d`/`handSize` ratio) and independent config as the original `pan` design below, armed via `holdGate()`.
- **Streaming value**: while armed, the gesture reports the **normalised (0–1) midpoint** of the two pinched fingertips, smoothed via a short rolling average (`smoothingFrames`) — not a delta, not an offset from a baseline, just the touch point's own position, in the same coordinate space as raw MediaPipe landmarks. The gesture module stays deliberately DOM-agnostic (same principle as every other gesture in this library): mapping that normalised position onto real screen pixels is the consuming app's job, since only the app knows its own canvas/video layout. The app does this the same way it already draws the hand overlay — reading the canvas's `getBoundingClientRect()` and undoing the CSS mirror: `screenX = rect.left + (1 - x) * rect.width`.
- **Edge-margin remapping**: surfaced by manual testing — buttons near the screen edge were hard to reach, because reaching them requires moving the pinch point to the corresponding edge of the *camera frame*, exactly where MediaPipe's hand tracking is least reliable (the hand partially leaves the frame, landmarks get noisy or drop out). `edgeMargin` (default `0.15`) treats a margin at each frame edge as a dead zone and rescales the remaining central region to still cover the full 0–1 output range: `remapEdgeMargin(v, margin) = clamp((v - margin) / (1 - 2 * margin), 0, 1)`, applied independently to `x` and `y` after smoothing. With the default, only the central 70% of the frame needs to be covered to reach 100% of the screen — effectively "zooming out" the control mapping so the hand never needs to travel to the true, unreliable frame edge. It reduces, but doesn't eliminate, the underlying limitation — if the hand still has to leave the reliably-tracked region entirely, no remapping compensates for MediaPipe losing it outright.
  - **Revised into a shared utility after a follow-up bug report**: the remap was initially a private helper inside `cursor.js` only. This caused a visible bug: the consuming apps' ambient hand-skeleton overlays (`drawHandSkeleton()` in `demo/demo.js` and `gallery/gallery.js`) draw *raw, un-remapped* landmarks, so once `cursor`'s reported position was remapped, the on-screen cursor visibly "detached" from the rendered fingertip position near the frame edges — the whole point of the overlay (showing where your hand is) broke down exactly where the remap mattered most. The fix: `remapEdgeMargin()` was extracted into `src/gestures/utils.js` as a shared, general-purpose helper (alongside `dist3d`/`handSize`/`holdGate`), and both consuming apps now apply the *same* remap (with the *same* margin value, defined once as a local constant and reused for both the gesture config and the overlay rendering) to every landmark before drawing the skeleton overlay — not just to `cursor`'s own reported position. This keeps the visual hand representation and the cursor consistently glued together across the whole reachable screen area, including at the edges.
- **Persistence, not hiding, on disarm**: releasing the pinch stops the position stream (`detect()` returns `false`, no further `cursor` events), but the app is expected to leave the on-screen cursor exactly where it last was rather than hiding it. This lets a user "park" the cursor over a target by pinching, releasing, and then clicking with an entirely different gesture (see `click` below) without needing to hold two things at once.

### `click` gesture design

A short touch between thumb tip (landmark 4) and pinky fingertip (landmark 20) — deliberately a **different finger pair** from `cursor`'s thumb+index pinch, so the two are mutually exclusive (the thumb can only touch one other finger at a time) rather than needing to be disambiguated by pose or timing. This naturally enforces the intended two-step interaction: pinch thumb+index to *position* the cursor, release, then touch thumb+pinky to *click* wherever it was left.

Detection reuses the same `dist3d`/`handSize` pinch-distance formula as `pinch-activate`/`cursor`, but fires as a one-shot event (like `fist`/`flat-hand`) rather than an arm-and-stream gesture. Unlike `fist`/`flat-hand`'s full-second hold (appropriate for poses that could otherwise occur by accident while just moving the hand), a pinch touch is already a deliberate, low-false-positive pose, so only a short `holdMs` (tens of ms) is used — just enough to filter a single noisy detection frame, not a "hold to confirm" delay. The consuming app resolves the click against whatever element is currently under the cursor's last known position.

### `swipe` gesture design

Reintroduces the velocity-based swipe originally speced in `docs/gestures.md` back in Assignment 2 ("Navigate forward/back") but never implemented at the time. It's added now not as a replacement for click-driven navigation — the detail view's prev/next buttons already cover that via `cursor`+`click` — but as a quick, no-aim-required shortcut alongside them, the same relationship `flat-hand`/`fist` have to a video's own play/pause controls.

Deliberately a different gesture "shape" from everything else so far: not a pose held for a duration (`flat-hand`/`fist`), not a pinch-armed stream (`zoom`/`cursor`), but **trajectory-triggered** — it fires based on how fast a tracked point has moved over a short recent window, with no finger-pose requirement at all. A short rolling buffer of the middle finger's base knuckle (landmark 9) position — converted to mirrored/screen-space coordinates (`1 - x`), the same convention `cursor`/`remapEdgeMargin` use, since reporting direction from raw camera-space `x` would read backwards from what the user visually sees — is kept over `windowMs`; average velocity across that window is compared against `velocityThreshold`, and crossing it fires a one-shot `{ direction }` event followed by a `cooldownMs` period (with the buffer cleared) before it can fire again.

This was previously considered and rejected as the *primary* mechanism for cursor-style navigation (see "Alternatives considered" below) specifically because a discrete swipe is less precise for scanning many images quickly than a continuous cursor. That reasoning doesn't apply here: in the narrower context of "quickly flip to the next/previous image while already in detail view," a fast, unaimed swipe is exactly the right shape — the same distinction that already justifies `flat-hand`/`fist` existing alongside clickable video controls.

**Known overlap caveat:** like `zoom`/`cursor` sharing the thumb+index pinch, `swipe` evaluates independently of every other gesture — fast horizontal hand movement while `cursor` is pinch-armed (e.g. dragging the pointer) could also cross the velocity threshold and fire an unwanted swipe. No pinch-guard was added; the app instead only acts on `swipe` while `currentView === 'detail'`, the same view-gating pattern already used for `flat-hand`/`fist`/`zoom`, which limits how often the two gestures would realistically overlap in practice.

### `fist` — repurposed as a two-step pause-then-close

Originally a plain "pause video" shortcut. Revised to also close the detail view, since a quick way to back out of a viewed item (beyond clicking "back to grid") was a real gap: **for videos**, the first `fist` pauses playback, and a second `fist` (now that it's already paused) closes the view; **for images**, there's no playback state to stop first, so `fist` closes immediately. This composes safely with `closeDetail()`'s existing behaviour of pausing the video as it closes — so leaving via the "back to grid" button (mouse/click path) never leaves a video playing in the background either, regardless of which path was used to leave.

An alternative — a single `fist` press always closing immediately, dropping the pause step entirely — was considered simpler, but was rejected in favour of the two-step version specifically to preserve a fast way to silence a playing video without leaving the view (native video `controls` remain available via `cursor`+`click` for pausing without closing, but a gesture shortcut for the common "stop this video" action was worth keeping).

### Hover feedback

Genuine CSS `:hover` cannot be reliably triggered by dispatching synthetic `MouseEvent`s — it's tied to the browser's own internal pointer-tracking, not to events JS can fabricate. To still get the effect of real-mouse hover (instant, no dwell delay, as soon as the cursor lands on a target) the app hit-tests the element under the cursor itself via `document.elementFromPoint()` every frame the cursor is visible, and toggles a dedicated `.gesture-hover` class styled identically to how `:hover` would look. Functionally indistinguishable from native hover from the user's perspective; implemented as manual state tracking rather than relying on the browser's native mechanism.

### Superseded design: `pan` (joystick-offset cursor)

An earlier iteration of this decision used a single gesture, `pan`, combining cursor movement and click into one pinch: hold thumb+index to arm, stream a joystick-style offset from the arm-moment baseline, with the arm-transition itself firing a click. This was superseded for two reasons, surfaced during planning rather than after implementation:

1. **Movement and click can't share one gesture.** If pinching is required to move the cursor at all, the cursor can never be repositioned without also being in a "click-armed" state — unlike a real mouse, where hovering and clicking are independent actions. Splitting into `cursor` (thumb+index, movement only) and `click` (thumb+pinky, a separate one-shot trigger) removes that coupling.
2. **A joystick-style offset can't comfortably reach a whole page.** `pan`'s offset was bounded by how far a hand can physically stretch from wherever the pinch started, adequate for a small bounded grid-cursor but not for operating buttons/thumbnails anywhere on a full page. Reporting the pinch point's own **absolute** position (mapped through the same transform as the hand overlay) removes that bound entirely — the cursor can reach anywhere the hand can visually reach on screen, with no accumulation or sensitivity constant needed.

The original `pan` design already went through one round of manual-testing-driven refinement before this supersession (switching from a hand-size-normalised accumulated offset with a sensitivity constant, to a raw origin-relative offset, after the former felt hypersensitive and disconnected from the actual hand position on screen) — that iteration's reasoning is preserved here for context, since it's part of why the final `cursor` design reports an absolute position directly rather than reintroducing any form of offset/delta.

### Alternatives considered

- **Discrete one-shot swipe** (velocity-threshold-triggered, similar to `flat-hand`/`fist`'s hold pattern) for grid/detail navigation: rejected early on as less responsive/precise for quickly scanning many images, and would have introduced a third distinct gesture "shape" into the library. Superseded entirely once the cursor+click model made bespoke navigation gestures unnecessary.
- **No arming gate at all** for `cursor` (stream raw hand position continuously while pinch-activate is held): rejected because it would make ordinary hand repositioning (e.g. moving the command hand back to a comfortable resting position) indistinguishable from an intentional pointer input.
- **Synthetic `mousemove` + relying on native `:hover`** instead of manual hit-testing: rejected — synthetic events don't reliably trigger `:hover` across browsers, since hover state is tracked by the browser's own input pipeline rather than being derivable from dispatched events.

## Consequences

### Positive
- The cursor+click model means most of the app's interactivity (navigation, opening/closing views, pagination) needs **no gesture-specific wiring at all** — it's driven by ordinary clickable UI elements, the same ones already built for the mouse/keyboard-only shell. This is a meaningful simplification versus wiring each view transition to a distinct gesture.
- Demonstrates that the gesture library's public API (`register`/`on`/`process`) is expressive enough to build a full virtual-input-device abstraction (cursor + click) on top of it, without needing to modify the library itself.
- Keeps the new application's own code free of any gesture-*detection* logic — all detection lives in `src/gestures/cursor.js` and `src/gestures/click.js`; the app only consumes events via the public API and owns the DOM-mapping/hit-testing logic, satisfying the Weg A acceptance criterion of using the library "exclusively via its public API."

### Negative / Risks
- `cursor` and `pinch-activate` use the identical thumb+index pinch pose, just on different hands. The library's existing per-role hand resolution (`resolveLandmarks()` in `src/gestures/index.js`) should keep these from colliding, but this is a slightly denser overlap in gesture vocabulary than the library has had before and is worth a deliberate sanity check during implementation and manual testing.
- `zoom`'s streamed value also reads thumb+index distance (once its own curl-arm pose is satisfied) — theoretically both `zoom` and `cursor` could be "active" simultaneously if a user curls their outer fingers *and* pinches thumb/index at once. Unlikely in practice (curling three fingers while also precisely pinching the other two is an awkward, deliberate pose), but worth a manual check.
- Manual hover hit-testing (`elementFromPoint` every frame) and manual click dispatch (`elementFromPoint` + synthetic click) push a small amount of DOM-interop complexity into the gallery app that a native mouse just gets for free — an accepted trade-off for keeping the gesture library itself free of any DOM/rendering concerns.
- File upload / demo-image selection remains **not gesture-controllable**: native file-picker dialogs are OS-level UI outside the DOM/canvas, and no browser lets JS drive them programmatically once open. This is a real, documented limitation of the "gesture-controlled app" framing, not something to be worked around — source selection happens with a real mouse/keyboard before gesture mode is activated.

## Open items (to resolve before finalising this ADR)

- Final tuned values for `cursor`/`click`'s configs (`touchThreshold`, `armHoldMs`, `smoothingFrames`, `click`'s `holdMs`), determined empirically during testing.
- Reflection section (what makes the app special, biggest challenge) — to be written once the app is functionally complete.
