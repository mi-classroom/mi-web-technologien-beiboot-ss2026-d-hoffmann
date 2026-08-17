/**
 * @module pan
 *
 * Command gesture: pinch-armed, direct 1:1 pinch-point tracking.
 *
 * Modelled on `zoom`'s arm-then-stream pattern (see `zoom.js`) rather than
 * introducing a third gesture "shape" into the library:
 *
 * 1. **Arming pose** — thumb tip (`fingerA`) and index fingertip (`fingerB`)
 *    on the *command* hand are pinched together, using the exact same
 *    `dist3d`/`handSize` ratio formula as `pinch-activate`, but scoped to a
 *    fully independent config (`PAN_CONFIG` in the consuming app), since the
 *    command hand's natural pinch distance-from-camera may differ from the
 *    activation hand's. The pose must be held continuously for `armHoldMs`
 *    before it arms (see `holdGate()` in `utils.js`) to filter out fleeting
 *    accidental pinches.
 * 2. **Streaming** — once armed, the gesture tracks the **pinch point
 *    itself** (the midpoint between `fingerA` and `fingerB`), smoothed over
 *    a short rolling window (`smoothingFrames`) to reduce landmark jitter.
 *    The pinch point's position at the moment of arming is captured once as
 *    `origin`; every armed frame emits
 *    `{ detected: true, value: { dx, dy, originX, originY } }`, where
 *    `dx`/`dy` is the **raw** (not hand-size-normalised) movement of the
 *    pinch point since `origin`, in the same normalised video-frame
 *    coordinate space as MediaPipe landmarks (0–1). A consumer reconstructs
 *    the tracked point directly as `{ x: originX + dx, y: originY + dy }`
 *    and can map it onto a canvas with a straight multiply by canvas
 *    width/height — no accumulation or extra scaling needed, and no
 *    sensitivity constant required to "feel right": moving the pinch point
 *    across X% of the camera frame moves the consumer's cursor across
 *    exactly X% of its own coordinate space, at the same speed the hand
 *    moves on screen.
 *
 * Releasing the pinch disarms the gesture immediately, discarding both the
 * hold timer and the smoothing buffer/origin, so the next arming sequence
 * always starts from a clean reference point, re-anchored wherever the next
 * pinch happens to start — the same "physically encoded state" principle
 * used by `pinch-activate` and `zoom`.
 *
 * ## Why raw (un-normalised) movement, not hand-size-normalised
 *
 * `pinch-activate`/`zoom`/pan's own arming pose all normalise *distances*
 * (pinch gap, outer-fingertip-to-wrist gap) by hand size so a detection
 * *threshold* means the same physical pinch regardless of how close the
 * hand is to the camera. Tracking *position on screen* is a different
 * problem: the camera's field of view is fixed, so "the hand moved across
 * half the frame" already is the natural, camera-relative reference a
 * consumer wants to reproduce 1:1 on screen. Dividing that movement by hand
 * size would instead make the same on-screen movement produce a *smaller*
 * reported offset the closer the hand is to the camera (larger hand size),
 * which is the opposite of "moves at the same speed the hand moves in the
 * video" — so `dx`/`dy` here are deliberately left in raw normalised
 * video-frame units.
 *
 * ## Deadzone — why it's needed
 *
 * Unlike `zoom` (which streams a raw, un-gated per-frame delta by design —
 * see `zoom.js`), a *held* offset-from-origin accumulates the same landmark
 * jitter every single frame instead of it averaging out, so even a
 * genuinely still hand produces a small but constant nonzero `{dx, dy}` —
 * visible as a slow drift when a consumer tracks the point continuously. A
 * **radial deadzone** (`config.deadzone`, a ratio of hand size — kept
 * hand-size-relative so the filtered jitter band scales with how large the
 * hand appears, unlike the movement itself) filters this out: any offset
 * with magnitude below the deadzone is reported as `{dx: 0, dy: 0}`;
 * offsets beyond it are rescaled so movement starts smoothly at zero right
 * at the deadzone boundary instead of jumping discontinuously the instant
 * it's crossed.
 *
 * ```
 * deadzoneAbs = config.deadzone * handSize
 * magnitude   = hypot(dx, dy)
 * if magnitude <= deadzoneAbs:  { dx, dy } = { 0, 0 }
 * else:                         scale = (magnitude - deadzoneAbs) / magnitude
 *                               { dx, dy } = { dx * scale, dy * scale }
 * ```
 *
 * See ADR-005 for the full rationale and rejected alternatives (discrete
 * one-shot swipe, hand-size-normalised joystick-style offset, no arming
 * gate).
 *
 * ## Default config
 *
 * ```js
 * {
 *   fingerA:         4,     // thumb tip
 *   fingerB:         8,     // index fingertip
 *   touchThreshold:  0.4,   // pinch distance / hand size to count as "pinching"
 *   armHoldMs:       175,   // ms the pinch must be held before arming
 *   smoothingFrames: 5,     // rolling-average window size for jitter smoothing
 *   deadzone:        0.05,  // radial deadzone, ratio of hand size — filters out held-hand jitter
 * }
 * ```
 *
 * All values above are starting points, expected to need empirical tuning
 * per user/camera setup — same caveat as every other gesture in this
 * library (see ADR-003).
 */

import { dist3d, handSize, holdGate } from './utils.js';

export const pan = {
  name: 'pan',
  role: 'command',

  /** Default configuration values. Can be overridden via gestureConfig in createGestureLibrary(). */
  config: {
    /** Landmark index of the first pinch fingertip. Default: thumb tip (4). */
    fingerA: 4,
    /** Landmark index of the second pinch fingertip. Default: index fingertip (8). */
    fingerB: 8,
    /** Maximum pinch distance, expressed as a ratio of hand size, to count as "pinching". */
    touchThreshold: 0.4,
    /** How long (ms) the pinch must be held before the gesture arms. */
    armHoldMs: 175,
    /** Rolling-average window size (in frames) used to smooth the pinch-point position before computing the offset. */
    smoothingFrames: 5,
    /** Radial deadzone (ratio of hand size): offsets below this magnitude are reported as {dx:0, dy:0} to filter out held-hand jitter. */
    deadzone: 0.05,
  },

  /**
   * Detect the pinch-armed, direct pinch-point-tracking pan gesture.
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @param {{ holdSince: number|null, armed: boolean, origin: {x:number,y:number}|null, smoothBuffer: Array<{x:number,y:number}>|null }} frameState
   * @param {{ fingerA: number, fingerB: number, touchThreshold: number, armHoldMs: number, smoothingFrames: number, deadzone: number }} config
   * @param {number} timestamp - Current frame timestamp.
   * @returns {boolean|{ detected: boolean, value: { dx: number, dy: number, originX: number, originY: number } }}
   */
  detect(landmarks, frameState, config, timestamp) {
    const size = handSize(landmarks);
    if (size === 0) return false; // degenerate frame, skip

    const fA = landmarks[config.fingerA];
    const fB = landmarks[config.fingerB];

    const poseActive = (dist3d(fA, fB) / size) < config.touchThreshold;
    const armed = holdGate(poseActive, frameState, config.armHoldMs, timestamp);

    if (!armed) {
      frameState.origin       = null; // reset so re-arming never sees a stale reference point
      frameState.smoothBuffer = null;
      return false;
    }

    // Tracked point: the pinch point itself (midpoint of fingerA/fingerB),
    // so the reported position visually matches where the fingertips touch.
    const raw = { x: (fA.x + fB.x) / 2, y: (fA.y + fB.y) / 2 };

    if (!frameState.smoothBuffer) frameState.smoothBuffer = [];
    frameState.smoothBuffer.push(raw);
    if (frameState.smoothBuffer.length > config.smoothingFrames) frameState.smoothBuffer.shift();

    let avgX = 0, avgY = 0;
    for (const p of frameState.smoothBuffer) {
      avgX += p.x;
      avgY += p.y;
    }
    const smoothed = { x: avgX / frameState.smoothBuffer.length, y: avgY / frameState.smoothBuffer.length };

    if (!frameState.origin) {
      frameState.origin = smoothed; // capture the pinch point's position at the moment of arming
      return {
        detected: true,
        value: { dx: 0, dy: 0, originX: frameState.origin.x, originY: frameState.origin.y },
      };
    }

    // Raw (not hand-size-normalised) movement since origin — see module
    // docstring for why this must stay in raw video-frame units.
    const dx = smoothed.x - frameState.origin.x;
    const dy = smoothed.y - frameState.origin.y;

    // Radial deadzone: filters out the small but constant nonzero offset
    // that landmark jitter alone produces on a genuinely still hand. The
    // deadzone itself is expressed as a ratio of hand size (so the filtered
    // jitter band scales with how large the hand appears), then converted
    // to an absolute value in the same raw units as dx/dy before comparing.
    const deadzoneAbs = config.deadzone * size;
    const magnitude    = Math.hypot(dx, dy);

    if (magnitude <= deadzoneAbs) {
      return {
        detected: true,
        value: { dx: 0, dy: 0, originX: frameState.origin.x, originY: frameState.origin.y },
      };
    }

    const scale = (magnitude - deadzoneAbs) / magnitude;

    return {
      detected: true,
      value: {
        dx: dx * scale,
        dy: dy * scale,
        originX: frameState.origin.x,
        originY: frameState.origin.y,
      },
    };
  },
};
