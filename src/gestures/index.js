/**
 * @module gesture-library
 *
 * A lightweight, extensible gesture recognition library built on top of
 * MediaPipe HandLandmarker results.
 *
 * ## Quick start
 *
 * ```js
 * import { createGestureLibrary } from './gestures/index.js';
 * import { pinchActivate }        from './gestures/pinch-activate.js';
 * import { flatHand }             from './gestures/flat-hand.js';
 *
 * const lib = createGestureLibrary({ activationHand: 'left' });
 *
 * lib.register(pinchActivate);   // role: 'activation'
 * lib.register(flatHand);        // role: 'command'
 *
 * lib.on('activate',   ()  => console.log('gesture mode ON'));
 * lib.on('deactivate', ()  => console.log('gesture mode OFF'));
 * lib.on('flat-hand',  ()  => console.log('flat hand!'));
 *
 * // Inside your render loop:
 * lib.process(handLandmarkerResults, performance.now());
 * ```
 *
 * ## Gesture definition interface
 *
 * A gesture definition is a plain object with the following shape:
 *
 * ```js
 * {
 *   name:   string,               // unique event name emitted when detected
 *   role:   'activation'|'command',
 *   config: object,               // default config values for this gesture
 *   detect(landmarks, frameState, config): boolean
 *   //  landmarks  – normalised 3-D landmark array for the relevant hand
 *   //  frameState – mutable object persisted across frames for this gesture
 *   //               (use it for velocity history, debounce counters, etc.)
 *   //  config     – merged result of gesture.config and per-instance overrides
 * }
 * ```
 *
 * ## Library config
 *
 * ```js
 * createGestureLibrary({
 *   activationGesture:    string,   // name of the activation gesture (default: 'pinch-activate')
 *   activationHand:       string,   // 'left' | 'right'  (default: 'left')
 *   activationDebounceMs: number,   // ms the activation gesture must be held (default: 500)
 *   gestureConfig:        object,   // per-gesture config overrides, keyed by gesture name
 * })
 * ```
 */

const DEFAULT_CONFIG = {
  activationGesture:    'pinch-activate',
  activationHand:       'left',
  activationDebounceMs: 500,
  gestureConfig:        {},
};

/**
 * Create a new gesture library instance.
 *
 * @param {object} [userConfig] - Optional configuration (see module docs).
 * @returns {{ register, on, off, process, isActive }}
 */
export function createGestureLibrary(userConfig = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...userConfig };

  // --- Internal state ---

  /** @type {Map<string, object>} name → gesture definition */
  const registry = new Map();

  /** @type {Map<string, object>} name → per-gesture frame state */
  const frameStates = new Map();

  /** @type {Map<string, Function[]>} event name → listener array */
  const listeners = new Map();

  /**
   * Whether the activation gesture is currently held.
   * null = never been evaluated yet.
   * @type {boolean|null}
   */
  let active = null;

  /**
   * Timestamp when the activation gesture first became continuously detected.
   * Used to implement the debounce hold.
   * @type {number|null}
   */
  let activationHeldSince = null;

  // --- Helpers ---

  /**
   * Resolve which hand's landmarks to use for a given role.
   * Activation gestures use activationHand; commands use the other hand.
   *
   * @param {'activation'|'command'} role
   * @param {object} results - Raw HandLandmarkerResult
   * @returns {Array|null} landmark array or null if the hand is not in frame
   */
  const resolveLandmarks = (role, results) => {
    if (!results || !results.landmarks || results.landmarks.length === 0) return null;

    const targetHandedness = role === 'activation'
      ? cfg.activationHand
      : (cfg.activationHand === 'left' ? 'right' : 'left');

    // MediaPipe's handedness array is parallel to landmarks[].
    // categoryName is already corrected for the mirrored webcam feed:
    // "Left" means the user's left hand.
    if (!results.handednesses || results.handednesses.length === 0) {
      // Handedness not available — fall back to first detected hand.
      return results.landmarks[0] ?? null;
    }

    for (let i = 0; i < results.handednesses.length; i++) {
      const hand = results.handednesses[i][0]; // top classification
      if (hand && hand.categoryName.toLowerCase() === targetHandedness.toLowerCase()) {
        return results.landmarks[i];
      }
    }

    return null; // requested hand not in frame
  };

  /**
   * Emit an event to all registered listeners.
   * @param {string} event
   * @param {*} data
   */
  const emit = (event, data) => {
    const fns = listeners.get(event);
    if (fns) fns.forEach(fn => fn(data));
  };

  // --- Public API ---

  /**
   * Register a gesture definition with the library.
   *
   * @param {object} gesture - A gesture definition object (see module docs).
   */
  const register = (gesture) => {
    if (!gesture || typeof gesture.name !== 'string' || typeof gesture.detect !== 'function') {
      throw new Error('gesture-library: register() requires an object with { name, detect }');
    }
    registry.set(gesture.name, gesture);
    frameStates.set(gesture.name, {});
  };

  /**
   * Subscribe to a named gesture event.
   * Built-in events: 'activate', 'deactivate'.
   * Custom events: the `name` of any registered gesture.
   *
   * @param {string} event
   * @param {Function} callback
   */
  const on = (event, callback) => {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(callback);
  };

  /**
   * Remove a previously registered listener.
   *
   * @param {string} event
   * @param {Function} callback
   */
  const off = (event, callback) => {
    const fns = listeners.get(event);
    if (!fns) return;
    const idx = fns.indexOf(callback);
    if (idx !== -1) fns.splice(idx, 1);
  };

  /**
   * Process one frame of MediaPipe HandLandmarkerResult.
   * Call this every frame inside your requestAnimationFrame loop.
   *
   * @param {object} results - HandLandmarkerResult from MediaPipe
   * @param {number} timestamp - Current timestamp (e.g. performance.now())
   */
  const process = (results, timestamp) => {
    // --- Activation gesture ---
    const activationGesture = registry.get(cfg.activationGesture);

    if (activationGesture) {
      const activationLandmarks = resolveLandmarks('activation', results);
      const mergedConfig = { ...activationGesture.config, ...(cfg.gestureConfig[activationGesture.name] ?? {}) };
      const frameState   = frameStates.get(activationGesture.name);

      const detected = activationLandmarks
        ? activationGesture.detect(activationLandmarks, frameState, mergedConfig)
        : false;

      if (detected) {
        if (activationHeldSince === null) {
          activationHeldSince = timestamp;
        }
        const heldMs = timestamp - activationHeldSince;
        if (!active && heldMs >= cfg.activationDebounceMs) {
          active = true;
          emit('activate', { heldMs });
        }
      } else {
        if (active) {
          active = false;
          emit('deactivate', {});
        }
        activationHeldSince = null;
      }
    }

    // --- Command gestures (only while active) ---
    if (!active) return;

    for (const [name, gesture] of registry) {
      if (name === cfg.activationGesture) continue; // already handled above
      if (gesture.role !== 'command') continue;

      const landmarks   = resolveLandmarks('command', results);
      if (!landmarks) continue;

      const mergedConfig = { ...gesture.config, ...(cfg.gestureConfig[name] ?? {}) };
      const frameState   = frameStates.get(name);

      const detected = gesture.detect(landmarks, frameState, mergedConfig);
      if (detected) {
        emit(name, { landmarks, frameState });
      }
    }
  };

  /**
   * Whether gesture mode is currently active.
   * @returns {boolean|null} null before the first frame is processed.
   */
  const isActiveGetter = () => active;

  return {
    register,
    on,
    off,
    process,
    get isActive()       { return isActiveGetter(); },
    get activationHand() { return cfg.activationHand; },
  };
}
