# Gesture-controlled media gallery

A from-scratch gesture-recognition library built on top of [MediaPipe HandLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker), plus a gesture-controlled image/video gallery built entirely on that library's public API - no mouse or keyboard required once gesture mode is active.

**Live demo:** https://mi-classroom.github.io/mi-web-technologien-beiboot-ss2026-d-hoffmann/

A `/test/` page is also deployed alongside the gallery - it's an earlier hand-tracking-modes demo, kept for reference. It shares the same gesture library but has no proper application logic of its own.

> Video walkthrough and code demo: https://th-koeln.sciebo.de/public.php/dav/files/wkBy8LiqT3oWrFE/demovideo-david-hoffmann.mp4

---

## About this project

- **Author:** David Hoffmann
- **Institution / Program:** TH Köln, M.Sc. Digital Sciences
- **Module:** Web Technologies
- **Semester:** SS2026
- **Supervision:** Christian Noss
- **Type of work:** Semester project, developed incrementally session by session with in-class progress reviews and code discussions (see `docs/tasks/` for the brief given at each session and `docs/time-allocation/` for time tracking per assignment)

**Goal:** the module's overarching goal is a reusable, documented JavaScript library that detects body data (hands, gestures, pose, proximity) from the webcam via on-device ML and exposes it to any consuming web application without requiring ML or computer-vision knowledge from the consumer. This repository implements that goal for **hands and hand gestures**, plus a gesture-controlled image/video gallery as a first real consuming application, built as groundwork for a possible future client-server tool for managing IPTC image metadata.

Each session incrementally extended the gesture vocabulary and the consuming application; architectural decisions made along the way are recorded as ADRs in [`docs/adr/`](docs/adr/).

**AI tool usage:** AI assistants (Gemini, Antigravity, Perplexity and OpenCode) were used throughout development for implementation, debugging, and documentation. Usage is disclosed per phase and per assignment in `docs/time-allocation/`.

---

## Requirements

- **Node.js** `^20.19.0` or `>=22.12.0` (see `engines` in `package.json`) and npm
- A **webcam** and a browser with **WebGL/GPU** support (the hand landmarker requests a GPU delegate; headless/server environments will not work)
- A **secure context** - `https://` or `localhost` (see [Local setup](#local-setup))
- **Internet access at runtime** - the hand-tracking model and its runtime are fetched from a CDN on load (see [Runtime dependencies](#runtime-dependencies)); nothing is bundled locally

**Privacy note:** the webcam feed is only ever processed locally in the browser to detect hand landmarks. No video or image is recorded, uploaded, or stored anywhere.

---

## Local setup

```bash
npm install
npm run dev
```

This starts a Vite dev server on plain `http://localhost`. That's deliberate: `getUserMedia` (webcam access) requires a secure context, but `http://localhost` already counts as one in every major browser, so no TLS certificate is needed for local development.

- **`/`** - the gallery app (the main deliverable)
- **`/test/`** - the older hand-tracking-modes demo

Other scripts:

```bash
npm run build     # production build -> dist/ (both apps, multi-page)
npm run preview   # serve the dist/ build locally
npm run lint          # ESLint (recommended rules, no auto-formatting rules)
npm run format        # Prettier - writes fixes
npm run format:check  # Prettier - check only, no writes (used in CI)
```

---

## Using the gallery

1. **Welcome screen** - grant camera access via an explicit button (not requested automatically on load).
2. **Choose a source** - bundled demo images and video, or upload your own images/videos from disk.
3. **Grid view** - thumbnails of everything loaded.
4. **Detail view** - one image or video at a time, with zoom (images) or playback (video).

Once gesture mode is active, an on-screen virtual cursor follows your hand, and clicking whatever's under it drives all navigation - the same buttons and thumbnails a mouse user would use, so most interactivity needs no gesture-specific wiring.

### Gesture cheat sheet

| Gesture | Hand | Effect | Where |
|---|---|---|---|
| Pinch thumb + index, hold | left | Activates/holds gesture control | global |
| Pinch thumb + index, hold and move | right | Moves the on-screen cursor | global |
| Touch thumb + pinky | right | Clicks whatever's under the cursor | global |
| Swipe left / right | right | Next / previous item | detail view only |
| Flat hand, hold | right | Plays the video | detail view, video only |
| Fist, hold | right | Pauses the video (1st hold), closes detail (2nd hold); closes immediately for images | detail view only |
| Curl outer fingers + pinch thumb/index, then stream | right | Zooms the image | detail view, images only |

Gesture control is a **continuous hold**, not a toggle - releasing the activation pinch suspends command detection shortly after (see [Activation model](#activation-model)).

**Keyboard fallback** (for testing without a camera, and for accessibility): `Esc` closes detail, `←`/`→` navigate, `Enter` opens the selected grid item.

---

## Deploying

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages automatically on every push to `main`:

1. `npm ci` then `npm run build`, with `GH_PAGES_BASE=/<repo-name>/` set so Vite's `base` matches the project-page subpath GitHub Pages serves from (`https://<org>.github.io/<repo>/`, not the domain root).
2. The `dist/` output is uploaded as a Pages artifact and deployed via `actions/deploy-pages`.

To deploy your own fork:

1. In the repo settings, set **Pages -> Source** to "GitHub Actions".
2. Push to `main` (or run the workflow manually via `workflow_dispatch`).
3. If you deploy to a domain root instead of a project-page subpath, don't set `GH_PAGES_BASE` (or set it to `/`) - `vite.config.js` defaults `base` to `/` when the variable is unset.

---

## Repository structure

```
index.html               # gallery app entry (deployed to Pages root)
gallery/
  gallery.js               # gallery app shell: webcam, MediaPipe, gesture wiring, view logic
  gallery.css               # gallery styles
  samples/                # bundled demo images/video
test/
  index.html                # older hand-tracking-modes demo entry (secondary /test/ page)
  main.js                   # demo app shell
  style.css                  # demo styles
src/gestures/             # the shared gesture library, consumed by both apps above
docs/adr/                 # Architectural Decision Records
docs/gestures.md          # gesture vocabulary: implemented vs. planned
vite.config.js            # multi-page build (gallery + test), GH_PAGES_BASE-driven `base`
```

See [`docs/adr/`](docs/adr/) for the reasoning behind these decisions, and [`docs/gestures.md`](docs/gestures.md) for the full gesture-vocabulary design.

---

## Runtime dependencies

Both apps fetch the following at startup - no local model files are bundled:

- **WASM runtime:** `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm` (not pinned to the installed package version)
- **Model:** `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
- `HandLandmarker` runs with `delegate: 'GPU'`, `runningMode: 'VIDEO'`, `numHands: 2`

---

## Library reference

The library separates gesture *recognition* from gesture *application logic*. Each gesture is an independent, self-contained definition object. The library manages activation gating, hand routing, mutual exclusion between command gestures, frame state, and event dispatch - gesture modules only describe how to detect a single pose.

### Concepts

#### Activation model

Gesture mode works as a **continuous dead man's switch**: a designated *activation gesture* (default: `pinch-activate`) must be held on the *activation hand* for command gestures to be evaluated at all.

- **Entering:** the activation gesture must be detected continuously for `activationDebounceMs` (default `500`) before an `'activate'` event fires and command gestures start being evaluated.
- **Leaving:** once active, the activation gesture must be *absent* continuously for `deactivationDebounceMs` (default `300`) before a `'deactivate'` event fires and command gestures stop being evaluated. Release is debounced, not immediate.

#### Hand routing

- The **activation hand** (configured via `activationHand`, default `'left'`) performs the activation gesture.
- **Command gestures** are evaluated on the *opposite* hand.
- Handedness labels are corrected for the mirrored webcam feed by MediaPipe, so `'left'` means the user's left hand.
- If handedness data is unavailable, the library falls back to whichever hand was detected first, regardless of role.

#### Mutual exclusion between command gestures

Only **one** command gesture can be "active" at a time. Once a command gesture fires, it claims an exclusive lock:

- Every other command gesture's `detect()` is **not called at all** while the lock is held by a different gesture.
- When the lock changes hands, every *other* command gesture's `frameState` is reset to `{}`.
- The lock is released as soon as the current holder's hand leaves the frame, its `detect()` returns false, or gesture mode deactivates.

This prevents, e.g., a fast cursor drag from also tripping a swipe's velocity threshold in the same frame.

#### Frame state

Each registered gesture gets a private `frameState` object (`{}` initially, reset on `register()`), persisted across frames and passed by reference to `detect()`. Gestures mutate it freely to track hold timers, buffers, or arming flags. It's also exposed to command-gesture event listeners.

---

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

- `isActive` - getter, `null` before the first frame is processed, then `true`/`false`
- `activationHand` - getter, returns the configured activation hand

---

### `register(gesture)`

Registers a gesture definition with the library. Must be called before the first `process()` call.

```js
lib.register(flatHand);
```

Throws if the object does not have the required `name` (string) and `detect` (function) properties. Registering a gesture with an existing name **overwrites** the previous registration and resets its `frameState` to `{}`. Nothing enforces that only one `role: 'activation'` gesture exists - the activation gesture is simply whichever registered gesture's name matches `activationGesture`.

---

### `on(event, callback)`

Subscribes to a named event. Multiple listeners for the same event are supported (including duplicate registrations of the same callback).

```js
lib.on('flat-hand', (data) => { /* ... */ });
```

**Built-in events**

| Event | Fired when | `data` payload |
|---|---|---|
| `'activate'` | Activation gesture held for `activationDebounceMs` | `{ heldMs }` |
| `'deactivate'` | Activation gesture absent for `deactivationDebounceMs` | `{}` |
| `'frame'` | Every `process()` call, regardless of active state | `{ active, activationDetected, activationHeldMs, activationHandPresent, commandHandPresent }` |

**Gesture events**

Each registered command gesture emits an event matching its `name` when `detect()` returns a truthy result:

| Event | `data` payload |
|---|---|
| `'flat-hand'` / `'fist'` | `{ landmarks, frameState, value: undefined }` |
| `'cursor'` | `{ landmarks, frameState, value: { x, y } }` |
| `'click'` | `{ landmarks, frameState, value: undefined }` |
| `'zoom'` | `{ landmarks, frameState, value: <signed number, per-frame pinch delta> }` |
| `'swipe'` | `{ landmarks, frameState, value: { direction: 'left' \| 'right' } }` |
| _(any custom gesture name)_ | `{ landmarks, frameState, value }` |

---

### `off(event, callback)`

Removes a previously registered listener. Only the **first** match (by reference) is removed; the `callback` reference must match the one passed to `on()`.

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
const results = handLandmarker.detectForVideo(videoElement, performance.now());
lib.process(results, performance.now());
```

- Evaluates the activation gesture every frame regardless of current state.
- Evaluates command gestures only while gesture mode is active, subject to the [mutual-exclusion lock](#mutual-exclusion-between-command-gestures).
- Dispatches events synchronously before returning, always including a `'frame'` event.

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

The merged config (gesture defaults + overrides, shallow spread) is passed as the third argument to `detect()`.

Both consuming apps in this repo override `pinch-activate`'s default `fingerB` (`16`, ring tip) to `8` (index tip) - see `gallery/gallery.js` and `test/main.js` for the exact configs each app registers.

---

## Writing a custom gesture

A gesture definition is a plain object with four properties. `detect()` receives the resolved landmarks, the gesture's persistent `frameState`, the merged config, and the **timestamp forwarded from `process()`** - never call `performance.now()` inside `detect()` directly, so gesture logic stays testable and frame-timestamp-consistent.

```js
import { holdGate } from './gestures/utils.js';

const myGesture = {
  // Unique name; also the event name emitted when detected.
  name: 'my-gesture',

  // 'activation' (only one should be registered) or 'command'.
  role: 'command',

  // Default configuration values. Merged with per-instance overrides.
  config: {
    holdMs: 800,
  },

  // Called every frame while the relevant hand is in frame.
  // Return `true`/`false`, or `{ detected, value }` to also emit data.
  detect(landmarks, frameState, config, timestamp) {
    // landmarks  – Array of 21 { x, y, z } normalised points from MediaPipe
    // frameState – Mutable object persisted across frames (starts as {})
    // config     – Merged result of this.config + gestureConfig overrides
    // timestamp  – Forwarded unchanged from process(results, timestamp)

    const poseActive = /* your detection logic */ false;

    // holdGate arms/disarms based on continuous pose presence,
    // handling frameState.holdSince / frameState.armed for you.
    return holdGate(poseActive, frameState, config.holdMs, timestamp);
  },
};

lib.register(myGesture);
lib.on('my-gesture', ({ landmarks, frameState, value }) => console.log('detected!', value));
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

## `utils.js` helpers

| Export | Signature | Purpose |
|---|---|---|
| `dist3d` | `(a, b) => number` | Euclidean 3-D distance between two `{x, y, z}` landmarks |
| `handSize` | `(landmarks) => number` | `dist3d(wrist, middleMcp)` - the scale-normalisation reference used by every pinch/touch threshold |
| `holdGate` | `(poseActive, frameState, holdMs, timestamp) => boolean` | Continuous hold-to-arm gate: stays `true` while the pose persists past `holdMs`, resets on pose loss. Use for anything that should stay "on" while held, as opposed to firing once |
| `remapEdgeMargin` | `(v, margin) => number` | Clamps `v` to `[0, 1]`, then remaps the range excluding a `margin`-wide dead zone at each edge to full `[0, 1]` - used so cursor/overlay positions remain reachable without the hand leaving the tracked camera region |

---

## Bundled gestures

### `pinch-activate` - activation gesture

Two configurable fingertips brought together on the activation hand. Uses 3-D Euclidean distance normalised by hand size to make the threshold scale-invariant. Fires as a plain boolean (drives the library's `activate`/`deactivate` events, not its own gesture event).

| Config key | Default | Description |
|---|---|---|
| `fingerA` | `4` (thumb tip) | First landmark index |
| `fingerB` | `16` (ring tip) | Second landmark index - both apps override this to `8` (index tip) |
| `touchThreshold` | `0.3` | Max pinch distance as a fraction of hand size |

### `cursor` - command gesture

Thumb+index pinch held via `holdGate` for `armHoldMs`; while armed, streams the rolling-averaged pinch midpoint as an absolute on-screen position.

| Config key | Default | Description |
|---|---|---|
| `fingerA` | `4` | First landmark index |
| `fingerB` | `8` | Second landmark index |
| `touchThreshold` | `0.4` | Max pinch distance as a fraction of hand size |
| `armHoldMs` | `175` | Hold duration before the cursor arms and starts streaming |
| `smoothingFrames` | `3` | Rolling-average window size for the streamed position |
| `edgeMargin` | `0.15` | Dead-zone fraction remapped away at each frame edge (see `remapEdgeMargin`) |

Emits `{ detected: true, value: { x, y } }` (normalised `0-1`) while armed; `false` otherwise.

### `click` - command gesture

Thumb+pinky touch confirmed by a short hold, firing one-shot; requires separation before it can fire again.

| Config key | Default | Description |
|---|---|---|
| `fingerA` | `4` | First landmark index |
| `fingerB` | `20` (pinky tip) | Second landmark index |
| `touchThreshold` | `0.4` | Max touch distance as a fraction of hand size |
| `holdMs` | `50` | Hold duration before the click fires |

Emits a plain `true` on the single frame it fires.

### `zoom` - command gesture

Arms when three outer fingers curl toward the wrist (held via `holdGate`), then streams the frame-to-frame *delta* of the normalised thumb-index pinch distance - a signed value, not an absolute scale factor.

| Config key | Default | Description |
|---|---|---|
| `fingerA` | `4` | First pinch landmark |
| `fingerB` | `8` | Second pinch landmark |
| `outerFingers` | `[12, 16, 20]` | Fingertips that must curl toward the wrist to arm |
| `wristLandmark` | `0` | Wrist landmark index |
| `closeThreshold` | `1` | Max distance (fraction of hand size) between each outer fingertip and the wrist to count as curled |
| `armHoldMs` | `400` | Hold duration before zoom arms and starts streaming |

Emits `{ detected: true, value: <signed delta> }` while armed (positive = pinch opening/zoom in, negative = closing); `false` while unarmed or on the first armed frame.

### `swipe` - command gesture

Tracks a rolling window of one landmark's mirrored horizontal position and fires one-shot when average velocity exceeds a threshold, then cools down.

| Config key | Default | Description |
|---|---|---|
| `trackedLandmark` | `9` (middle MCP) | Landmark whose horizontal position is tracked |
| `windowMs` | `200` | Rolling window size for velocity calculation |
| `velocityThreshold` | `1.2` | Minimum horizontal velocity (x-units/second) to fire |
| `cooldownMs` | `500` | Minimum time between fires |

Emits `{ detected: true, value: { direction: 'left' | 'right' } }` on fire; `false` otherwise.

### `flat-hand` - command gesture

All four non-thumb fingertips above their PIP joints. Fires once after the pose is held for `holdMs`; resets when the pose is broken.

| Config key | Default | Description |
|---|---|---|
| `holdMs` | `1000` | Hold duration in ms before the event fires |

### `fist` - command gesture

All four non-thumb fingertips below their MCP joints. Same one-shot hold pattern as `flat-hand`. Note: the thumb is excluded from the check, so a thumbs-up pose also satisfies it.

| Config key | Default | Description |
|---|---|---|
| `holdMs` | `1000` | Hold duration in ms before the event fires |

---

## License

This project's own code is licensed under the [MIT License](./LICENSE).

Third-party dependencies and runtime-fetched assets (MediaPipe, the hand-landmarker model, sample media) are covered under their own terms - see [`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md).
