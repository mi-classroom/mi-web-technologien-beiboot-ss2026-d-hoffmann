# ADR-002: Heuristic-based static pose detection for gesture start/stop

**Status:** Accepted

**Date:** 2026-06-02

**Deciders:** David Hoffmann

## Context

Assignment 2 requires at least one or two prototypically implemented gestures with documented detection logic. The primary design concern is avoiding the Midas-touch problem: in a camera-always-on setup, any hand movement in frame risks being interpreted as an intentional command. A reliable activation/deactivation boundary must be established before further gesture interactions can be added safely.

The two candidates chosen — flat open hand (activate) and closed fist (deactivate) — are static poses. This means they can be evaluated on a single frame's landmark data without requiring trajectory or velocity history.

## Considered Options

### Option A: Per-frame heuristic (selected)
Classify the pose on every frame by comparing fingertip y-coordinates to PIP and MCP joint y-coordinates. Apply a 3-second continuous-hold requirement before the classification triggers a state change.

### Option B: MediaPipe GestureRecognizer task
Use the higher-level `GestureRecognizer` task from `@mediapipe/tasks-vision`, which includes a pre-trained model for common gestures (closed fist, open palm, thumbs up, etc.).

### Option C: Frame-buffer majority vote
Accumulate pose classifications over a rolling window of N frames and trigger only when a majority agree. No hold-time requirement.

## Decision

**Option A** is selected.

The custom heuristic was preferred over `GestureRecognizer` (Option B) because:
- The assignment explicitly asks for a self-designed algorithm with documented thresholds and logic. Using an opaque pre-trained model would satisfy the demo requirement but not the documentation requirement.
- `GestureRecognizer` cannot be combined with `HandLandmarker` in the same pipeline without initialising two separate task instances, which would increase performance cost.
- The two target poses (flat hand, fist) have high geometric contrast and are straightforward to express as landmark threshold rules.

Option C (majority vote) was not selected because a hold-time approach is semantically cleaner for this use case: the user must consciously sustain the pose, which mirrors the "press and hold" paradigm familiar from physical controls. A majority vote over N frames would be more robust against brief accidental breaks in recognition, but this does not appear to be necessary in practice.

## Implementation

Detection runs inside the `requestAnimationFrame` render loop after `HandLandmarker.detectForVideo`. Two functions handle the logic:

**`detectStaticPose(landmarks)`** — per-frame classifier

```
Flat hand:  landmarks[8|12|16|20].y  <  landmarks[6|10|14|18].y   (all 4 fingertips above PIP)
Fist:       landmarks[8|12|16|20].y  >  landmarks[5|9|13|17].y    (all 4 fingertips below MCP)
Otherwise:  null
```

Coordinate system: MediaPipe normalised coords, y = 0 at top, y = 1 at bottom.

**`updateGestureHold(currentPose)`** — hold-time state machine

```
state: { pose: 'flat'|'fist'|null, since: timestamp }

Each frame:
  if currentPose !== state.pose → reset state.since
  if currentPose !== null AND elapsed >= 2000ms → fire trigger, reset state
```

The state machine resets on pose change and after a trigger fires, preventing continuous re-triggering.

**`GESTURE_HOLD_MS = 3000`** — chosen empirically. Less produced too many accidental activations during natural hand movement; more felt unresponsive in testing.

## Consequences

### Positive
- Algorithm is fully adjustable via a single constant (`GESTURE_HOLD_MS`) and the y-coordinate comparisons.
- No additional model download or task initialisation. Hand landmarks are already available.
- When clearly positioning the hand in front of the camera, recognition works reliably.
- The 3-second hold eliminates nearly all accidental triggers observed during testing.

### Negative / Risks
- The y-axis comparison is binary, there is no tolerance band. People with non-standard resting hand positions (e.g. a habitually partially extended ring finger) may find it harder to reliably form a "fist" as defined.
- Thumb is excluded from both checks. A thumbs-up pose passes the fist check if the other four fingers are curled.
- The flat-hand check does not verify palm orientation (facing camera vs. facing away). A hand viewed edge-on with extended fingers may intermittently satisfy the extension condition.
- If the hand is not held orthogonal to the camera but tilted far downward, recognition breaks because the resting positions of the landmarks no longer fit the algorithm.

### Conclusion

For a more robust recognition of this and future gestures, the most reliable and time-efficient implementation would likely be a fine-tuned ML model. Such a model could learn how gestures are performed either from a small set of examples for the current user and environment, or from a larger dataset to generalise across user personas and situations such as varying camera orientations.