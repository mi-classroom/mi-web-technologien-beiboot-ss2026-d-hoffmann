import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { createGestureLibrary } from './gestures/index.js';
import { pinchActivate } from './gestures/pinch-activate.js';
import { flatHand }      from './gestures/flat-hand.js';
import { fist }          from './gestures/fist.js';
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

// --- Gesture library ---

const gestureLib = createGestureLibrary({
  activationHand:       'left',
  activationDebounceMs: 500,
  gestureConfig: {
    'flat-hand': { holdMs: 1000 },
    'fist':      { holdMs: 1000 },
  },
});

gestureLib.register(pinchActivate);
gestureLib.register(flatHand);
gestureLib.register(fist);

gestureLib.on('activate',   () => setGestureActiveState(true));
gestureLib.on('deactivate', () => setGestureActiveState(false));
gestureLib.on('flat-hand',  () => console.log('[gesture] flat-hand'));
gestureLib.on('fist',       () => console.log('[gesture] fist'));

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

/**
 * Update the status indicator to reflect the live activation state
 * (pinch gesture held but not yet debounced, or no gesture).
 * Called every frame when no confirmed state change has occurred.
 *
 * @param {boolean} pinchDetected - Whether the activation pinch is currently detected
 */
const updateActivationStatus = (pinchDetected) => {
  // Only update the idle/holding display when not yet in a confirmed state.
  if (gestureLib.isActive !== null) return;

  const el = document.getElementById('gesture-status');
  if (!el) return;

  const iconEl  = el.querySelector('.gesture-icon');
  const labelEl = el.querySelector('.gesture-label');

  if (pinchDetected) {
    el.dataset.state    = 'holding-start';
    iconEl.textContent  = '◎';
    labelEl.textContent = 'Hold to activate…';
  } else {
    el.dataset.state    = 'idle';
    iconEl.textContent  = '◎';
    labelEl.textContent = 'Pinch index + pinky (left) to activate';
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
  canvasElement.width  = video.videoWidth;
  canvasElement.height = video.videoHeight;

  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;

    const results = handLandmarker.detectForVideo(video, performance.now());
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (sidebarMode !== 'none' && sidebarCtx) {
      sidebarCanvas.width  = video.videoWidth;
      sidebarCanvas.height = video.videoHeight;
      sidebarCtx.clearRect(0, 0, sidebarCanvas.width, sidebarCanvas.height);
    }

    // --- Process gestures ---
    gestureLib.process(results, performance.now());

    // Update idle/holding status display when not in a confirmed active/inactive state.
    if (gestureLib.isActive === null) {
      const pinchDetected = isPinchDetectedInResults(results);
      updateActivationStatus(pinchDetected);
    }

    // --- Render all detected hands ---
    if (results.landmarks && results.landmarks.length > 0) {
      for (const landmarks of results.landmarks) {
        drawHandOverlay(landmarks, canvasElement, canvasCtx);
      }

      // Sidebar: draw the first detected hand only.
      if (sidebarMode !== 'none' && sidebarCtx) {
        drawSidebarHand(results.landmarks[0], sidebarCanvas, sidebarCtx);
      }
    }
  }

  requestAnimationFrame(predictWebcam);
};

/**
 * Check whether the pinch-activate gesture is currently detected on the
 * left hand in raw results, without going through the library (used for
 * the pre-activation idle status display).
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
      const lm = results.landmarks[i];
      const d  = Math.hypot(lm[8].x - lm[20].x, lm[8].y - lm[20].y);
      return d < 0.07; // matches pinchActivate default touchThreshold
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
