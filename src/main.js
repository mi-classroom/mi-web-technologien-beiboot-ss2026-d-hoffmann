import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { createGestureLibrary } from './gestures/index.js';
import { pinchActivate } from './gestures/pinch-activate.js';
import { flatHand }      from './gestures/flat-hand.js';
import { fist }          from './gestures/fist.js';
import { zoom }           from './gestures/zoom.js';
import './style.css';

// --- State ---
let video;
let canvasElement;
let canvasCtx;
let handLandmarker;
let lastVideoTime = -1;
let overlayMode = 'fingertips';
let sidebarMode = 'synced';
let sidebarCanvas;
let sidebarCtx;

/**
 * Smoothed landmark arrays keyed by hand index (0 = first hand, 1 = second hand).
 * Populated lazily on first frame; reset when a hand disappears and reappears.
 * @type {Map<number, Array<{x:number, y:number, z:number}>>}
 */
const smoothedLandmarksMap = new Map();

// --- Gesture library ---

// Activation finger config — change fingerA/fingerB here to remap the gesture.
// Landmark indices: 4 = thumb tip, 8 = index tip, 12 = middle tip, 16 = ring tip, 20 = pinky tip
const ACTIVATION_CONFIG = {
  fingerA:        4,    // thumb tip
  fingerB:        8,   // index fingertip
  touchThreshold: 0.4,  // ratio relative to hand size (wrist → middle MCP)
};

const gestureLib = createGestureLibrary({
  activationHand:         'left',
  activationDebounceMs:   500,
  deactivationDebounceMs: 333,
  gestureConfig: {
    'pinch-activate': ACTIVATION_CONFIG,
    'flat-hand':      { holdMs: 1000 },
    'fist':           { holdMs: 1000 },
    'zoom': {
      fingerA:        4,
      fingerB:        8,
      outerFingers:   [12, 16, 20],
      wristLandmark:  0,
      closeThreshold: 0.6,
      armHoldMs:      400,
    },
  },
});

// --- Rendering / smoothing config ---

const RENDER_CONFIG = {
  /**
   * Exponential moving average factor for landmark smoothing before rendering.
   * Range: 0–1. Higher = more responsive, less smooth. Lower = smoother, more lag.
   * The gesture library always receives raw (unsmoothed) landmarks.
   */
  smoothingAlpha: 1,

  /**
   * Number of consecutive frames a new pinch-hint state must be stable before
   * the UI hint switches. Prevents the "Hold to activate…" text from flickering
   * on noisy detection frames.
   */
  hintDebounceFrames: 4,
};

/**
 * Last confirmed pinch hint state shown in the UI.
 * Updated only after hintDebounceFrames consecutive frames agree on the new state.
 * @type {boolean}
 */
let hintState = false;

/**
 * How many consecutive frames the pending hint state has differed from hintState.
 * @type {number}
 */
let hintPendingFrames = 0;

gestureLib.register(pinchActivate);
gestureLib.register(flatHand);
gestureLib.register(fist);
gestureLib.register(zoom);

gestureLib.on('activate',   () => setGestureActiveState(true));
gestureLib.on('deactivate', () => setGestureActiveState(false));
gestureLib.on('flat-hand',  () => console.log('[gesture] flat-hand'));
gestureLib.on('fist',       () => console.log('[gesture] fist'));
gestureLib.on('zoom',       ({ value }) => console.log('[gesture] zoom', value));

// --- Constants ---
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [5, 9], [9, 10], [10, 11], [11, 12],  // Middle
  [9, 13], [13, 14], [14, 15], [15, 16],// Ring
  [13, 17], [17, 18], [18, 19], [19, 20],// Pinky
  [0, 17]                                // Palm base
];

// --- Sidebar status indicator ---

/**
 * Update the status indicator to show the current activation state.
 * Called when the library emits 'activate' or 'deactivate'.
 *
 * @param {boolean} active
 */
const setGestureActiveState = (active) => {
  const el = document.getElementById('gesture-status');
  if (!el) return;

  const iconEl  = el.querySelector('.gesture-icon');
  const labelEl = el.querySelector('.gesture-label');
  const ringEl  = el.querySelector('.gesture-ring');

  el.dataset.state        = active ? 'active' : 'inactive';
  iconEl.textContent      = active ? '▶' : '■';
  labelEl.textContent     = active ? 'Gesture Control: ON' : 'Gesture Control: OFF';
  if (ringEl) ringEl.style.setProperty('--progress', '0');
};

/** Human-readable finger names for the hint text. */
const FINGER_NAMES = { 4: 'thumb', 8: 'index', 12: 'middle', 16: 'ring', 20: 'pinky' };

/**
 * Build the activation hint string from the current config.
 * e.g. "Pinch thumb + ring (left hand) to activate"
 */
const activationHintText = () => {
  const a    = FINGER_NAMES[ACTIVATION_CONFIG.fingerA] ?? `lm${ACTIVATION_CONFIG.fingerA}`;
  const b    = FINGER_NAMES[ACTIVATION_CONFIG.fingerB] ?? `lm${ACTIVATION_CONFIG.fingerB}`;
  const hand = gestureLib.activationHand ?? 'left';
  return `Pinch ${a} + ${b} (${hand} hand) to activate`;
};

/**
 * Update the activation hint element to reflect the live pinch state.
 * Always visible regardless of whether gesture mode is confirmed active.
 *
 * @param {boolean} pinchDetected - Whether the activation pinch is currently detected
 */
const updateActivationHint = (pinchDetected) => {
  const el = document.getElementById('activation-hint');
  if (!el) return;
  if (pinchDetected) {
    el.dataset.state    = 'holding';
    el.textContent      = 'Hold to activate…';
  } else {
    el.dataset.state    = 'idle';
    el.textContent      = activationHintText();
  }
};

// --- Initialisation ---

const initializeHandTracking = async () => {
  video         = document.getElementById('webcam');
  canvasElement = document.getElementById('output_canvas');
  sidebarCanvas = document.getElementById('sidebar_hand_canvas');

  if (sidebarCanvas) {
    sidebarCtx = sidebarCanvas.getContext('2d');
  }

  const overlaySelect  = document.getElementById('overlay-mode');
  const sidebarSelect  = document.getElementById('sidebar-mode');

  if (overlaySelect) {
    overlaySelect.addEventListener('change', (e) => { overlayMode = e.target.value; });
  }

  if (sidebarSelect) {
    sidebarSelect.addEventListener('change', (e) => {
      sidebarMode = e.target.value;
      if (sidebarMode === 'none' && sidebarCtx) {
        sidebarCtx.clearRect(0, 0, sidebarCanvas.width, sidebarCanvas.height);
      }
    });
  }

  if (!canvasElement || !video) {
    console.error('DOM elements missing. Ensure index.html contains #webcam and #output_canvas.');
    return;
  }

  canvasCtx = canvasElement.getContext('2d');

  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
  });

  startWebcam();
};

const startWebcam = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    video.srcObject = stream;
    video.addEventListener('loadeddata', () => {
      document.getElementById('video-container').style.aspectRatio =
        `${video.videoWidth} / ${video.videoHeight}`;
      predictWebcam();
    });
  } catch (err) {
    console.error('Error accessing media devices.', err);
  }
};

// --- Render loop ---

const predictWebcam = () => {
  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;

    canvasElement.width  = video.videoWidth;
    canvasElement.height = video.videoHeight;

    const results = handLandmarker.detectForVideo(video, performance.now());
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (sidebarMode !== 'none' && sidebarCtx) {
      sidebarCanvas.width  = video.videoWidth;
      sidebarCanvas.height = video.videoHeight;
      sidebarCtx.clearRect(0, 0, sidebarCanvas.width, sidebarCanvas.height);
    }

    // --- Process gestures (always on raw landmarks for accurate detection) ---
    gestureLib.process(results, performance.now());

    // --- Update activation hint with frame-count debounce ---
    const rawPinch = isPinchDetectedInResults(results);
    if (rawPinch !== hintState) {
      hintPendingFrames++;
      if (hintPendingFrames >= RENDER_CONFIG.hintDebounceFrames) {
        hintState         = rawPinch;
        hintPendingFrames = 0;
      }
    } else {
      hintPendingFrames = 0;
    }
    updateActivationHint(hintState);

    // --- Smooth landmarks for rendering only ---
    const rawLandmarks = results.landmarks ?? [];

    // Evict cached smoothed data for hands that disappeared this frame.
    if (rawLandmarks.length < smoothedLandmarksMap.size) {
      for (const key of smoothedLandmarksMap.keys()) {
        if (key >= rawLandmarks.length) smoothedLandmarksMap.delete(key);
      }
    }

    const smoothed = rawLandmarks.map((raw, i) => {
      const prev = smoothedLandmarksMap.get(i);
      const alpha = RENDER_CONFIG.smoothingAlpha;
      const result = prev
        ? raw.map((p, j) => ({
            x: alpha * p.x + (1 - alpha) * prev[j].x,
            y: alpha * p.y + (1 - alpha) * prev[j].y,
            z: alpha * p.z + (1 - alpha) * prev[j].z,
          }))
        : raw.map(p => ({ ...p }));
      smoothedLandmarksMap.set(i, result);
      return result;
    });

    // --- Render all detected hands (using smoothed positions) ---
    for (const landmarks of smoothed) {
      drawHandOverlay(landmarks, canvasElement, canvasCtx);
    }

    // Sidebar: draw the first detected hand only.
    if (smoothed.length > 0 && sidebarMode !== 'none' && sidebarCtx) {
      drawSidebarHand(smoothed[0], sidebarCanvas, sidebarCtx);
    }
  }

  requestAnimationFrame(predictWebcam);
};

/**
 * Check whether the pinch-activate gesture is currently detected on the
 * left hand in raw results, without going through the library (used for
 * the persistent activation hint display).
 * Reads finger indices and threshold from ACTIVATION_CONFIG to stay in sync.
 *
 * @param {object} results - HandLandmarkerResult
 * @returns {boolean}
 */
const isPinchDetectedInResults = (results) => {
  if (!results.landmarks || results.landmarks.length === 0) return false;
  if (!results.handednesses || results.handednesses.length === 0) return false;

  for (let i = 0; i < results.handednesses.length; i++) {
    const hand = results.handednesses[i][0];
    if (hand && hand.categoryName.toLowerCase() === 'left') {
      const lm       = results.landmarks[i];
      const handSize = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y, lm[0].z - lm[9].z);
      if (handSize === 0) return false;
      const d = Math.hypot(
        lm[ACTIVATION_CONFIG.fingerA].x - lm[ACTIVATION_CONFIG.fingerB].x,
        lm[ACTIVATION_CONFIG.fingerA].y - lm[ACTIVATION_CONFIG.fingerB].y,
        lm[ACTIVATION_CONFIG.fingerA].z - lm[ACTIVATION_CONFIG.fingerB].z,
      );
      return (d / handSize) < ACTIVATION_CONFIG.touchThreshold;
    }
  }
  return false;
};

// --- Drawing helpers ---

/**
 * Draw the hand overlay on the main video canvas.
 *
 * @param {Array} landmarks
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 */
const drawHandOverlay = (landmarks, canvas, ctx) => {
  if (overlayMode === 'fingertips') {
    ctx.fillStyle = '#bb86fc';
    for (const index of [4, 8, 12, 16, 20]) {
      const point = landmarks[index];
      ctx.beginPath();
      ctx.arc(point.x * canvas.width, point.y * canvas.height, 5, 0, 2 * Math.PI);
      ctx.fill();
    }
  } else if (overlayMode === 'full') {
    ctx.lineWidth   = 4;
    ctx.strokeStyle = '#bb86fc';
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = landmarks[a], p2 = landmarks[b];
      ctx.beginPath();
      ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
      ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(point.x * canvas.width, point.y * canvas.height, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
};

/**
 * Draw the hand visualisation in the sidebar canvas.
 *
 * @param {Array} landmarks
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 */
const drawSidebarHand = (landmarks, canvas, ctx) => {
  const scaleX = canvas.width;
  const scaleY = canvas.height;

  let drawLandmarks = landmarks;

  if (sidebarMode === 'fixed' || sidebarMode === 'model') {
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const p of landmarks) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const scale   = Math.min(1 / (maxX - minX), 1 / (maxY - minY)) * 0.6;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    drawLandmarks = landmarks.map(p => ({
      x: (p.x - centerX) * scale + 0.5,
      y: (p.y - centerY) * scale + 0.5,
    }));
  }

  if (sidebarMode === 'model') {
    ctx.fillStyle = '#ffb69b';
    ctx.beginPath();
    for (const idx of [0, 1, 5, 9, 13, 17]) {
      const p = drawLandmarks[idx];
      idx === 0
        ? ctx.moveTo(p.x * scaleX, p.y * scaleY)
        : ctx.lineTo(p.x * scaleX, p.y * scaleY);
    }
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth   = 15;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = '#ffb69b';
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = drawLandmarks[a], p2 = drawLandmarks[b];
      ctx.beginPath();
      ctx.moveTo(p1.x * scaleX, p1.y * scaleY);
      ctx.lineTo(p2.x * scaleX, p2.y * scaleY);
      ctx.stroke();
    }
  } else {
    ctx.lineWidth   = 4;
    ctx.strokeStyle = '#bb86fc';
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = drawLandmarks[a], p2 = drawLandmarks[b];
      ctx.beginPath();
      ctx.moveTo(p1.x * scaleX, p1.y * scaleY);
      ctx.lineTo(p2.x * scaleX, p2.y * scaleY);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    for (const p of drawLandmarks) {
      ctx.beginPath();
      ctx.arc(p.x * scaleX, p.y * scaleY, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
};

document.addEventListener('DOMContentLoaded', initializeHandTracking);
