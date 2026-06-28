/**
 * @module pinch-activate
 *
 * Activation gesture: two fingertips held close together, configurable via
 * `fingerA` and `fingerB` landmark indices.
 *
 * Default: thumb tip (landmark 4) and ring fingertip (landmark 16).
 *
 * This gesture acts as the "dead man's switch" for the gesture library:
 * all command gestures fire only while this pose is continuously detected.
 * The library applies a configurable debounce hold before activating, so a
 * brief accidental touch does not trigger gesture mode.
 *
 * ## Detection logic
 *
 * Euclidean distance in normalised 2-D coordinates (x, y) between the two
 * configured fingertip landmarks.
 *
 * Detected when: `distance(lm[fingerA], lm[fingerB]) / handSize < config.touchThreshold`
 *
 * The pinch distance is **normalised by the current hand size** (wrist lm 0 →
 * middle-finger MCP lm 9) so the threshold is independent of how far the hand
 * is from the camera. A value of 0.3 means the tips must be within 30 % of the
 * wrist-to-middle-MCP distance, which corresponds to the same physical pinch
 * regardless of scale in the frame.
 *
 * ## Default config
 *
 * ```js
 * {
 *   fingerA:        4,     // thumb tip
 *   fingerB:        16,    // ring fingertip
 *   touchThreshold: 0.3,   // ratio relative to hand size (wrist → middle MCP)
 * }
 * ```
 *
 * Override per-instance via:
 * ```js
 * createGestureLibrary({
 *   gestureConfig: {
 *     'pinch-activate': { fingerA: 8, fingerB: 20, touchThreshold: 0.25 }
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

/**
 * Euclidean distance between two normalised 2-D landmark points.
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Pinch-activate gesture definition.
 *
 * @type {{ name: string, role: string, config: object, detect: Function }}
 */
export const pinchActivate = {
  name: 'pinch-activate',
  role: 'activation',

  /** Default configuration values. Can be overridden via gestureConfig in createGestureLibrary(). */
  config: {
    /** Landmark index of the first finger involved in the pinch. Default: thumb tip (4). */
    fingerA: 4,
    /** Landmark index of the second finger involved in the pinch. Default: ring fingertip (16). */
    fingerB: 16,
    /**
     * Maximum pinch distance expressed as a ratio of the current hand size
     * (wrist lm 0 → middle-finger MCP lm 9). Using a ratio rather than an
     * absolute normalised value makes the threshold scale-invariant: the same
     * physical pinch triggers at any distance from the camera.
     *
     * 0.3 ≈ tips within 30 % of the wrist-to-middle-MCP segment length.
     */
    touchThreshold: 0.3,
  },

  /**
   * Detect whether the activation pinch is currently held.
   *
   * The pinch distance is normalised by the current hand size (wrist lm 0 →
   * middle-finger MCP lm 9) so the threshold is independent of how far the
   * hand is from the camera.
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks - 21-point normalised landmark array
   * @param {object} _frameState - Unused for this static gesture (no temporal state needed)
   * @param {{ fingerA: number, fingerB: number, touchThreshold: number }} config - Merged config
   * @returns {boolean}
   */
  detect(landmarks, _frameState, config) {
    const handSize = dist2d(landmarks[0], landmarks[9]);
    if (handSize === 0) return false; // degenerate frame, skip

    const pinchDist = dist2d(landmarks[config.fingerA], landmarks[config.fingerB]);
    return (pinchDist / handSize) < config.touchThreshold;
  },
};
