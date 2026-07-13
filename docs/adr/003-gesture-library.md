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

`createGestureLibrary(config)` returns `{ register, on, off, process, isActive, activationHand }`. All internal state (gesture registry, event listeners, activation hold timer) is held in the closure, invisible to callers.

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
3. Emits `'deactivate'` after `deactivationDebounceMs` of the activation gesture being continuously absent.
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

### Continuous-value gestures (zoom)

The one-shot hold pattern above is designed for discrete gestures where only "did this pose fire" matters. It does not fit gestures that need to fire repeatedly across frames while carrying a magnitude — e.g. zoom, which behaves like a trackpad pinch-to-zoom: it should emit an event on every frame the pinch distance is actively changing, along with *how much* it changed, so a consumer can apply the delta directly (`zoomLevel += value * sensitivity`).

This gap was already identified when the library was first extracted (see the "Negative / Risks" section below), but zoom was deferred to a later pass rather than solved at the time.

**Extension:** `detect(landmarks, frameState, config, timestamp)` may now return either:

- a plain `boolean` — unchanged behaviour for discrete gestures (flat-hand, fist, pinch-activate); or
- `{ detected: boolean, value }` — for continuous gestures. The library normalises both shapes in `process()` and threads `value` through to the emitted event payload: `emit(name, { landmarks, frameState, value })`.

This is fully backward compatible: existing gesture definitions that return a plain boolean are unaffected, since `value` is simply `undefined` for them. No changes were needed to the activation-gesture handling, which only ever cared about a boolean.

**Timestamp threading:** implementing the zoom hold-timer (below) surfaced a second, related gap: `flat-hand.js`/`fist.js` had been calling `performance.now()` directly inside `detect()` instead of using the `timestamp` argument the library already threads through `process(results, timestamp)` — a known inconsistency flagged in `AGENTS.md`. Building zoom's hold timer against `performance.now()` would have made it impossible to unit-test deterministically and inconsistent with how the *activation* gesture's own hold timer already works (which correctly uses the frame `timestamp`). This was fixed alongside the zoom work: `detect()` now always receives `timestamp` as its 4th argument, and `flat-hand`/`fist` were updated to use it instead of calling `performance.now()` themselves.

### Arm-then-stream gestures and the `holdGate` helper (zoom)

An initial version of zoom used two separate gestures (`zoom-in`/`zoom-out`), each firing whenever the thumb-index distance changed faster than a `deltaThreshold` between consecutive frames, gated only by the library's existing global activation (pinch-activate). In practice this made zoom indistinguishable from incidental hand movement: any sufficiently fast thumb/index separation while the command hand was doing something else (e.g. mid-swipe, or just resting) would fire zoom events, because the only gate was the coarse, library-wide "is gesture mode active at all" check — not "is the user *currently intending* to zoom".

**Considered options:**

1. **Keep the per-frame `deltaThreshold` gate, tune it higher.** Rejected — no threshold value cleanly separates "deliberate pinch-zoom" from "hand moving for some other reason", because the signal (thumb-index distance) is shared with plenty of incidental hand poses. The false-positive/false-negative tradeoff is fundamentally unresolvable at this single-frame gate.
2. **Add a second, gesture-scoped hold-to-arm gate before streaming, self-contained inside the zoom gesture file.** *Selected.* A deliberately unusual pose — middle/ring/pinky fingertips curled close to the wrist, leaving thumb and index free — must be held for `armHoldMs` before the gesture arms. Only once armed does the thumb-index distance stream every frame as a signed delta (no further noise threshold needed, since the arming pose already establishes clear intent). This mirrors the pinch-activate kill-switch philosophy (state is physically encoded in the pose, not a hidden toggle) but scoped to a single command gesture rather than the whole library.
3. **Promote "hold-to-arm" to a library-level concept** (e.g. gestures declaratively depending on another gesture being held). Rejected for now — this would be a second activation-gating mechanism layered on top of the existing one, adding real complexity to `index.js` for a need that, so far, only zoom has. Per the original Option B rationale (the extension point is the gesture registry, not the library core), the simpler path is to keep this logic inside the gesture definition itself. If more gestures need the same "arm, then stream" shape, this should be revisited.

The hold-to-arm/disarm bookkeeping (`holdSince`, `armed`) is identical in shape to the one-shot hold pattern already used by flat-hand/fist, just without the one-shot "fire once, wait for reset" behaviour — it stays armed continuously while the pose holds, and disarms the instant the pose breaks. This was factored into a small reusable `holdGate(poseActive, frameState, holdMs, timestamp)` helper in `src/gestures/utils.js`, alongside the already-shared `dist3d`/`handSize`, so any future gesture needing the same pattern doesn't have to reimplement it.

`zoom.js` combines both extensions: `holdGate()` gates a continuous thumb-index distance tracker in `frameState.prevRatio`, returning `{ detected, value: delta }` every armed frame. See `docs/gestures.md` for the full detection formula and config table.

### Activation model: continuous hold over stateful toggle

Assignment 2 used a **stateful toggle** for activation: holding a flat open hand for three seconds switched gesture mode ON; holding a fist for three seconds switched it OFF. The library retains these as command gestures but replaces the toggle model with a **continuous hold (kill-switch)**: the designated activation gesture — a pinch on the activation hand — must be physically held throughout the entire period during which commands are evaluated. The moment the pinch breaks, the exit debounce begins and commands stop within `deactivationDebounceMs`.

The toggle model has a fundamental predictability problem: the active/inactive state is a hidden boolean. A single accidental flat-hand detection silently switches the system ON, after which any subsequent hand movement in frame can fire a command without the user intending it. Because the system's state is not visible in the user's current posture, there is no intuitive way to notice this has happened.

The kill-switch resolves this directly. The activation state is always physically encoded in the user's posture: pinching means active, not pinching means inactive. No hidden state can get out of sync with user intent. If the user is not actively maintaining the pinch, nothing fires — there is no "accidentally left on" scenario.

This also makes the Midas-touch guard significantly cheaper. The toggle model required a 3 000 ms hold on the activation gesture because a false positive would silently and persistently change system state. With the kill-switch the cost of a false positive is bounded: the accidental activation lasts at most `activationDebounceMs + deactivationDebounceMs` (500 + 333 = ~833 ms in the current configuration) before the system returns to inactive on its own. The entry debounce can therefore be kept short enough to feel responsive without sacrificing safety.

A secondary benefit is comfort. A pinch is a deliberately unusual posture that is unlikely to occur during natural, non-intentional hand movement in front of a camera. A flat open hand, by contrast, is essentially the resting position of an unsuspecting hand — making it a poor choice as an activation guard. Replacing it with a pinch raises the accidental-activation floor considerably.

### Event discovery and subscription

Events are named after the gesture's `name` field. A gesture registered with `name: 'fist'` causes the library to emit `'fist'` when its detection condition is met. Consumers subscribe with `lib.on('fist', callback)` — no separate event catalogue or registration step is needed outside of the gesture definition itself.

Two lifecycle events, `'activate'` and `'deactivate'`, are emitted by the library regardless of which gestures are registered. They are always available as subscription targets.

Because the event name is intrinsic to the gesture definition object, a consumer can discover all subscribable gesture events by inspecting the `name` field of each registered gesture. The `on` / `off` interface follows the Node.js `EventEmitter` convention, making the subscription pattern immediately recognisable to JavaScript developers.

### User-configurable activation

Two configuration knobs make the activation experience explicitly shaped by user preference rather than hard-coded assumptions.

`activationHand: 'left' | 'right'` lets the user nominate which hand acts as the kill-switch. Command gestures are automatically routed to the opposite hand, so changing this single value also remaps commands — a left-handed user can mirror the entire interaction model without touching any gesture source file.

`gestureConfig['pinch-activate']` lets the user remap which two fingers form the pinch (`fingerA`, `fingerB`) and adjust the `touchThreshold` ratio. The defaults (thumb tip + index tip, threshold 0.4) work well for most users, but someone who finds that combination uncomfortable or unreliable — due to hand anatomy, injury, or simply preference — can switch to thumb + middle or lower the threshold without forking the library. Both knobs are plain data in the `createGestureLibrary` call and can be stored in a user settings object, making them straightforward to expose in a future preferences UI.

## Consequences

### Positive

- Gesture detection logic is fully decoupled from MediaPipe initialisation, webcam handling, and canvas rendering. `main.js` no longer contains any landmark arithmetic.
- New gestures are added by creating a new file and calling `lib.register(myGesture)` — no existing code is touched.
- Each gesture's config is independently tunable via the `gestureConfig` map without modifying gesture source files.
- The library has no dependencies; it can run in any environment that provides a `performance.now()` API.

### Negative / Risks

- The `isPinchDetectedInResults` helper in `main.js` duplicates the detection logic from `pinch-activate.js` (finger indices, threshold, and now the hand-size normalisation) to power the pre-activation status display. This could drift if the gesture definition changes. A future improvement would be to expose the activation gesture's raw detection result through the library's `process()` return value or a dedicated event.
- Hand routing assumes exactly two categories (`'left'` / `'right'`). If MediaPipe's output changes or a non-standard handedness label appears, the fallback is silently returning no landmarks. An explicit warning log would improve debuggability.
