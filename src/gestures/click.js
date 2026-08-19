/**
 * @module click
 *
 * Command gesture: "click" — thumb tip and pinky tip touch briefly.
 *
 * Modelled as a quick tap rather than a long dwell: the two fingertips must
 * come within `touchThreshold` of each other and stay there for at least
 * `touchMs` (short, default 150 ms) before the event fires once.
 *
 * ## Detection logic
 *
 * Euclidean distance in normalised 3-D coordinates (x, y, z) between the two
 * configured fingertip landmarks, normalised by the current hand size (wrist
 * lm 0 → middle-finger MCP lm 9) — same approach as `pinch-activate` (see
 * ADR-003), so the threshold is scale-invariant and robust against the hand
 * being tilted edge-on to the camera.
 *
 * ```
 * touching = dist3d(lm[fingerA], lm[fingerB]) / handSize < config.touchThreshold
 * ```
 *
 * ## Hold behaviour
 *
 * Same one-shot pattern as `flat-hand`/`fist`: the event fires once per
 * continuous touch that reaches `config.touchMs`, then requires the tips to
 * separate again before it can fire again. Unlike `flat-hand`/`fist`
 * (default `holdMs: 1000`), `touchMs` defaults to a short 150 ms so the
 * gesture reads as a quick tap/click rather than a sustained hold.
 *
 * ## Default config
 *
 * ```js
 * {
 *   fingerA:        4,     // thumb tip
 *   fingerB:        20,    // pinky fingertip
 *   touchThreshold: 0.3,   // ratio relative to hand size (wrist → middle MCP)
 *   touchMs:        150,   // required touch duration before firing (ms)
 * }
 * ```
 *
 * Override per-instance via:
 * ```js
 * createGestureLibrary({
 *   gestureConfig: {
 *     'click': { fingerA: 4, fingerB: 8, touchThreshold: 0.25, touchMs: 100 }
 *   }
 * })
 * ```
 *
 * Common landmark indices:
 *   4  = thumb tip
 *   8  = index fingertip
 *   12 = middle fingertip
 *   16 = ring fingertip
 *   20 = pinky fingertip
 */

import { dist3d, handSize } from './utils.js';

/**
 * Click gesture definition.
 *
 * @type {{ name: string, role: string, config: object, detect: Function }}
 */
export const click = {
  name: 'click',
  role: 'command',

  /** Default configuration values. Can be overridden via gestureConfig in createGestureLibrary(). */
  config: {
    /** Landmark index of the first fingertip involved in the click. Default: thumb tip (4). */
    fingerA: 4,
    /** Landmark index of the second fingertip involved in the click. Default: pinky fingertip (20). */
    fingerB: 20,
    /**
     * Maximum touch distance expressed as a ratio of the current hand size
     * (wrist lm 0 → middle-finger MCP lm 9). Same scale-invariant approach
     * as pinch-activate's `touchThreshold`.
     */
    touchThreshold: 0.3,
    /** How long (ms) the tips must stay touching before the event fires. Kept short for a "click" feel. */
    touchMs: 150,
  },

  /**
   * Detect a brief thumb-pinky touch ("click").
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @param {{ holdSince: number|null, fired: boolean }} frameState
   * @param {{ fingerA: number, fingerB: number, touchThreshold: number, touchMs: number }} config
   * @param {number} timestamp - Current frame timestamp (forwarded by the library's process()).
   * @returns {boolean} true on the single frame where the touch threshold is crossed
   */
  detect(landmarks, frameState, config, timestamp) {
    const size = handSize(landmarks);
    if (size === 0) {
      // Degenerate frame — treat as not touching, but don't lose an in-progress hold.
      return false;
    }

    const touchDist = dist3d(landmarks[config.fingerA], landmarks[config.fingerB]);
    const touching  = (touchDist / size) < config.touchThreshold;

    if (!touching) {
      // Touch broken — reset state.
      frameState.holdSince = null;
      frameState.fired     = false;
      return false;
    }

    // Touch is active.
    if (frameState.holdSince === null) {
      frameState.holdSince = timestamp;
      frameState.fired     = false;
    }

    if (frameState.fired) return false; // already fired this touch, wait for release

    const heldMs = timestamp - frameState.holdSince;
    if (heldMs >= config.touchMs) {
      frameState.fired = true;
      return true;
    }

    return false;
  },
};
