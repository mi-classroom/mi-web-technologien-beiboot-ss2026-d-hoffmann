/**
 * @module demo
 *
 * Standalone demo app for Issue #4: "build something with your library as if
 * you'd never seen the source code."
 *
 * This app treats `src/gestures` purely as an external dependency — it only
 * calls the public API documented in `src/gestures/index.js`
 * (`register`, `on`, `process`, `isActive`, `activationHand`) and reuses the
 * shipped gesture definitions unmodified. No internal registry/frameState
 * access, no reaching into gesture files' private helpers.
 *
 * Features:
 * - Activate gesture control with the standard pinch-activate gesture.
 * - Command hand: `flat-hand` starts the video, `fist` stops it.
 * - Command hand: `zoom` scales the video via CSS transform.
 * - Live hand-skeleton overlay drawn on a canvas from the raw MediaPipi
 *   results (rendering is independent of the gesture library — the library
 *   only ever sees the same raw results via `process()`).
 * - Bonus (near-zero extra code, no new gestures): live zoom-% readout,
 *   auto-reset zoom on deactivate, keyboard fallback for testing without a
 *   camera, and a simple activation status pill driven by the library's
 *   `'frame'` event (see ADR-004 — this is the same event added to close the
 *   gap this demo surfaced).
 * - Validation-only: the new `pan` gesture (ADR-005) paints a trail on an
 *   overlay canvas while pinch-armed, as a quick way to sanity-check its
 *   direct 1:1 pinch-point tracking feel before building the real gallery
 *   consumer. Not part of the demo's actual feature set.
 */

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { createGestureLibrary } from '../src/gestures/index.js';
import { pinchActivate }        from '../src/gestures/pinch-activate.js';
import { flatHand }             from '../src/gestures/flat-hand.js';
import { fist }                 from '../src/gestures/fist.js';
import { zoom }                 from '../src/gestures/zoom.js';
import { pan }                  from '../src/gestures/pan.js';
import './demo.css';

/** Pairs of landmark indices connected by a bone, for skeleton rendering. */
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],        // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],        // Index
  [5, 9], [9, 10], [10, 11], [11, 12],   // Middle
  [9, 13], [13, 14], [14, 15], [15, 16], // Ring
  [13, 17], [17, 18], [18, 19], [19, 20],// Pinky
  [0, 17],                                // Palm base
];

// --- Zoom state ---
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_SENSITIVITY = 6; // multiplies the raw per-frame pinch-distance delta
const ZOOM_STEP = 0.1;      // keyboard fallback increment

let zoomScale = 1;
let video;

// --- Pan validation state (paint on screen while `pan` is armed) ---
//
// This is a throwaway validation harness for the new `pan` gesture (ADR-005),
// not part of the demo's actual feature set: painting a continuous trail
// while pinch-armed gives immediate visual feedback on whether pan's direct
// 1:1 pinch-point tracking (see pan.js) feels smooth/accurate, without
// needing the full gallery app built yet.
let lastPaintPos = null; // null = "pen up", draw a dot instead of a line on the next point
let paintCanvasEl;
let paintCtx;

// --- DOM refs (populated on DOMContentLoaded) ---
let statusEl;
let statusLabelEl;
let pausedBadgeEl;
let zoomBadgeEl;
let canvasEl;
let canvasCtx;

// --- Gesture library setup (public API only) ---
//
// Config values below mirror the tuned defaults from src/main.js rather than
// the gesture library's raw built-in defaults (thumb+ring pinch at 0.3,
// zoom armed almost unconditionally at closeThreshold: 1). Those raw
// defaults are deliberately loose starting points (see ADR-003/gesture
// docstrings) and are uncomfortable/unreliable to actually perform — the
// main app overrides them, and this demo needs the same overrides to work.

const gestureLib = createGestureLibrary({
  activationHand: 'left',
  gestureConfig: {
    'pinch-activate': {
      fingerA:        4,   // thumb tip
      fingerB:        8,   // index fingertip — easier to hold than the default (ring)
      touchThreshold: 0.4,
    },
    'zoom': {
      fingerA:        4,
      fingerB:        8,
      outerFingers:   [12, 16, 20],
      wristLandmark:  0,
      closeThreshold: 0.6, // default (1) is satisfied almost regardless of pose
      armHoldMs:      400,
    },
    'pan': {
      fingerA:         4,
      fingerB:         8,
      touchThreshold:  0.4,
      armHoldMs:       175,
      smoothingFrames: 5,
      deadzone:        0.05,
    },
  },
});

gestureLib.register(pinchActivate);
gestureLib.register(flatHand);
gestureLib.register(fist);
gestureLib.register(zoom);
gestureLib.register(pan);

gestureLib.on('activate',   () => setStatus('active', 'Gesture control ON'));
gestureLib.on('deactivate', () => {
  setStatus('idle', 'Pinch thumb + index (left hand) to activate');
  resetZoom(); // safety default: don't leave the video zoomed after leaving gesture mode
  lastPaintPos = null; // pen up: don't connect the next stroke to wherever painting last stopped
});

gestureLib.on('flat-hand', () => startVideo());
gestureLib.on('fist',      () => stopVideo());
gestureLib.on('zoom',      ({ value }) => applyZoomDelta(value * ZOOM_SENSITIVITY));
gestureLib.on('pan',       ({ value }) => paintTo(value));

// Live "hold to activate…" hint, sourced from the library's 'frame' event
// instead of re-implementing pinch detection here (see ADR-004).
gestureLib.on('frame', ({ active, activationDetected }) => {
  if (active) return; // 'activate' handler already owns the label while active
  setStatus(
    activationDetected ? 'holding' : 'idle',
    activationDetected ? 'Hold to activate…' : 'Pinch thumb + index (left hand) to activate',
  );
});

// --- Video start/stop ---

const startVideo = () => {
  video.play();
  pausedBadgeEl.dataset.visible = 'false';
};

const stopVideo = () => {
  video.pause();
  pausedBadgeEl.dataset.visible = 'true';
};

// --- Zoom ---

const applyZoomDelta = (delta) => {
  zoomScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomScale + delta));
  renderZoom();
};

const resetZoom = () => {
  zoomScale = 1;
  renderZoom();
};

const renderZoom = () => {
  const transform = `scaleX(-1) scale(${zoomScale})`;
  video.style.transform = transform;
  canvasEl.style.transform = transform; // keep skeleton overlay aligned with the zoomed video
  zoomBadgeEl.textContent = `${Math.round(zoomScale * 100)}%`;
};

// --- Pan validation: paint a trail while `pan` is armed ---
//
// `value` carries pan.js's raw {dx, dy} movement since the pinch started,
// plus the {originX, originY} pinch-point position at the moment of
// arming (all in the same normalised video-frame coordinate space as
// MediaPipe landmarks). The tracked point is reconstructed directly as
// origin + delta and mapped onto the canvas with a plain multiply — no
// accumulation, no sensitivity constant, so the paint cursor starts exactly
// where the fingertips touch and moves at the same speed the hand moves in
// the video. This is purely a quick visual sanity check for the gesture's
// feel, not a real drawing tool.
const clamp01 = (v) => Math.min(1, Math.max(0, v));

const paintTo = ({ dx, dy, originX, originY }) => {
  if (!paintCtx) return;

  // pan.js emits exactly {dx:0, dy:0} on the first frame after (re-)arming
  // (origin just captured, no movement yet). Treat that as "pen up → down"
  // so a new stroke never draws a spurious line back to wherever the
  // previous stroke ended.
  if (dx === 0 && dy === 0) lastPaintPos = null;

  const cursor = {
    x: clamp01(originX + dx),
    y: clamp01(originY + dy),
  };

  const point = {
    x: cursor.x * paintCanvasEl.width,
    y: cursor.y * paintCanvasEl.height,
  };

  paintCtx.strokeStyle = '#03dac6';
  paintCtx.fillStyle   = '#03dac6';
  paintCtx.lineWidth   = 3;
  paintCtx.lineCap     = 'round';

  if (lastPaintPos) {
    paintCtx.beginPath();
    paintCtx.moveTo(lastPaintPos.x, lastPaintPos.y);
    paintCtx.lineTo(point.x, point.y);
    paintCtx.stroke();
  } else {
    // First point of a new stroke (just armed): draw a dot so a single
    // tap-and-release is still visible.
    paintCtx.beginPath();
    paintCtx.arc(point.x, point.y, 2, 0, 2 * Math.PI);
    paintCtx.fill();
  }

  lastPaintPos = point;
};

// --- Status pill ---

const setStatus = (state, label) => {
  statusEl.dataset.state = state;
  statusLabelEl.textContent = label;
};

// --- Keyboard fallback (accessibility + camera-less testing) ---

const onKeydown = (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    video.paused ? startVideo() : stopVideo();
  } else if (e.key === '+' || e.key === '=') {
    applyZoomDelta(ZOOM_STEP);
  } else if (e.key === '-' || e.key === '_') {
    applyZoomDelta(-ZOOM_STEP);
  }
};

// --- MediaPipe bootstrap ---

let handLandmarker;
let lastVideoTime = -1;

const init = async () => {
  video          = document.getElementById('demo-webcam');
  statusEl       = document.getElementById('demo-status');
  statusLabelEl  = document.getElementById('demo-status-label');
  pausedBadgeEl  = document.getElementById('demo-paused-badge');
  zoomBadgeEl    = document.getElementById('demo-zoom-badge');
  canvasEl       = document.getElementById('demo-output-canvas');
  canvasCtx      = canvasEl.getContext('2d');
  paintCanvasEl  = document.getElementById('demo-paint-canvas');
  paintCtx       = paintCanvasEl.getContext('2d');

  document.addEventListener('keydown', onKeydown);
  renderZoom();

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

  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = stream;
  video.addEventListener('loadeddata', predictWebcam);
};

const predictWebcam = () => {
  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;

    canvasEl.width  = video.videoWidth;
    canvasEl.height = video.videoHeight;

    if (paintCanvasEl.width !== video.videoWidth || paintCanvasEl.height !== video.videoHeight) {
      // Only resize (and thereby clear) the paint canvas once, on first
      // frame / actual resolution change — unlike the skeleton canvas it
      // must persist strokes across frames, not clear every frame.
      paintCanvasEl.width  = video.videoWidth;
      paintCanvasEl.height = video.videoHeight;
    }

    const results = handLandmarker.detectForVideo(video, performance.now());
    gestureLib.process(results, performance.now());

    canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    for (const landmarks of results.landmarks ?? []) {
      drawHandSkeleton(landmarks, canvasEl, canvasCtx);
    }
  }
  requestAnimationFrame(predictWebcam);
};

/**
 * Draw a single hand's skeleton (bones + joints) onto the overlay canvas.
 * Purely a rendering concern — landmarks are the same raw MediaPipe data
 * passed to `gestureLib.process()`, read here independently of the library.
 *
 * @param {Array<{x:number,y:number}>} landmarks
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 */
const drawHandSkeleton = (landmarks, canvas, ctx) => {
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
};

document.addEventListener('DOMContentLoaded', init);
