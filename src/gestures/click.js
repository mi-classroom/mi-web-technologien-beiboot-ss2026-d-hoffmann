/**
 * @module click
 *
 * Command gesture: short touch of thumb tip and pinky fingertip - a "mouse
 * click" trigger, deliberately independent of the `cursor` gesture's own
 * thumb+index pinch so the two can be held/released without interfering
 * with each other (e.g. holding the cursor pinch to position the pointer,
 * then a separate quick thumb+pinky touch to click it).
 *
 * ## Detection logic
 *
 * Same pinch-distance formula as `pinch-activate`/`cursor`
 * (`dist3d`/`handSize` ratio), but fires as a **one-shot trigger** rather
 * than an arm-and-stream gesture: unlike `fist`/`flat-hand` (which require a
 * full-second hold, appropriate for poses that could otherwise occur by
 * accident), a pinch touch is already a deliberate, low-false-positive-risk
 * pose, so only a short `holdMs` is used - just enough to filter out a
 * single noisy detection frame, not a "hold to confirm" delay.
 *
 * Fires once when the touch is confirmed (held for `holdMs`), then requires
 * the fingertips to separate before it can fire again - same one-shot
 * reset semantics as `fist`/`flat-hand`.
 *
 * ## Default config
 *
 * ```js
 * {
 *   fingerA:        4,    // thumb tip
 *   fingerB:        20,   // pinky fingertip
 *   touchThreshold: 0.4,  // pinch distance / hand size to count as "touching"
 *   holdMs:         50,   // short confirmation hold, not a deliberate delay
 * }
 * ```
 */

import { dist3d, handSize } from './utils.js';

export const click = {
  name: 'click',
  role: 'command',

  /** Default configuration values. Can be overridden via gestureConfig in createGestureLibrary(). */
  config: {
    /** Landmark index of the first touch fingertip. Default: thumb tip (4). */
    fingerA: 4,
    /** Landmark index of the second touch fingertip. Default: pinky fingertip (20). */
    fingerB: 20,
    /** Maximum touch distance, expressed as a ratio of hand size, to count as "touching". */
    touchThreshold: 0.4,
    /** How long (ms) the touch must be held before the click fires - short, just noise-filtering. */
    holdMs: 50,
  },

  /**
   * Detect a short thumb+pinky touch ("click").
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @param {{ holdSince: number|null, fired: boolean }} frameState
   * @param {{ fingerA: number, fingerB: number, touchThreshold: number, holdMs: number }} config
   * @param {number} timestamp - Current frame timestamp.
   * @returns {boolean} true on the single frame where the hold threshold is crossed
   */
  detect(landmarks, frameState, config, timestamp) {
    const size = handSize(landmarks);
    if (size === 0) return false; // degenerate frame, skip

    const touching =
      dist3d(landmarks[config.fingerA], landmarks[config.fingerB]) / size < config.touchThreshold;

    if (!touching) {
      frameState.holdSince = null;
      frameState.fired = false;
      return false;
    }

    if (frameState.holdSince === null) {
      frameState.holdSince = timestamp;
      frameState.fired = false;
    }

    if (frameState.fired) return false; // already fired this touch, wait for release

    const heldMs = timestamp - frameState.holdSince;
    if (heldMs >= config.holdMs) {
      frameState.fired = true;
      return true;
    }

    return false;
  },
};
