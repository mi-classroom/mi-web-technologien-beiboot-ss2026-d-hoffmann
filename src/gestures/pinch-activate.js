/**
 * @module pinch-activate
 *
 * Activation gesture: index fingertip (landmark 8) and pinky fingertip
 * (landmark 20) held close together.
 *
 * This gesture acts as the "dead man's switch" for the gesture library:
 * all command gestures fire only while this pose is continuously detected.
 * The library applies a configurable debounce hold before activating, so a
 * brief accidental touch does not trigger gesture mode.
 *
 * ## Detection logic
 *
 * Euclidean distance in normalised 2-D coordinates (x, y) between:
 *   - Index fingertip: landmark 8
 *   - Pinky fingertip: landmark 20
 *
 * Detected when: `distance(lm[8], lm[20]) < config.touchThreshold`
 *
 * The threshold is expressed in normalised units (0–1 across the frame
 * width/height). A value of 0.07 means the tips must be within 7% of the
 * frame's shorter dimension.
 *
 * ## Default config
 *
 * ```js
 * { touchThreshold: 0.07 }
 * ```
 *
 * Override per-instance via `createGestureLibrary({ gestureConfig: { 'pinch-activate': { touchThreshold: 0.05 } } })`.
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
    /** Maximum normalised distance between index tip (8) and pinky tip (20) to count as touching. */
    touchThreshold: 0.07,
  },

  /**
   * Detect whether the activation pinch is currently held.
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks - 21-point normalised landmark array
   * @param {object} _frameState - Unused for this static gesture (no temporal state needed)
   * @param {{ touchThreshold: number }} config - Merged config
   * @returns {boolean}
   */
  detect(landmarks, _frameState, config) {
    const indexTip = landmarks[8];
    const pinkyTip = landmarks[20];
    return dist2d(indexTip, pinkyTip) < config.touchThreshold;
  },
};
