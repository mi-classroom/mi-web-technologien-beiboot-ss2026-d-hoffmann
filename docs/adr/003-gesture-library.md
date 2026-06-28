# ADR-003: Factory-function gesture library with a GestureDefinition interface

**Status:** Accepted

**Date:** 2026-06-28

**Deciders:** David Hoffmann

## Context

Assignment 3 requires the prototypical gesture code from Assignment 2 to be restructured into a reusable, extensible library. The core design questions are:

1. **Shape of the public API** — how does a caller create a library instance and register gestures?
2. **Shape of a gesture definition** — what does a new gesture author have to implement?
3. **Activation gating** — the library must support a "dead man's switch" pattern where one designated gesture unlocks all other commands.
4. **Temporal state** — gestures that depend on history (velocity, hold duration) need per-gesture mutable state without polluting global scope.

The previous implementation had all gesture logic inlined in `src/main.js`, with no separation between detection logic, state management, and rendering.

## Considered Options

### Option A: Class-based (`new GestureLibrary(config)`)

Standard OOP approach. `GestureLibrary` is a class with `register()`, `on()`, and `process()` instance methods.

**Pros:** Familiar to developers from Java/TypeScript backgrounds; `instanceof` checks; clear prototype chain for potential subclassing.  
**Cons:** `this` binding issues when methods are passed as callbacks; prototype chain exposes internals unintentionally; class syntax adds ceremony without benefit in a plain-ES-module context.

### Option B: Factory function (`createGestureLibrary(config)`) — *selected*

A plain function that closes over private state and returns a minimal public object.

**Pros:** No `this`; all internal state is truly private via closure; return shape is a plain object — easy to mock, easy to document, zero prototype pollution; idiomatic for modern ES modules; every call produces a fully independent instance.  
**Cons:** No prototype chain, so extending the "class" is not possible — but the extension point here is the gesture registry, not the library itself, so this is not a relevant limitation.

### Option C: Plugin pattern (gesture = npm package)

Each gesture is a separate ES module exporting a standard interface. The library is just a runner.

**Pros:** Maximum decoupling; third-party gestures publishable to npm.  
**Cons:** Overhead of defining and documenting a full plugin contract is disproportionate for a university prototype; the factory function approach already achieves the same extensibility goal within a single repository.

## Decision

**Option B (factory function)** is selected.

`createGestureLibrary(config)` returns `{ register, on, off, process, isActive }`. All internal state (gesture registry, event listeners, activation hold timer) is held in the closure, invisible to callers.

### GestureDefinition interface

A gesture is a plain JavaScript object:

```js
{
  name:   string,               // unique event name emitted on detection
  role:   'activation'|'command',
  config: object,               // default config values (overridable per-instance)
  detect(landmarks, frameState, config): boolean
}
```

- `landmarks` — the 21-point normalised array for the relevant hand (resolved by the library based on `activationHand`)
- `frameState` — a mutable object the library passes through each frame; gesture authors use it for hold timers, velocity buffers, etc.
- `config` — the gesture's defaults merged with any per-instance overrides from `createGestureLibrary({ gestureConfig: { ... } })`

### Activation gating

One gesture is designated as the activation gesture via the `activationGesture` config key (default: `'pinch-activate'`). The library:

1. Evaluates the activation gesture every frame against `activationHand` (default: `'left'`).
2. Applies a debounce hold (`activationDebounceMs`, default: `500 ms`) before emitting `'activate'`.
3. Emits `'deactivate'` immediately when the activation gesture is no longer detected.
4. Only evaluates command gestures while the library is active.

Command gestures are automatically routed to the **opposite** hand from `activationHand`. This is resolved inside the library; gesture definitions do not specify a hand.

### Hand routing

MediaPipe's `handednesses` array is parallel to `landmarks[]` and uses category names already corrected for the mirrored webcam feed ("Left" = user's left hand). The library iterates `handednesses` to find the correct entry and passes the matching landmark array to each gesture's `detect()`.

### Pinch distance normalisation

MediaPipe landmark coordinates are normalised to the video frame (0–1), not to the hand itself. A fixed absolute distance threshold therefore corresponds to a different physical pinch depending on how far the hand is from the camera: the same gesture at twice the distance appears at roughly half the normalised scale.

To make the threshold scale-invariant the pinch distance is divided by the current **hand size**, defined as the Euclidean distance between wrist (lm 0) and middle-finger MCP (lm 9). This segment is the longest stable palm segment, unaffected by finger curl, and reliably visible in all activation-pose configurations.

```
handSize   = dist2d(lm[0], lm[9])
pinchRatio = dist2d(lm[fingerA], lm[fingerB]) / handSize
detected   = pinchRatio < config.touchThreshold
```

`touchThreshold` is therefore a dimensionless ratio, not an absolute frame-space value. The default `0.3` means the tips must be within 30 % of the wrist-to-middle-MCP segment length — a consistent physical relationship at any camera distance.

Alternative normalisation references considered:

| Reference | Verdict |
|---|---|
| Wrist (0) → Middle MCP (9) | **Selected.** Long, stable, always visible. |
| Wrist (0) → Index MCP (5) | Also stable but shorter; less precision. |
| Palm bounding-box diagonal | No extra landmark needed, but shrinks in a fist — unreliable when fingers are curled. |
| Wrist (0) → Middle tip (12) | Longer, but tip position changes with finger curl. |

### Hold semantics for command gestures

Command gestures (flat-hand, fist) use their `frameState` to implement a one-shot hold: the event fires once when the pose has been held continuously for `holdMs`, then resets when the pose breaks. This prevents continuous event flooding while a static pose is maintained.

## Consequences

### Positive

- Gesture detection logic is fully decoupled from MediaPipe initialisation, webcam handling, and canvas rendering. `main.js` no longer contains any landmark arithmetic.
- New gestures are added by creating a new file and calling `lib.register(myGesture)` — no existing code is touched.
- Each gesture's config is independently tunable via the `gestureConfig` map without modifying gesture source files.
- The library has no dependencies; it can run in any environment that provides a `performance.now()` API.

### Negative / Risks

- The `isPinchDetectedInResults` helper in `main.js` duplicates the detection logic from `pinch-activate.js` (finger indices, threshold, and now the hand-size normalisation) to power the pre-activation status display. This could drift if the gesture definition changes. A future improvement would be to expose the activation gesture's raw detection result through the library's `process()` return value or a dedicated event.
- Hand routing assumes exactly two categories (`'left'` / `'right'`). If MediaPipe's output changes or a non-standard handedness label appears, the fallback is silently returning no landmarks. An explicit warning log would improve debuggability.
