/**
 * @module cursor
 *
 * Command gesture: pinch-armed, absolute-position pointer.
 *
 * Replaces the earlier `pan` design (see ADR-005's original text): instead
 * of streaming a joystick-style offset from an arm-moment baseline, this
 * gesture streams the **normalised touch-point position itself** — the
 * midpoint between the two pinched fingertips — every frame while the pinch
 * is held. The consuming application maps that normalised position through
 * its own hand-overlay rendering transform (mirroring + canvas scaling) to
 * get the exact on-screen pixel position where the pinch visually appears,
 * and positions a persistent cursor element there.
 *
 * Deliberately kept DOM-agnostic, like every other gesture in this library:
 * this module only ever works with normalised landmark coordinates. Mapping
 * to actual screen pixels is the consuming app's responsibility (it already
 * owns the canvas/video layout needed to do that correctly).
 *
 * ## Detection logic
 *
 * Same pinch-arm mechanic as the original `pan`/pinch-activate pattern:
 *
 * ```
 * poseActive = dist3d(lm[fingerA], lm[fingerB]) / handSize < touchThreshold
 * armed      = holdGate(poseActive, frameState, armHoldMs, timestamp)
 * ```
 *
 * While armed, every frame emits `{ detected: true, value: { x, y } }`,
 * where `x`/`y` is the smoothed (short rolling-average) midpoint between the
 * two pinched fingertips, in normalised (0-1) landmark coordinates.
 *
 * Releasing the pinch disarms the gesture immediately: `detect()` returns
 * `false` and no further `cursor` events fire until the next arm sequence.
 * The consuming app is expected to **keep the cursor visible at its last
 * position** when events stop arriving, rather than hiding it — pinching
 * only pauses updates, it does not remove the pointer from the screen.
 *
 * ## Default config
 *
 * ```js
 * {
 *   fingerA:         4,   // thumb tip
 *   fingerB:         8,   // index fingertip
 *   touchThreshold:  0.4, // pinch distance / hand size to count as "pinching"
 *   armHoldMs:       175, // ms the pinch must be held before arming
 *   smoothingFrames: 3,   // rolling-average window size for jitter smoothing
 * }
 * ```
 *
 * All values above are starting points, expected to need empirical tuning
 * per user/camera setup — same caveat as every other gesture in this
 * library (see ADR-003).
 */

import { dist3d, handSize, holdGate } from './utils.js';

export const cursor = {
  name: 'cursor',
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
    /** Rolling-average window size (in frames) used to smooth the touch-point position. */
    smoothingFrames: 3,
  },

  /**
   * Detect the pinch-armed absolute-position cursor gesture.
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @param {{ holdSince: number|null, armed: boolean, smoothBuffer: Array<{x:number,y:number}>|null }} frameState
   * @param {{ fingerA: number, fingerB: number, touchThreshold: number, armHoldMs: number, smoothingFrames: number }} config
   * @param {number} timestamp - Current frame timestamp.
   * @returns {boolean|{ detected: boolean, value: { x: number, y: number } }}
   */
  detect(landmarks, frameState, config, timestamp) {
    const size = handSize(landmarks);
    if (size === 0) return false; // degenerate frame, skip

    const poseActive =
      (dist3d(landmarks[config.fingerA], landmarks[config.fingerB]) / size) < config.touchThreshold;

    const armed = holdGate(poseActive, frameState, config.armHoldMs, timestamp);

    if (!armed) {
      frameState.smoothBuffer = null; // reset so re-arming never sees stale smoothing history
      return false;
    }

    const a = landmarks[config.fingerA];
    const b = landmarks[config.fingerB];
    const raw = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    if (!frameState.smoothBuffer) frameState.smoothBuffer = [];
    frameState.smoothBuffer.push(raw);
    if (frameState.smoothBuffer.length > config.smoothingFrames) frameState.smoothBuffer.shift();

    let avgX = 0, avgY = 0;
    for (const p of frameState.smoothBuffer) {
      avgX += p.x;
      avgY += p.y;
    }
    const smoothed = { x: avgX / frameState.smoothBuffer.length, y: avgY / frameState.smoothBuffer.length };

    return { detected: true, value: smoothed };
  },
};
