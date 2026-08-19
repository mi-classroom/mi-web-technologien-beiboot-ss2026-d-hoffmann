# Gesture Vocabulary

This document maps user interaction intents to concrete hand gestures, evaluates the reliability of available sensor data, and records which gestures were selected for implementation in Assignment 2.

The application context is an IPTC metadata management tool for images. Interactions cover navigation (next/previous image), zoom, and session control (start/stop gesture mode).

---

## Landmark reference

MediaPipe provides 21 points per hand. The ones used in this document:

| Name | ID | Position on hand |
|---|---|---|
| Wrist | 0 | Base of the hand |
| Index MCP | 5 | Base knuckle of index finger |
| Middle MCP | 9 | Base knuckle of middle finger |
| Ring MCP | 13 | Base knuckle of ring finger |
| Pinky MCP | 17 | Base knuckle of pinky |
| Thumb tip | 4 | Tip of thumb |
| Index tip | 8 | Tip of index finger |
| Middle tip | 12 | Tip of middle finger |
| Ring tip | 16 | Tip of ring finger |
| Pinky tip | 20 | Tip of pinky |
| Index middle knuckle | 6 | Middle joint of index finger |
| Middle middle knuckle | 10 | Middle joint of middle finger |
| Ring middle knuckle | 14 | Middle joint of ring finger |
| Pinky middle knuckle | 18 | Middle joint of pinky |

> **Y-axis note:** In normalised coordinates y = 0 is the top of the frame, y = 1 is the bottom. A fingertip *above* a knuckle means `tip.y < knuckle.y`.

---

## Mapping Table

| Interaction | Gesture | Needed data |
|---|---|---|
| **Activate gesture control** ✅ | Pinch-activate - two configured fingertips on the activation hand touch and hold | Euclidean 3-D distance between `fingerA` and `fingerB` (normalised by hand size) falls below `touchThreshold`; held continuously for `activationDebounceMs` |
| **Deactivate gesture control** ✅ | Release the pinch-activate hold | The same normalised distance rises above `touchThreshold` and stays there for `deactivationDebounceMs` |
| **Move cursor** ✅ | Cursor - pinch thumb + index on the command hand, hold to position an on-screen pointer | Midpoint of `fingerA`/`fingerB`, held via `holdGate`; smoothed and remapped through an edge-margin dead zone, streamed as an absolute `{x, y}` position every armed frame |
| **Click / Confirm** ✅ | Click - thumb tip and pinky tip touch briefly | Euclidean 3-D distance between `fingerA` (thumb tip) and `fingerB` (pinky tip), normalised by hand size, falls below `touchThreshold`; held for a short `holdMs` (default 50 ms); fires once per touch |
| **Navigate forward / back** ✅ | Swipe - hand moves quickly left or right across the frame | Position of middle base knuckle (9), in mirrored/screen-space coordinates, tracked over a rolling `windowMs` window; fires once when average velocity crosses `velocityThreshold`, then cools down for `cooldownMs` |
| **Zoom (in/out)** ✅ | Arm-then-stream pinch zoom - curl middle/ring/pinky close to the wrist to arm, then spread/close thumb and index tip on the command hand | Outer fingertips (12, 16, 20) within `closeThreshold` of the wrist (0), held for `armHoldMs`, then thumb/index normalised distance streamed frame-to-frame as a signed `value` |
| **Stop / Pause** ✅ | Open flat hand - all four fingers fully extended, held for `holdMs` | All four fingertips (8, 12, 16, 20) are above their PIP joints (6, 10, 14, 18); pose held for `holdMs` (default 1000 ms); fires once per hold |
| **Confirm / Select** ✅ | Closed fist - all four fingers fully curled, held for `holdMs` | All four fingertips (8, 12, 16, 20) are below their MCP joints (5, 9, 13, 17); pose held for `holdMs` (default 1000 ms); fires once per hold |

`docs/adr/005-vision-app-gallery.md` documents how the gallery app composes these primitives into concrete behaviour (e.g. fist's app-specific "pause, then close" two-step, swipe's left=next/right=previous mapping) - this table stays at the level of what each gesture *detects*, independent of any one consuming app's interpretation of it. "Scroll up/down" (previously listed here as unimplemented) is superseded by `cursor`'s free-roaming pointer, which covers the same 2-D navigation need without a dedicated discrete gesture.

---

## Pinch-activate - activation mechanism

Gesture mode is toggled by the **pinch-activate** gesture: two fingertips on the designated *activation hand* are brought together and held until a configurable delay has elapsed. Command gestures (swipe, zoom, etc.) fire on the *other* hand while the pinch is maintained.

### How detection works

The distance between the two fingertips is computed in normalised 3-D space (x, y, z) and divided by the current hand size (wrist lm 0 → middle-finger MCP lm 9). Using a ratio rather than an absolute value makes the threshold scale-invariant: the same physical pinch triggers regardless of how far the hand is from the camera. Including the z-axis prevents false triggers when the hand is tilted edge-on and the 2-D projected distance collapses.

```
detected = dist3d(lm[fingerA], lm[fingerB]) / handSize < touchThreshold
```

### Configuration

All parameters live in `ACTIVATION_CONFIG` in `src/main.js` and can be overridden there:

| Parameter | Default | Meaning |
|---|---|---|
| `fingerA` | `4` (thumb tip) | First fingertip landmark index |
| `fingerB` | `8` (index tip) | Second fingertip landmark index |
| `touchThreshold` | `0.4` | Max pinch distance as a fraction of hand size |
| `activationHand` | `'left'` | Which hand performs the activation pinch |
| `activationDebounceMs` | `500` | How long the pinch must be held before activating (ms) |
| `deactivationDebounceMs` | `333` | How long the pinch must be absent before deactivating (ms) |

Any two fingertip landmarks (4, 8, 12, 16, 20) can be used as `fingerA`/`fingerB`. The activation hand can be set to `'left'` or `'right'`; command gestures are then watched on the opposite hand.

---

## Zoom - arm-then-stream pinch gesture

Zoom is a single **continuous** command gesture (`name: 'zoom'`), modelled on the trackpad pinch-to-zoom convention rather than the discrete, one-shot pattern used by flat-hand/fist. It has two stages:

1. **Arm** - curl the middle, ring, and pinky fingertips (12, 16, 20) close to the wrist (0) on the command hand, leaving thumb and index free. Hold this pose for `armHoldMs` before it arms. This pose is deliberately unusual (it doesn't naturally occur while just moving the hand around), so it acts as a mini "dead man's switch" scoped to zoom, distinct from the global pinch-activate gate.
2. **Stream** - once armed, and for as long as the arming pose is maintained, the normalised distance between `fingerA` (thumb tip) and `fingerB` (index tip) is tracked frame-to-frame. Every armed frame emits a `value` equal to the signed delta of that distance: positive means the pinch is opening (zoom in), negative means it's closing (zoom out). There is no noise-gate threshold on the delta - it streams continuously so a consumer can apply it directly, e.g. `zoomLevel += value * sensitivity`.

Breaking the arming pose (any of the three outer fingertips moving away from the wrist) disarms immediately and resets both the hold timer and the distance tracker, so re-arming always starts from a clean baseline instead of a stale jump.

### How detection works

```
poseActive = outerFingers.every(idx => dist3d(lm[idx], lm[wristLandmark]) / handSize < closeThreshold)
armed      = holdGate(poseActive, frameState, armHoldMs, timestamp)   // stays armed while poseActive holds

ratio = dist3d(lm[fingerA], lm[fingerB]) / handSize
delta = ratio(this frame) - ratio(previous frame)      // only while armed
value = delta
```

`holdGate()` (in `src/gestures/utils.js`) is a small reusable helper: it arms after a pose has been held continuously for a configurable duration, and disarms the instant the pose breaks - the same "physically encoded state" philosophy as pinch-activate (see ADR-003), just scoped to a single command gesture instead of the whole library.

### Configuration

| Parameter | Default | Meaning |
|---|---|---|
| `fingerA` | `4` (thumb tip) | First pinch fingertip landmark index |
| `fingerB` | `8` (index tip) | Second pinch fingertip landmark index |
| `outerFingers` | `[12, 16, 20]` | Fingertip landmarks that must curl close to the wrist to arm |
| `wristLandmark` | `0` | Proximity reference point for `outerFingers` |
| `closeThreshold` | `0.6` | Max outer-fingertip-to-wrist distance, as a fraction of hand size, to count as "close" |
| `armHoldMs` | `400` | How long the arming pose must be held before streaming starts |

`closeThreshold` and `armHoldMs` are starting points, expected to need empirical tuning per user/camera setup - same caveat as pinch-activate's `touchThreshold`.

`dist3d`/`handSize` are shared with pinch-activate via `src/gestures/utils.js`; `holdGate` is a new addition there for gestures that need a continuous "hold-to-arm, stream-while-held" pattern.

See ADR-003 for the rationale behind extending the gesture `detect()` contract to support this continuous, value-carrying return shape, and for the timestamp-threading fix that made a deterministic hold timer possible.

---

## Click - brief thumb-pinky touch

Click (`name: 'click'`) is a discrete, one-shot command gesture: the thumb tip and pinky tip on the command hand touch briefly and the event fires once, similar in spirit to a mouse click.

It reuses the same fingertip-distance approach as pinch-activate (normalised 3-D distance, scale-invariant, z-aware), combined with the one-shot hold-then-fire pattern used by `flat-hand`/`fist` - but with a much shorter required hold (`holdMs`, default 50 ms instead of 1000 ms) so it reads as a quick tap rather than a sustained pose. Deliberately a *different* finger pair from `cursor`'s thumb+index pinch (see below), so the two are mutually exclusive - the thumb can only touch one other finger at a time - rather than needing to be disambiguated by pose or timing.

### How detection works

```
touching = dist3d(lm[fingerA], lm[fingerB]) / handSize < touchThreshold
```

The event fires once when `touching` has been continuously true for `holdMs`; it will not fire again until the tips separate and re-touch (same one-shot semantics as flat-hand/fist).

### Configuration

| Parameter | Default | Meaning |
|---|---|---|
| `fingerA` | `4` (thumb tip) | First fingertip landmark index |
| `fingerB` | `20` (pinky tip) | Second fingertip landmark index |
| `touchThreshold` | `0.3`–`0.4` (app-tuned) | Max touch distance as a fraction of hand size |
| `holdMs` | `50` | How long the tips must stay touching before the click fires (ms) |

Any two fingertip landmarks (4, 8, 12, 16, 20) can be used as `fingerA`/`fingerB` via `gestureConfig.click` in `createGestureLibrary()`, same as pinch-activate.

`dist3d`/`handSize` are shared with pinch-activate and zoom via `src/gestures/utils.js`.

---

## Cursor - pinch-armed absolute pointer

Cursor (`name: 'cursor'`) is a continuous command gesture that turns the command hand into a virtual mouse pointer: pinch thumb+index to move it, release to leave it parked wherever it was, then use `click` (a different finger pair, see above) to act on whatever it's over.

Unlike `zoom`'s frame-to-frame delta, `cursor` reports the pinch point's own **absolute position** every armed frame - the on-screen pointer sits at the exact spot the pinch visually appears, rather than accumulating relative movement. See ADR-005 for the full design rationale, including a superseded joystick-offset design and why it was replaced.

### How detection works

```
poseActive = dist3d(lm[fingerA], lm[fingerB]) / handSize < touchThreshold
armed      = holdGate(poseActive, frameState, armHoldMs, timestamp)

raw      = midpoint(lm[fingerA], lm[fingerB])
smoothed = rollingAverage(raw, last smoothingFrames)   // jitter smoothing
value    = { x: remapEdgeMargin(smoothed.x, edgeMargin), y: remapEdgeMargin(smoothed.y, edgeMargin) }
```

`remapEdgeMargin()` (in `src/gestures/utils.js`) treats a margin at each frame edge as a dead zone and rescales the remaining central region to still cover the full 0–1 output range - reaching a target at the true screen edge would otherwise require moving the hand to the least reliably-tracked part of the camera frame. This same remap is applied by consuming apps directly to raw landmarks when rendering an ambient hand-skeleton overlay, so the visual hand representation and the cursor stay glued together - see ADR-005 for the bug this fixed when the two used inconsistent mappings.

The consuming app maps this normalised position onto real screen pixels itself (mirroring + viewport/canvas scaling) - the gesture module stays deliberately DOM-agnostic, like every other gesture in this library.

### Configuration

| Parameter | Default | Meaning |
|---|---|---|
| `fingerA` | `4` (thumb tip) | First pinch fingertip landmark index |
| `fingerB` | `8` (index tip) | Second pinch fingertip landmark index |
| `touchThreshold` | `0.4` | Max pinch distance as a fraction of hand size |
| `armHoldMs` | `175` | How long the pinch must be held before arming |
| `smoothingFrames` | `3` | Rolling-average window size for jitter smoothing |
| `edgeMargin` | `0.15` | Fraction of the frame at each edge treated as a dead zone |

---

## Swipe - velocity-triggered horizontal navigation

Swipe (`name: 'swipe'`) fires a one-shot `{ direction: 'left' | 'right' }` event based on how fast the hand has moved, not on any particular finger pose - a different gesture "shape" from everything else in this library: not a held pose (`flat-hand`/`fist`), not a pinch-armed stream (`zoom`/`cursor`), but trajectory-triggered.

Introduced as a quick, no-aim-required shortcut alongside click-driven prev/next buttons in the gallery app - the same relationship `flat-hand`/`fist` have to a video's own play/pause controls - rather than as a replacement for click-based navigation. See ADR-005 for why a similar discrete-swipe design was originally rejected as the *primary* navigation mechanism, and why it was revisited here as a complementary one.

### How detection works

```
mirroredX = 1 - lm[trackedLandmark].x   // screen-space x, same convention as cursor/remapEdgeMargin
buffer.push({ x: mirroredX, timestamp })
buffer = buffer.filter(sample => sample.timestamp >= timestamp - windowMs)

velocity = (newest.x - oldest.x) / (newest.timestamp - oldest.timestamp) * 1000   // per second

if |velocity| >= velocityThreshold:
  direction = velocity > 0 ? 'right' : 'left'
  fire once, then cooldown for cooldownMs (buffer cleared, so the next swipe starts clean)
```

Raw camera-space `x` is deliberately converted to mirrored/screen-space `x` before computing velocity - using raw camera `x` directly would report directions backwards from what the user visually sees, since the app mirrors the camera feed for display.

### Configuration

| Parameter | Default | Meaning |
|---|---|---|
| `trackedLandmark` | `9` (middle finger MCP) | Landmark tracked for horizontal movement |
| `windowMs` | `200` | Rolling window over which velocity is measured |
| `velocityThreshold` | `1.2` | Minimum \|velocity\| (screen-space x-units/second) to count as a swipe |
| `cooldownMs` | `500` | How long after firing before it can fire again |

**Known overlap caveat:** like `zoom`/`cursor` sharing the thumb+index pinch pose, `swipe` evaluates independently of every other gesture - fast horizontal movement while `cursor` is pinch-armed (e.g. dragging the pointer) could also cross the velocity threshold and fire an unwanted swipe. No pinch-guard is applied; consuming apps are expected to only act on `swipe` in a context where it's meaningful (e.g. the gallery app's detail view only), which limits how often the two realistically overlap.
