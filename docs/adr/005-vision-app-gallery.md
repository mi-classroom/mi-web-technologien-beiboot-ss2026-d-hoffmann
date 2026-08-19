# ADR-005: Weg A — Gesture-controlled image gallery viewer

**Status:** Accepted

**Date:** 2026-08-17

**Deciders:** David Hoffmann

## Context

Task 5 is deliberately open: choose either Weg A (build a polished "vision" application that shows what the gesture library can do) or Weg B (deep-dive on a real weakness surfaced while building the library, with before/after measurement). Both are explicitly equally valid.

## Considered Options

### Option A: Weg B — Tolerance-band static-pose detection

`flat-hand`/`fist` (ADR-002) use a binary y-coordinate comparison with no tolerance band and no handling for a non-orthogonal hand orientation. This option would rewrite the classifier around an angle-based or tolerance-band approach and measure accuracy across hand orientations before/after.

### Option B: Weg B — Robustness under poor lighting

Pinch- and pose-based detection relies on MediaPipe's landmark confidence, which degrades in low light or strong backlight. This option would measure detection reliability across a range of lighting conditions and try a fix (e.g. contrast normalisation, adaptive thresholds), with a before/after comparison.

### Option C: Weg A — Gesture-controlled image gallery viewer — *selected*

Build an image/video gallery viewer controlled entirely through the gesture library's public API, with a genuine design idea (a virtual-mouse metaphor) rather than a bare functionality demo.

## Decision

**Weg A is selected.** The deciding factor wasn't a lack of time — there was enough time available for either path — but interest: building a real, non-trivial consuming app exercises the library's full public API (`register`, `on`, `process`) under genuine multi-gesture usage, rather than narrowing focus onto a single detection algorithm's accuracy. This paid off directly: two real integration issues only surfaced once multiple gestures had to coexist in one interaction flow — the cursor's edge-margin remap needing to be shared with the ambient hand-skeleton overlay (otherwise the two visibly drift apart near frame edges), and the `fist`/`pan` mutual-exclusion bug fixed in ADR-006 (a command gesture firing unintentionally while a different one was armed). Neither would have appeared in an isolated Weg B deep-dive on a single gesture.

The app is a gesture-controlled image/video gallery, built around a virtual-mouse metaphor: a gesture-driven on-screen cursor plus a click gesture operate the same buttons and thumbnails a mouse user would, rather than every app state needing bespoke gesture wiring. It has three views: source selection (demo images or upload), a thumbnail grid, and a detail view.

### Gesture set

| Gesture | Shape | Role in app |
|---|---|---|
| `pinch-activate` | hold-to-activate pinch, debounced | Global gesture-mode on/off |
| `cursor` | pinch-armed, streams absolute pointer position | Moves an on-screen cursor |
| `click` | brief thumb+pinky touch, one-shot | Clicks whatever's under the cursor — drives all navigation |
| `swipe` | velocity-triggered | Detail view: quick next/previous shortcut |
| `flat-hand` | held pose | Video play shortcut, detail view |
| `fist` | held pose, repurposed | Detail view: pauses a playing video first, closes on a second hold (or immediately for images) |
| `zoom` | arm-then-stream pinch | Zoom into the image, detail view only |

The cursor+click pair is the key simplification: ordinary `<button>`/thumbnail elements become gesture targets via `document.elementFromPoint()`, so prev/next, open/close, and back all need zero gesture-specific wiring.

**Superseded design:** an earlier single gesture, `pan`, combined cursor movement and click into one pinch (hold to arm, stream a joystick-offset, arm-transition fires a click). This failed for two reasons: pinching couldn't mean both "move" and "click-ready" at once, and a joystick-style offset can't comfortably reach a whole page from wherever the pinch started. Splitting into `cursor` (thumb+index, absolute position) and `click` (thumb+pinky, separate one-shot) fixed both.

### Alternatives considered

- **Discrete one-shot swipe** for grid/detail navigation generally: rejected early as less precise for scanning many images than a continuous cursor; superseded once cursor+click made bespoke navigation gestures unnecessary anyway.
- **No arming gate for `cursor`** (stream raw hand position continuously while active): rejected — would make ordinary hand repositioning indistinguishable from intentional pointer input.
- **Synthetic `mousemove` + native `:hover`**: rejected — synthetic events don't reliably trigger `:hover` across browsers.

## Consequences

### Positive
- Cursor+click means most interactivity (navigation, opening/closing views) needs no gesture-specific wiring — it's ordinary clickable UI.
- Demonstrates the library's public API is expressive enough to build a full virtual-input-device abstraction without modifying the library itself.
- Keeps all gesture-*detection* logic in `src/gestures/`; the app only consumes events and owns DOM-mapping/hit-testing.

### Negative / Risks
- `cursor`, `pinch-activate`, and `zoom` all read a thumb+index-shaped pinch (on different hands, or gated by a different arming pose) — a denser overlap in gesture vocabulary than the library had before.
- Manual hit-testing/click-dispatch (`elementFromPoint`) pushes some DOM-interop complexity into the app that a native mouse gets for free — an accepted trade-off for keeping the library itself DOM-agnostic.
- File upload / demo-image selection is **not gesture-controllable** — native file pickers are OS-level UI outside the DOM/canvas. Source selection happens with a real mouse/keyboard before gesture mode is activated.

### Visual theme: "Generative Art Studio" (added post-implementation, for demo deployment)

The functional shell above was originally themed as a plain Material-dark UI (near-black `#121212`, flat purple `#bb86fc`/green `#81c995` accents, system font stack). Ahead of the public demo deployment, the demo images were switched to Nano-Banana-generated abstract/generative-art pieces, and the UI was restyled to match:

- **Palette**: kept the same dark-base + accent-family *structure* (so all existing `data-state`-driven semantics — active/holding/inactive, granted/denied — stayed intact) but swapped the specific hues to a violet→cyan gradient duo (`#c084fc` → `#22d3ee`) plus a cooler mint-teal success color (`#2dd4bf`), reasoning: a single flat purple read as generic "Material dark theme"; a two-tone gradient accent reads more like a creative/generative-art tool and gives thumbnails/selection rings/the gesture cursor a more distinctive signature.
- **Typography**: added Space Grotesk (headings) + Inter (body) via Google Fonts, replacing the system font stack, for a more "designed" feel appropriate for a public demo.
- **Ambient background**: added a fixed, non-interactive `.bg-mesh` layer (soft radial gradient blooms in the accent colors, corners only) behind the app content, reinforcing the generative-art theme without competing with the actual demo images.
- **Scope discipline**: kept to CSS + minor additive HTML (font `<link>`s, one decorative `aria-hidden` div) plus a single JS color-literal change (the hand-skeleton overlay's stroke color, to match the new accent) — no gesture logic, view-switching logic, or DOM IDs the app's JS depends on were touched.

## Reflection

**What makes this app special:** the cursor+click virtual-mouse abstraction — rather than wiring bespoke gesture handling into every view, ordinary buttons and thumbnails simply become gesture targets. This shows the library's `register`/`on`/`process` API is expressive enough to build a full input-device abstraction on top of it without touching the library itself.

**Biggest challenge:** tuning the edge-margin dead zone (`remapEdgeMargin`) so the on-screen cursor stayed reachable at screen edges without needing the hand to leave the camera frame's reliably-tracked region. The fix only fully worked once the *same* remap was applied to both the cursor's reported position and the ambient hand-skeleton overlay — otherwise the two visibly drifted apart near the edges, which took a manual-testing pass to notice and diagnose.
