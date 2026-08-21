# ADR-006: Mutual exclusion between command gestures

**Status:** Accepted

**Date:** 2026-08-17

**Deciders:** David Hoffmann

> **Note:** `pan` (referenced throughout this ADR) was later split into `cursor` (absolute pinch position) and `click` (one-shot thumb+pinky touch) - see ADR-005's "Superseded design" note. The mutual-exclusion mechanism this ADR describes is unaffected by that later split and still applies to the current gesture set.

## Context

While building the gallery viewer (ADR-005) and testing the new `pan` gesture, `fist` was observed firing unintentionally while `pan` was actively armed and streaming. `pan`'s arming pose (thumb+index pinch) leaves the other three fingers unconstrained, and in practice a pinching hand often curls those fingers enough to also satisfy `fist`'s detection condition (all four non-thumb fingertips below their MCP joints).

Before this fix, `process()` evaluated every registered command gesture independently, every frame, with no relationship between them: any number of command gestures could be simultaneously "detected" and would each independently emit their event. This is fine as long as gesture poses are mutually exclusive by construction, but there's no guarantee of that - as this incident demonstrates, two gestures can incidentally overlap for a real hand pose that wasn't specifically designed to avoid the collision.

## Considered Options

### Option A: Fix it per-gesture (make `fist`/`pan` mutually exclusive by construction)

E.g. make `fist` explicitly check that the pinch fingers (thumb, index) are *not* pinched, or make `pan` require the other three fingers to be extended.

**Rejected.** This only fixes the one collision observed; any future gesture pair could collide the same way, and each fix would need bespoke per-gesture logic aware of every *other* registered gesture's pose - this doesn't scale and re-introduces exactly the kind of cross-gesture coupling the factory-function/registry design (ADR-003) was meant to avoid.

### Option B: Priority ordering / explicit gesture groups

Let the consumer declare which gestures are mutually exclusive, or assign priorities, via `createGestureLibrary()` config.

**Rejected for now.** More flexible, but adds config surface and complexity for a problem where, in practice, every command gesture registered so far represents a distinct deliberate hand pose - there's no current use case where two command gestures are *supposed* to be detected simultaneously. A blanket rule is simpler and directly solves the reported problem without speculative configuration.

### Option C: Global mutual exclusion, first-detected-wins, at the library level - *selected*

At most one command gesture may be detected per frame. The first command gesture (in registration order) whose `detect()` reports `detected: true` claims an exclusive lock for as long as it keeps reporting detected; every other command gesture is skipped entirely (not even evaluated) while the lock is held. The lock releases the instant its owner stops being detected, after which any gesture may claim it again - as early as the same frame, if the release happens before the newly-claiming gesture's turn in registration order.

Implemented entirely inside `process()`'s command-gesture loop in `src/gestures/index.js`, using only the gesture's existing return contract (`boolean` or `{detected, value}`) - no new fields required on gesture definitions, no changes to `pan.js`, `zoom.js`, `fist.js`, or `flat-hand.js`.

## Decision

**Option C is selected and implemented.**

Additionally: whenever the lock changes hands (a *different* gesture claims it), every other command gesture's `frameState` is reset to `{}`. Without this, a gesture mid-way through its own hold timer when it gets suppressed (e.g. `fist` at 80% of `holdMs` when `pan` starts pinching) would silently keep its stale `holdSince` timestamp frozen in place, and could fire the instant it's un-suppressed based on real time that passed while it was blocked, rather than time the pose was actually continuously held after regaining focus. Resetting on lock transfer forces every suppressed gesture to restart its hold/arm sequence cleanly once it's eligible again.

The lock is also released on `deactivate` (leaving gesture mode entirely), so a stale lock never carries over into the next activation session.

## Consequences

### Positive
- Directly fixes the observed `fist`/`pan` collision, and any future collision between any pair of command gestures, without per-gesture awareness of what else is registered.
- No changes needed to any existing gesture definition - the fix lives entirely in the library's dispatch loop, consistent with the factory-function/registry architecture's separation of concerns (ADR-003).
- Resetting suppressed gestures' `frameState` on lock transfer prevents a subtle "instant fire from stale timer" bug that would otherwise be hard to reproduce/debug.

### Negative / Risks
- **Breaking change in behaviour** (not API shape): any consumer that relied on two command gestures firing in the same frame will now see only one. No such use case existed before this fix, so no known callers are affected, but it's a real behavioural change worth flagging for anyone extending the library later.
- **No opt-out**: the mutual exclusion is currently global and unconditional - there is no way to declare two specific gestures as intentionally non-conflicting. If a future gesture pair genuinely needs to run concurrently, this ADR's decision would need revisiting (see Option B, rejected only because no such case exists yet).
- **Registration-order-dependent tie-breaking**: if two gestures both first become detected on the exact same frame (no prior lock held), the one registered first in `register()` call order wins. This is implicit and easy to overlook when adding new gestures - worth a comment at each `register()` call site if this ever becomes a practical issue.
- **Up to one frame of latency** when the lock releases and a different, earlier-registered gesture happens to already be satisfied: if the lock holder is registered *after* that gesture, the release only takes effect fully starting the next frame (see in-code comment in `process()`). Negligible in practice (~16ms at 60fps).
