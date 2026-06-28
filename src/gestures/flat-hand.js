/**
 * @module flat-hand
 *
 * Command gesture: open flat hand — all four non-thumb fingers fully extended.
 *
 * ## Detection logic
 *
 * For each of the four non-thumb fingers (index, middle, ring, pinky):
 *   fingertip.y < PIP_joint.y   →  finger is extended (y = 0 is top of frame)
 *
 * Landmarks used:
 *   Fingertips : 8 (index), 12 (middle), 16 (ring), 20 (pinky)
 *   PIP joints : 6 (index), 10 (middle), 14 (ring), 18 (pinky)
 *
 * All four must be extended for the gesture to fire.
 *
 * ## Hold behaviour
 *
 * The library's command gesture pipeline calls detect() every frame.
 * To avoid continuous event firing while the hand stays flat, this gesture
 * uses its `frameState` to implement a one-shot trigger with a required
 * hold period: the event fires once per continuous hold that reaches
 * `config.holdMs`, then resets so it will not fire again until the pose
 * is broken and re-formed.
 *
 * ## Default config
 *
 * ```js
 * { holdMs: 1000 }
 * ```
 */

/** Pairs of [fingertip index, PIP joint index] for the four non-thumb fingers. */
const FINGER_TIP_PIP = [
  [8,  6],  // index
  [12, 10], // middle
  [16, 14], // ring
  [20, 18], // pinky
];

/**
 * Flat-hand gesture definition.
 *
 * @type {{ name: string, role: string, config: object, detect: Function }}
 */
export const flatHand = {
  name: 'flat-hand',
  role: 'command',

  /** Default configuration values. */
  config: {
    /** How long (ms) the flat-hand pose must be held before the event fires. */
    holdMs: 1000,
  },

  /**
   * Detect a held flat-hand pose.
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @param {{ holdSince: number|null, fired: boolean }} frameState
   * @param {{ holdMs: number }} config
   * @returns {boolean} true on the single frame where the hold threshold is crossed
   */
  detect(landmarks, frameState, config) {
    // Check all four fingertips are above their PIP joints.
    const allExtended = FINGER_TIP_PIP.every(([tipIdx, pipIdx]) =>
      landmarks[tipIdx].y < landmarks[pipIdx].y
    );

    if (!allExtended) {
      // Pose broken — reset state.
      frameState.holdSince = null;
      frameState.fired     = false;
      return false;
    }

    // Pose is active.
    if (frameState.holdSince === null) {
      frameState.holdSince = performance.now();
      frameState.fired     = false;
    }

    if (frameState.fired) return false; // already fired this hold, wait for reset

    const heldMs = performance.now() - frameState.holdSince;
    if (heldMs >= config.holdMs) {
      frameState.fired = true;
      return true;
    }

    return false;
  },
};
