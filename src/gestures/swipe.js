/**
 * @module swipe
 *
 * Command gesture: velocity-based left/right swipe, tracked via the middle
 * finger's base knuckle (landmark 9 - the most stable palm reference point,
 * unaffected by finger curl; see `handSize()` in `utils.js`).
 *
 * This is the gesture originally speced in `docs/gestures.md` back in
 * Assignment 2 ("Navigate forward/back") but never implemented - it's
 * introduced now not as a replacement for click-driven navigation (the
 * gallery app's prev/next buttons already cover that via `cursor`+`click`,
 * per ADR-005), but as a quick, no-aim-required shortcut alongside them,
 * the same relationship `flat-hand`/`fist` have to the video's own
 * play/pause controls.
 *
 * Deliberately a different gesture "shape" from everything else in this
 * library so far: not a static pose held for a duration (`flat-hand`/
 * `fist`), not a pinch-armed continuous stream (`zoom`/`cursor`), but a
 * **trajectory-triggered one-shot** - it fires based on how fast a tracked
 * point has moved over a short recent window, not on any particular hand
 * shape. No finger pose is required at all; any hand shape moving fast
 * enough horizontally will trigger it.
 *
 * ## Detection logic
 *
 * A short rolling buffer of `{ x, timestamp }` samples (window
 * `windowMs`) is kept for landmark 9, **in mirrored/screen-space
 * coordinates** (`1 - landmark.x`) - the same convention used everywhere
 * else hand position is translated to what the user actually sees on
 * screen (see `cursor.js`, `remapEdgeMargin()`). Using raw camera-space `x`
 * directly would report swipe directions backwards from what the user
 * visually experiences, since the whole app mirrors the camera feed for
 * display. Each frame, average horizontal velocity is computed across that
 * window:
 *
 * ```
 * velocity = (newest.x - oldest.x) / (newest.timestamp - oldest.timestamp)   // mirrored x-units per ms
 * ```
 *
 * If `|velocity|` crosses `velocityThreshold`, the gesture fires once -
 * `{ direction: 'right' }` for a visually left-to-right motion (increasing
 * mirrored x), `{ direction: 'left' }` for the reverse - then enters a
 * cooldown (`cooldownMs`) during which it cannot fire again, and clears its
 * buffer so the next swipe is measured from a clean baseline rather than
 * carrying over trailing velocity from the previous one.
 *
 * ## Default config
 *
 * ```js
 * {
 *   trackedLandmark:   9,     // middle finger MCP
 *   windowMs:          200,   // rolling window used to compute velocity
 *   velocityThreshold: 1.2,   // normalised x-units per second to count as a swipe
 *   cooldownMs:        500,   // how long after firing before it can fire again
 * }
 * ```
 *
 * All values above are starting points, expected to need empirical tuning
 * per user/camera setup - same caveat as every other gesture in this
 * library (see ADR-003).
 *
 * ## Known overlap caveat
 *
 * Like `zoom`/`cursor` sharing the thumb+index pinch pose (see ADR-005),
 * `swipe` evaluates independently of any other gesture: fast horizontal
 * hand movement while `cursor` is pinch-armed (e.g. dragging the pointer)
 * could also cross the velocity threshold and fire an unwanted swipe. No
 * pinch-guard is applied here - the consuming app is expected to only act
 * on `swipe` events while in a context where it's meaningful (e.g. the
 * gallery app's detail view), which limits how often the two would
 * realistically overlap in practice.
 */

export const swipe = {
  name: 'swipe',
  role: 'command',

  /** Default configuration values. Can be overridden via gestureConfig in createGestureLibrary(). */
  config: {
    /** Landmark index tracked for horizontal movement. Default: middle finger MCP (9). */
    trackedLandmark: 9,
    /** Rolling window (ms) over which velocity is measured. */
    windowMs: 200,
    /** Minimum |velocity| (normalised x-units per second) to count as a swipe. */
    velocityThreshold: 1.2,
    /** How long (ms) after firing before the gesture can fire again. */
    cooldownMs: 500,
  },

  /**
   * Detect a velocity-triggered horizontal swipe.
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @param {{ buffer: Array<{x: number, timestamp: number}>|null, cooldownUntil: number|null }} frameState
   * @param {{ trackedLandmark: number, windowMs: number, velocityThreshold: number, cooldownMs: number }} config
   * @param {number} timestamp - Current frame timestamp.
   * @returns {boolean|{ detected: boolean, value: { direction: 'left'|'right' } }}
   */
  detect(landmarks, frameState, config, timestamp) {
    if (!frameState.buffer) frameState.buffer = [];

    // Still cooling down from the last swipe: keep the buffer clear so the
    // next measurement starts from a clean baseline instead of carrying
    // over trailing velocity from the swipe that just fired.
    if (frameState.cooldownUntil !== null && frameState.cooldownUntil !== undefined) {
      if (timestamp < frameState.cooldownUntil) {
        frameState.buffer = [];
        return false;
      }
      frameState.cooldownUntil = null;
    }

    const point = landmarks[config.trackedLandmark];
    const mirroredX = 1 - point.x; // screen-space x, matching cursor.js/remapEdgeMargin's convention
    frameState.buffer.push({ x: mirroredX, timestamp });

    // Drop samples older than the rolling window.
    const cutoff = timestamp - config.windowMs;
    while (frameState.buffer.length > 0 && frameState.buffer[0].timestamp < cutoff) {
      frameState.buffer.shift();
    }

    if (frameState.buffer.length < 2) return false; // not enough history yet

    const oldest = frameState.buffer[0];
    const newest = frameState.buffer[frameState.buffer.length - 1];
    const elapsedMs = newest.timestamp - oldest.timestamp;
    if (elapsedMs <= 0) return false; // degenerate frame, skip

    const velocity = ((newest.x - oldest.x) / elapsedMs) * 1000; // mirrored x-units per second

    if (Math.abs(velocity) < config.velocityThreshold) return false;

    frameState.cooldownUntil = timestamp + config.cooldownMs;
    frameState.buffer = [];

    // Increasing mirrored x = visually left-to-right motion on screen.
    const direction = velocity > 0 ? 'right' : 'left';
    return { detected: true, value: { direction } };
  },
};
