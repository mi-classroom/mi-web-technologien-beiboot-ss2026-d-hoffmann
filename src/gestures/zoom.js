/**
 * @module zoom
 *
 * Command gesture: arm-then-stream pinch zoom.
 *
 * Two-stage gesture designed to feel like a live trackpad pinch-to-zoom:
 *
 * 1. **Arming pose** — the three "outer" fingertips (middle, ring, pinky —
 *    landmarks 12, 16, 20) are held close to the wrist (landmark 0), leaving
 *    the thumb and index finger free. This is deliberately an unusual,
 *    two-handed-shape-like pose (similar to an "OK sign" without the pinch),
 *    unlikely to occur by accident while the user is simply moving their
 *    hand. It must be held continuously for `armHoldMs` before the gesture
 *    arms — see `holdGate()` in `utils.js`.
 * 2. **Streaming** — once armed, and for as long as the arming pose is
 *    maintained, the normalised distance between `fingerA` (thumb tip) and
 *    `fingerB` (index tip) is tracked frame-to-frame. Every armed frame emits
 *    `{ detected: true, value }`, where `value` is the signed per-frame delta
 *    of that distance: positive means the pinch is opening (zoom in),
 *    negative means it is closing (zoom out). There is no noise-gate
 *    threshold on the delta — the gesture streams continuously so a
 *    consumer can apply `value` directly to a live zoom level
 *    (e.g. `scale += value * sensitivity`).
 *
 * Breaking the arming pose (moving any of the three outer fingertips away
 * from the wrist) disarms the gesture immediately and resets both the hold
 * timer and the distance tracker, so the next arming sequence starts clean.
 *
 * ## Default config
 *
 * ```js
 * {
 *   fingerA:        4,          // thumb tip
 *   fingerB:        8,          // index fingertip
 *   outerFingers:   [12, 16, 20], // middle, ring, pinky tips
 *   wristLandmark:  0,
 *   closeThreshold: 0.6,        // outer fingertip-to-wrist ratio to count as "close"
 *   armHoldMs:      400,        // ms the arming pose must be held before streaming starts
 * }
 * ```
 *
 * `closeThreshold` and `armHoldMs` are starting points and are expected to
 * need empirical tuning per user/camera setup, same as pinch-activate's
 * `touchThreshold` — see ADR-003.
 */

import { dist3d, handSize, holdGate } from './utils.js';

export const zoom = {
  name: 'zoom',
  role: 'command',

  /** Default configuration values. Can be overridden via gestureConfig in createGestureLibrary(). */
  config: {
    /** Landmark index of the first pinch fingertip. Default: thumb tip (4). */
    fingerA: 4,
    /** Landmark index of the second pinch fingertip. Default: index fingertip (8). */
    fingerB: 8,
    /** Landmark indices that must be curled close to the wrist to arm the gesture. */
    outerFingers: [12, 16, 20],
    /** Landmark index of the wrist, used as the proximity reference for outerFingers. */
    wristLandmark: 0,
    /**
     * Maximum outer-fingertip-to-wrist distance, expressed as a ratio of
     * hand size, for a fingertip to count as "close to the wrist".
     */
    closeThreshold: 1,
    /** How long (ms) the arming pose must be held before streaming starts. */
    armHoldMs: 400,
  },

  /**
   * Detect the arm-then-stream pinch zoom.
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @param {{ holdSince: number|null, armed: boolean, prevRatio: number|null }} frameState
   * @param {{ fingerA: number, fingerB: number, outerFingers: number[], wristLandmark: number, closeThreshold: number, armHoldMs: number }} config
   * @param {number} timestamp - Current frame timestamp.
   * @returns {boolean|{ detected: boolean, value: number }}
   */
  detect(landmarks, frameState, config, timestamp) {
    const size = handSize(landmarks);
    if (size === 0) return false; // degenerate frame, skip

    const wrist = landmarks[config.wristLandmark];
    const poseActive = config.outerFingers.every((idx) =>
      (dist3d(landmarks[idx], wrist) / size) < config.closeThreshold
    );

    const armed = holdGate(poseActive, frameState, config.armHoldMs, timestamp);

    if (!armed) {
      frameState.prevRatio = null; // reset so re-arming never sees a stale jump
      return false;
    }

    const ratio = dist3d(landmarks[config.fingerA], landmarks[config.fingerB]) / size;

    if (frameState.prevRatio === null || frameState.prevRatio === undefined) {
      frameState.prevRatio = ratio;
      return false; // first armed frame: no delta available yet
    }

    const delta = ratio - frameState.prevRatio;
    frameState.prevRatio = ratio;

    return { detected: true, value: delta };
  },
};
