# ADR-004: Push-based `'frame'` event for per-frame gesture status

**Status:** Accepted

**Date:** 2026-07-13

**Deciders:** David Hoffmann

## Context

Issue #4 requires building a standalone demo application that treats the gesture library purely as an external dependency, using only its public API (`register`, `on`, `off`, `process`, `isActive`, `activationHand`).

While wiring the demo's "hold to activate…" hint (a UI affordance that shows live progress toward activation, before the debounce threshold is reached), it became clear the public API has no way to answer a simple question: *"is the activation gesture currently detected right now, on this frame?"*

`isActive` only reports the **debounced, confirmed** state — it deliberately lags behind raw detection by `activationDebounceMs`/`deactivationDebounceMs`. That lag is correct for gating command gestures, but it makes `isActive` unusable for a responsive "you're pinching, keep holding…" hint.

This is not a new problem introduced by the demo. `src/main.js` already worked around the exact same gap: `isPinchDetectedInResults()` re-implements the pinch-distance/hand-size math from `pinch-activate.js` from scratch, reading `ACTIVATION_CONFIG` directly, just to drive the persistent activation hint in the sidebar. This duplication was flagged as a known-drift risk, the copy can silently diverge from the library's real detection logic (e.g. if `pinch-activate.js`'s formula changes, `main.js` won't follow).

The demo app needs the same live signal but, per the assignment's constraint, is not allowed to reach into library internals (registry, frame states, `resolveLandmarks`) to get it — it must go through the public API.

## Considered Options

### Option A: Expose internal state directly (registry, frameStates, resolveLandmarks)

Add getters that return the library's internal maps/functions so consumers can re-run detection themselves.

**Pros:** Maximum flexibility.
**Cons:** Breaks the closure-based encapsulation that ADR-003 explicitly chose the factory-function pattern to achieve; consumers would still have to know which gesture is the activation gesture and replicate the resolve/detect/merge-config sequence — this doesn't actually remove the duplication, it just relocates it.

### Option B: Pull-based `getSnapshot()` / `getState()` method

Add a method a consumer can call at any time to read the latest computed activation/detection state.

**Pros:** Simple mental model, no new event plumbing.
**Cons:** Requires the library to cache "latest" state from the last `process()` call for a value that is inherently a synchronous by-product of that same call; introduces a second way to get frame data (call `process()`, then separately call `getSnapshot()`) that has to be kept in sync by the consumer's call order. Since `process()` already computes everything needed on every call, pushing it out is more natural than caching it for a later pull.

### Option C: Push-based `'frame'` event — *selected*

Emit a new built-in event, `'frame'`, once at the end of every `process()` call (regardless of whether any gesture fired), carrying:

```js
{
  active,                  // debounced activation state (same as isActive)
  activationDetected,       // raw, non-debounced: is the activation gesture's detect() true this frame?
  activationHeldMs,         // ms the raw activation pose has been continuously held (0 if not held)
  activationHandPresent,    // is a hand resolved for the activation role this frame?
  commandHandPresent,       // is a hand resolved for the command role this frame?
}
```

**Pros:** Fits the library's existing event-driven public API (`on`/`off`) — no new access pattern for consumers to learn; purely additive, so no existing `register`/`on`/`process` call sites break; keeps all detection math inside the library, so both `main.js` and the new demo can subscribe instead of duplicating it; naturally fires exactly once per `process()` call, so there's no risk of stale reads.
**Cons:** Fires every frame (up to 60/s), so listeners must stay cheap — acceptable here since the intended use is a lightweight state assignment or DOM text update, not heavy computation.

## Decision

**Option C (`'frame'` event)** is selected and implemented in `src/gestures/index.js`.

`main.js`'s `isPinchDetectedInResults()` has been removed and replaced with a subscription to `'frame'`, reading `activationDetected` — the exact signal it was manually recomputing before. This retires the duplication flagged in `AGENTS.md` without changing the hint's visible behaviour.

The new demo app (`demo/`) uses the same event for its own activation-progress indicator, confirming the fix generalises beyond the one call site that originally exposed the gap.
