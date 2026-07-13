/**
 * @module gesture-utils
 *
 * Shared geometry and temporal-state helpers used by multiple gesture
 * definitions (pinch-activate, zoom). Kept in one place so the hand-size
 * normalisation strategy and hold-timing patterns stay consistent across
 * gestures.
 */

/**
 * Euclidean distance between two normalised 3-D landmark points.
 *
 * @param {{ x: number, y: number, z: number }} a
 * @param {{ x: number, y: number, z: number }} b
 * @returns {number}
 */
export const dist3d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Current hand size, used to normalise fingertip distances so thresholds
 * are independent of how far the hand is from the camera.
 *
 * Defined as the distance between the wrist (landmark 0) and the
 * middle-finger MCP (landmark 9) — the longest stable palm segment,
 * unaffected by finger curl. See ADR-003 for the full rationale.
 *
 * @param {Array<{ x: number, y: number, z: number }>} landmarks - 21-point normalised landmark array
 * @returns {number}
 */
export const handSize = (landmarks) => dist3d(landmarks[0], landmarks[9]);

/**
 * Generic "hold-to-arm" gate: tracks whether a boolean pose has been held
 * continuously for `holdMs`, and keeps it armed for as long as the pose
 * remains active — disarming immediately the moment the pose breaks.
 *
 * Unlike the one-shot hold pattern used by flat-hand/fist (fire once, then
 * require the pose to fully reset before firing again), this gate stays
 * "open" continuously once armed, which is the right shape for gestures
 * that need to stream a value every frame while a pose is maintained
 * (e.g. zoom).
 *
 * @param {boolean} poseActive - Whether the gating pose is detected this frame.
 * @param {{ holdSince: number|null, armed: boolean }} frameState - Mutable per-gesture state.
 * @param {number} holdMs - How long the pose must be held before arming.
 * @param {number} timestamp - Current frame timestamp.
 * @returns {boolean} Whether the gate is currently armed.
 */
export const holdGate = (poseActive, frameState, holdMs, timestamp) => {
  if (!poseActive) {
    frameState.holdSince = null;
    frameState.armed     = false;
    return false;
  }

  if (frameState.holdSince === null || frameState.holdSince === undefined) {
    frameState.holdSince = timestamp;
  }

  if (!frameState.armed && (timestamp - frameState.holdSince) >= holdMs) {
    frameState.armed = true;
  }

  return frameState.armed;
};
