/**
 * @module fist
 *
 * Command gesture: closed fist — all four non-thumb fingers fully curled.
 *
 * ## Detection logic
 *
 * For each of the four non-thumb fingers (index, middle, ring, pinky):
 *   fingertip.y > MCP_joint.y   →  finger is curled (y = 0 is top of frame)
 *
 * Landmarks used:
 *   Fingertips : 8 (index), 12 (middle), 16 (ring), 20 (pinky)
 *   MCP joints : 5 (index), 9 (middle), 13 (ring), 17 (pinky)
 *
 * All four must be curled for the gesture to fire.
 *
 * Note: the thumb is excluded from both the flat-hand and fist checks.
 * A thumbs-up pose therefore satisfies the fist condition if the other
 * four fingers are curled — this is intentional for the current gesture set
 * and will be addressed when a dedicated thumbs-up gesture is added.
 *
 * ## Hold behaviour
 *
 * Same one-shot hold pattern as flat-hand: fires once per continuous hold
 * that reaches `config.holdMs`, then resets when the pose is broken.
 *
 * ## Default config
 *
 * ```js
 * { holdMs: 1000 }
 * ```
 */

/** Pairs of [fingertip index, MCP joint index] for the four non-thumb fingers. */
const FINGER_TIP_MCP = [
  [8,  5],  // index
  [12, 9],  // middle
  [16, 13], // ring
  [20, 17], // pinky
];

/**
 * Fist gesture definition.
 *
 * @type {{ name: string, role: string, config: object, detect: Function }}
 */
export const fist = {
  name: 'fist',
  role: 'command',

  /** Default configuration values. */
  config: {
    /** How long (ms) the fist pose must be held before the event fires. */
    holdMs: 1000,
  },

  /**
   * Detect a held closed-fist pose.
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @param {{ holdSince: number|null, fired: boolean }} frameState
   * @param {{ holdMs: number }} config
   * @returns {boolean} true on the single frame where the hold threshold is crossed
   */
  detect(landmarks, frameState, config) {
    // Check all four fingertips are below their MCP (base knuckle) joints.
    const allCurled = FINGER_TIP_MCP.every(([tipIdx, mcpIdx]) =>
      landmarks[tipIdx].y > landmarks[mcpIdx].y
    );

    if (!allCurled) {
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
