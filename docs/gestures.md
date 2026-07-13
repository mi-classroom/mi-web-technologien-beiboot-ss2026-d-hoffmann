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
| **Activate gesture control** ✅ | Pinch-activate — two configured fingertips on the activation hand touch and hold | Euclidean 3-D distance between `fingerA` and `fingerB` (normalised by hand size) falls below `touchThreshold`; held continuously for `activationDebounceMs` |
| **Deactivate gesture control** ✅ | Release the pinch-activate hold | The same normalised distance rises above `touchThreshold` and stays there for `deactivationDebounceMs` |
| **Navigate forward** | Swipe right — hand moves left to right across the frame | Position of middle base knuckle (9) tracked over ~15 frames; rightward velocity above threshold |
| **Navigate back** | Swipe left — hand moves right to left across the frame | Same as swipe right, opposite direction |
| **Zoom (in/out)** ✅ | Arm-then-stream pinch zoom — curl middle/ring/pinky close to the wrist to arm, then spread/close thumb and index tip on the command hand | Outer fingertips (12, 16, 20) within `closeThreshold` of the wrist (0), held for `armHoldMs`, then thumb/index normalised distance streamed frame-to-frame as a signed `value` |
| **Stop / Pause** ✅ | Open flat hand — all four fingers fully extended, held for `holdMs` | All four fingertips (8, 12, 16, 20) are above their PIP joints (6, 10, 14, 18); pose held for `holdMs` (default 1000 ms); fires once per hold |
| **Confirm / Select** ✅ | Closed fist — all four fingers fully curled, held for `holdMs` | All four fingertips (8, 12, 16, 20) are below their MCP joints (5, 9, 13, 17); pose held for `holdMs` (default 1000 ms); fires once per hold |
| **Scroll up** | Swipe up — whole hand moves upward | Y-position of middle base knuckle (9) decreasing over ~15 frames above a velocity threshold |
| **Scroll down** | Swipe down — whole hand moves downward | Y-position of middle base knuckle (9) increasing over ~15 frames above a velocity threshold |

---

## Pinch-activate — activation mechanism

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

## Zoom — arm-then-stream pinch gesture

Zoom is a single **continuous** command gesture (`name: 'zoom'`), modelled on the trackpad pinch-to-zoom convention rather than the discrete, one-shot pattern used by flat-hand/fist. It has two stages:

1. **Arm** — curl the middle, ring, and pinky fingertips (12, 16, 20) close to the wrist (0) on the command hand, leaving thumb and index free. Hold this pose for `armHoldMs` before it arms. This pose is deliberately unusual (it doesn't naturally occur while just moving the hand around), so it acts as a mini "dead man's switch" scoped to zoom, distinct from the global pinch-activate gate.
2. **Stream** — once armed, and for as long as the arming pose is maintained, the normalised distance between `fingerA` (thumb tip) and `fingerB` (index tip) is tracked frame-to-frame. Every armed frame emits a `value` equal to the signed delta of that distance: positive means the pinch is opening (zoom in), negative means it's closing (zoom out). There is no noise-gate threshold on the delta — it streams continuously so a consumer can apply it directly, e.g. `zoomLevel += value * sensitivity`.

Breaking the arming pose (any of the three outer fingertips moving away from the wrist) disarms immediately and resets both the hold timer and the distance tracker, so re-arming always starts from a clean baseline instead of a stale jump.

### How detection works

```
poseActive = outerFingers.every(idx => dist3d(lm[idx], lm[wristLandmark]) / handSize < closeThreshold)
armed      = holdGate(poseActive, frameState, armHoldMs, timestamp)   // stays armed while poseActive holds

ratio = dist3d(lm[fingerA], lm[fingerB]) / handSize
delta = ratio(this frame) - ratio(previous frame)      // only while armed
value = delta
```

`holdGate()` (in `src/gestures/utils.js`) is a small reusable helper: it arms after a pose has been held continuously for a configurable duration, and disarms the instant the pose breaks — the same "physically encoded state" philosophy as pinch-activate (see ADR-003), just scoped to a single command gesture instead of the whole library.

### Configuration

| Parameter | Default | Meaning |
|---|---|---|
| `fingerA` | `4` (thumb tip) | First pinch fingertip landmark index |
| `fingerB` | `8` (index tip) | Second pinch fingertip landmark index |
| `outerFingers` | `[12, 16, 20]` | Fingertip landmarks that must curl close to the wrist to arm |
| `wristLandmark` | `0` | Proximity reference point for `outerFingers` |
| `closeThreshold` | `0.6` | Max outer-fingertip-to-wrist distance, as a fraction of hand size, to count as "close" |
| `armHoldMs` | `400` | How long the arming pose must be held before streaming starts |

`closeThreshold` and `armHoldMs` are starting points, expected to need empirical tuning per user/camera setup — same caveat as pinch-activate's `touchThreshold`.

`dist3d`/`handSize` are shared with pinch-activate via `src/gestures/utils.js`; `holdGate` is a new addition there for gestures that need a continuous "hold-to-arm, stream-while-held" pattern.

See ADR-003 for the rationale behind extending the gesture `detect()` contract to support this continuous, value-carrying return shape, and for the timestamp-threading fix that made a deterministic hold timer possible.

---
