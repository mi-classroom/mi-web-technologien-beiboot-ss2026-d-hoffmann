# gesture-library

A lightweight, extensible gesture recognition library built on top of [MediaPipe HandLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) results.

The library separates gesture *recognition* from gesture *application logic*. Each gesture is an independent, self-contained definition object. The library manages activation gating, hand routing, frame state, and event dispatch — gesture modules only describe how to detect a single pose.

For design rationales see docs/adr.

---

## Concepts

### Activation model

Gesture mode works as a **continuous dead man's switch**: a designated *activation gesture* (default: pinch-activate) must be held on the *activation hand* for all command gestures to fire. Releasing the activation gesture immediately suspends command detection. This is intentional — it prevents accidental triggers and gives the user explicit control over when the system is listening.

### Hand routing

- The **activation hand** (configured via `activationHand`) performs the activation gesture.
- **Command gestures** are evaluated on the *opposite* hand.
- Handedness labels are corrected for the mirrored webcam feed by MediaPipe, so `'left'` means the user's left hand.

### Frame state

Each registered gesture gets a private `frameState` object that persists across frames. Gesture definitions can use it freely to track hold timers, velocity history, counters, or any other temporal state. The library resets `frameState` to `{}` when a gesture is registered and does not touch it again.

---

## Installation

The library is framework-agnostic and has no dependencies beyond a MediaPipe `HandLandmarkerResult` input. Import directly from the source file:

```js
import { createGestureLibrary } from './gestures/index.js';
```

To use the bundled gestures, import them individually:

```js
import { pinchActivate } from './gestures/pinch-activate.js';
import { flatHand }      from './gestures/flat-hand.js';
import { fist }          from './gestures/fist.js';
```

---

## Quick start

```js
import { createGestureLibrary } from './gestures/index.js';
import { pinchActivate }        from './gestures/pinch-activate.js';
import { flatHand }             from './gestures/flat-hand.js';
import { fist }                 from './gestures/fist.js';

// 1. Create an instance
const lib = createGestureLibrary({ activationHand: 'left' });

// 2. Register gestures
lib.register(pinchActivate);  // role: 'activation'
lib.register(flatHand);       // role: 'command'
lib.register(fist);           // role: 'command'

// 3. Subscribe to events
lib.on('activate',   ()  => console.log('gesture mode ON'));
lib.on('deactivate', ()  => console.log('gesture mode OFF'));
lib.on('flat-hand',  ()  => console.log('flat hand detected'));
lib.on('fist',       ()  => console.log('fist detected'));

// 4. Feed frames from your render loop
function onFrame(handLandmarkerResults) {
  lib.process(handLandmarkerResults, performance.now());
  requestAnimationFrame(onFrame);
}
```

---

## API reference

### `createGestureLibrary(config?)`

Creates and returns a new library instance. All state is private to the instance (closure-based); multiple independent instances can coexist.

**Parameters**

| Option | Type | Default | Description |
|---|---|---|---|
| `activationGesture` | `string` | `'pinch-activate'` | Name of the registered gesture that acts as the activation trigger |
| `activationHand` | `'left'` \| `'right'` | `'left'` | Which hand performs the activation gesture |
| `activationDebounceMs` | `number` | `500` | Activation gesture must be held continuously for this many ms before gesture mode turns on |
| `deactivationDebounceMs` | `number` | `300` | Activation gesture must be absent for this many ms before gesture mode turns off |
| `gestureConfig` | `object` | `{}` | Per-gesture config overrides keyed by gesture name (see [Configuration overrides](#configuration-overrides)) |

**Returns** `{ register, on, off, process, isActive, activationHand }`

---

### `register(gesture)`

Registers a gesture definition with the library. Must be called before the first `process()` call.

```js
lib.register(flatHand);
```

Throws if the object does not have the required `name` (string) and `detect` (function) properties.

---

### `on(event, callback)`

Subscribes to a named event. Multiple listeners for the same event are supported.

```js
lib.on('flat-hand', (data) => { /* ... */ });
```

**Built-in events**

| Event | Fired when | `data` payload |
|---|---|---|
| `'activate'` | Activation gesture held for `activationDebounceMs` | `{ heldMs: number }` |
| `'deactivate'` | Activation gesture absent for `deactivationDebounceMs` | `{}` |

**Gesture events**

Each registered command gesture emits an event matching its `name` when `detect()` returns `true`:

| Event | `data` payload |
|---|---|
| `'flat-hand'` | `{ landmarks, frameState }` |
| `'fist'` | `{ landmarks, frameState }` |
| _(any custom gesture name)_ | `{ landmarks, frameState }` |

---

### `off(event, callback)`

Removes a previously registered listener. The `callback` reference must match the one passed to `on()`.

```js
const handler = () => console.log('fist!');
lib.on('fist', handler);
// later:
lib.off('fist', handler);
```

---

### `process(results, timestamp)`

Processes one frame of `HandLandmarkerResult` from MediaPipe. Call this every frame inside your render loop.

```js
// Inside requestAnimationFrame:
const results = handLandmarker.detectForVideo(videoElement, performance.now());
lib.process(results, performance.now());
```

- Evaluates the activation gesture every frame regardless of current state.
- Evaluates command gestures only while gesture mode is active.
- Dispatches events synchronously before returning.

---

### `isActive` (getter)

Returns `true` if gesture mode is currently active, `false` if not, `null` before the first frame is processed.

```js
if (lib.isActive) { /* gesture mode is on */ }
```

---

### `activationHand` (getter)

Returns the configured activation hand (`'left'` or `'right'`).

---

## Configuration overrides

Gesture defaults can be overridden per-instance without modifying the gesture file:

```js
const lib = createGestureLibrary({
  activationHand: 'right',
  activationDebounceMs: 300,
  gestureConfig: {
    'pinch-activate': {
      fingerA: 4,           // thumb tip
      fingerB: 8,           // index tip
      touchThreshold: 0.4,
    },
    'flat-hand': { holdMs: 500 },
    'fist':      { holdMs: 1500 },
  },
});
```

The merged config (gesture defaults + overrides) is passed as the third argument to `detect()`.

---

## Writing a custom gesture

A gesture definition is a plain object with four properties:

```js
const myGesture = {
  // Unique name; also the event name emitted when detected.
  name: 'my-gesture',

  // 'activation' (only one allowed) or 'command'.
  role: 'command',

  // Default configuration values. Merged with per-instance overrides.
  config: {
    holdMs: 800,
  },

  // Called every frame while the relevant hand is in frame.
  // Return true to fire the gesture event for this frame.
  detect(landmarks, frameState, config) {
    // landmarks  – Array of 21 { x, y, z } normalised points from MediaPipe
    // frameState – Mutable object persisted across frames (starts as {})
    // config     – Merged result of this.config + gestureConfig overrides

    // Example: fire once after holding a pose for config.holdMs
    const poseHeld = /* your detection logic */;

    if (!poseHeld) {
      frameState.holdSince = null;
      frameState.fired = false;
      return false;
    }

    if (frameState.holdSince === null) {
      frameState.holdSince = performance.now();
      frameState.fired = false;
    }

    if (frameState.fired) return false;

    if (performance.now() - frameState.holdSince >= config.holdMs) {
      frameState.fired = true;
      return true;
    }

    return false;
  },
};

lib.register(myGesture);
lib.on('my-gesture', (data) => console.log('detected!', data));
```

**MediaPipe landmark indices (commonly used)**

| Index | Landmark |
|---|---|
| 0 | Wrist |
| 4 | Thumb tip |
| 5, 9, 13, 17 | Index / Middle / Ring / Pinky MCP (base knuckle) |
| 6, 10, 14, 18 | Index / Middle / Ring / Pinky PIP (middle joint) |
| 8, 12, 16, 20 | Index / Middle / Ring / Pinky tip |

Y-axis: `0` = top of frame, `1` = bottom. A fingertip *above* a joint means `tip.y < joint.y`.

---

## Bundled gestures

### `pinch-activate` — activation gesture

Two configurable fingertips brought together on the activation hand. Uses 3-D Euclidean distance normalised by hand size (wrist → middle MCP) to make the threshold scale-invariant.

| Config key | Default | Description |
|---|---|---|
| `fingerA` | `4` (thumb tip) | First landmark index |
| `fingerB` | `16` (ring tip) | Second landmark index |
| `touchThreshold` | `0.3` | Max pinch distance as a fraction of hand size |

### `flat-hand` — command gesture

All four non-thumb fingertips above their PIP joints. Fires once after the pose is held for `holdMs`; resets when the pose is broken.

| Config key | Default | Description |
|---|---|---|
| `holdMs` | `1000` | Hold duration in ms before the event fires |

### `fist` — command gesture

All four non-thumb fingertips below their MCP joints. Same one-shot hold pattern as `flat-hand`.

| Config key | Default | Description |
|---|---|---|
| `holdMs` | `1000` | Hold duration in ms before the event fires |
