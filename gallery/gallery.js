/**
 * @module gallery
 *
 * Weg A vision application (ADR-005): a gesture-controlled image/video
 * gallery viewer. This file implements the frontend shell — camera
 * permission gate, file source selection, grid view, and detail view,
 * driven by mouse clicks and a keyboard fallback — plus the live hand
 * tracking foundation: a persistent MediaPipe HandLandmarker pipeline, a
 * subtle full-viewport hand-skeleton overlay, and a sidebar reporting
 * gesture-control status. Only the `pinch-activate` gesture is wired so
 * far; `pan`/`fist`/`flat-hand`/`zoom` command gestures (and their
 * corresponding sidebar control explanations) are added in a later pass.
 *
 * ## Flow
 *
 * 1. **Welcome / camera permission gate**: the app requires webcam access
 *    for gesture tracking, so before anything else it asks the user to
 *    explicitly grant camera permission via a button (rather than calling
 *    `getUserMedia` immediately on load, which would show the browser's
 *    native permission prompt with no context and could be dismissed/denied
 *    without the user understanding why it's asking). Once granted, the
 *    obtained stream is reused directly to start the hand-tracking pipeline
 *    (see `startHandTracking()`) — no need to acquire it twice.
 * 2. **Demo mode**: a small bundled set of sample images shipped in
 *    `gallery/samples/` (see list below), imported directly as ES modules.
 *    No upload needed, good for quick testing/demoing without needing real
 *    files on hand.
 * 3. **Custom mode**: the user supplies their own images and videos via a
 *    file input / drag-and-drop. Files are read entirely client-side via
 *    `URL.createObjectURL` — nothing is uploaded to a server (there is no
 *    backend), and object URLs are revoked when a new set of files replaces
 *    the current one, to avoid leaking memory across selections.
 */

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { createGestureLibrary } from '../src/gestures/index.js';
import { pinchActivate }        from '../src/gestures/pinch-activate.js';
import './gallery.css';
import sample01 from './samples/sample-01.svg';
import sample02 from './samples/sample-02.svg';
import sample03 from './samples/sample-03.svg';
import sample04 from './samples/sample-04.svg';
import sample05 from './samples/sample-05.svg';
import sample06 from './samples/sample-06.svg';

/**
 * Bundled demo images, imported directly as modules from `gallery/samples/`
 * so Vite resolves/hashes/copies them like any other asset — no dependency
 * on the root-level `public/` directory or absolute paths.
 */
const DEMO_IMAGES = [
  { name: 'Mountain Lake', src: sample01 },
  { name: 'City at Night', src: sample02 },
  { name: 'Autumn Path', src: sample03 },
  { name: 'Desert Dune', src: sample04 },
  { name: 'Forest Trail', src: sample05 },
  { name: 'Ocean Sunset', src: sample06 },
];

/**
 * Gallery items currently loaded, regardless of source.
 * @type {Array<{ name: string, src: string, type: 'image'|'video', objectUrl: boolean }>}
 */
let items = [];

/** Object URLs created for the current custom-upload set, tracked so they can be revoked on replacement. */
let activeObjectUrls = [];

/** Index of the currently selected/highlighted grid cell (also the item shown in detail view). */
let selectedIndex = 0;

// --- DOM refs (populated on DOMContentLoaded) ---
let viewWelcomeEl;
let welcomeStatusEl;
let welcomeStatusTextEl;
let btnGrantCameraEl;
let viewSelectEl;
let viewGridEl;
let viewDetailEl;
let gridContainerEl;
let gridEmptyHintEl;
let customUploadEl;
let uploadDropzoneEl;
let fileInputEl;
let customUploadHintEl;
let detailTitleEl;
let detailImageEl;
let detailVideoEl;
let detailPositionEl;
let sidebarEl;
let sidebarStatusEl;
let sidebarHintEl;
let sidebarHandsDetectedEl;
let webcamVideoEl;
let handOverlayCanvasEl;
let handOverlayCtx;

// --- Hand tracking / gesture library setup ---

/**
 * Activation finger config: thumb tip (4) + index fingertip (8), left hand.
 * Mirrors the tuned defaults used in `src/main.js` and `demo/demo.js` rather
 * than the gesture library's looser built-in defaults (see those files'
 * comments for why: thumb+ring at 0.3 is uncomfortable to hold reliably).
 */
const ACTIVATION_CONFIG = {
  fingerA:        4,
  fingerB:        8,
  touchThreshold: 0.4,
};

const gestureLib = createGestureLibrary({
  activationHand:         'left',
  activationDebounceMs:   500,
  deactivationDebounceMs: 333,
  gestureConfig: {
    'pinch-activate': ACTIVATION_CONFIG,
  },
});

gestureLib.register(pinchActivate);

/** Human-readable finger names for the sidebar hint text. */
const FINGER_NAMES = { 4: 'thumb', 8: 'index', 12: 'middle', 16: 'ring', 20: 'pinky' };

const activationHintText = () => {
  const a    = FINGER_NAMES[ACTIVATION_CONFIG.fingerA] ?? `lm${ACTIVATION_CONFIG.fingerA}`;
  const b    = FINGER_NAMES[ACTIVATION_CONFIG.fingerB] ?? `lm${ACTIVATION_CONFIG.fingerB}`;
  const hand = gestureLib.activationHand ?? 'left';
  return `Pinch ${a} + ${b} (${hand} hand) to activate`;
};

const setSidebarStatus = (active) => {
  sidebarStatusEl.dataset.state = active ? 'active' : 'inactive';
  sidebarStatusEl.querySelector('.sidebar-status-icon').textContent  = active ? '▶' : '■';
  sidebarStatusEl.querySelector('.sidebar-status-label').textContent =
    active ? 'Gesture Control: ON' : 'Gesture Control: OFF';
};

gestureLib.on('activate',   () => setSidebarStatus(true));
gestureLib.on('deactivate', () => setSidebarStatus(false));

gestureLib.on('frame', ({ active, activationDetected }) => {
  if (active) return; // 'activate' handler already owns the label while active
  sidebarStatusEl.dataset.state = activationDetected ? 'holding' : 'inactive';
  sidebarHintEl.textContent     = activationDetected ? 'Hold to activate…' : activationHintText();
});

/** Pairs of landmark indices connected by a bone, for skeleton rendering. */
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],        // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],        // Index
  [5, 9], [9, 10], [10, 11], [11, 12],   // Middle
  [9, 13], [13, 14], [14, 15], [15, 16], // Ring
  [13, 17], [17, 18], [18, 19], [19, 20],// Pinky
  [0, 17],                                // Palm base
];

let handLandmarker;
let lastVideoTime = -1;
let handTrackingStarted = false;
/** Guards against the render loop being started twice (via 'loadeddata' and the direct readyState check). */
let renderLoopStarted = false;

// --- View switching ---

/** @type {'welcome'|'select'|'grid'|'detail'} */
let currentView = 'welcome';

const setView = (view) => {
  currentView = view;
  viewWelcomeEl.dataset.active = String(view === 'welcome');
  viewSelectEl.dataset.active  = String(view === 'select');
  viewGridEl.dataset.active    = String(view === 'grid');
  viewDetailEl.dataset.active  = String(view === 'detail');
  // Sidebar has nothing meaningful to report before permission is granted.
  sidebarEl.dataset.visible = String(view !== 'welcome');
};

// --- Camera permission gate ---

/**
 * Whether camera permission has already been confirmed granted this session.
 * Read by later gesture-tracking wiring to skip re-requesting the gate.
 * @type {boolean}
 */
let cameraPermissionGranted = false;

/** How long (ms) the "Camera access granted" status is shown before auto-advancing to mode-select. */
const CAMERA_GRANTED_ADVANCE_DELAY_MS = 1200;

const setWelcomeStatus = (state, text) => {
  welcomeStatusEl.dataset.state = state;
  welcomeStatusTextEl.textContent = text;
};

/**
 * Ask the browser for camera permission, then reuse the granted stream
 * directly to start the hand-tracking pipeline (see `startHandTracking()`).
 * Loading MediaPipe's WASM runtime and model happens in the background
 * during the confirmation delay below, so tracking is typically already
 * warmed up by the time the user reaches the mode-select screen.
 */
const requestCameraPermission = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    setWelcomeStatus('unsupported', 'This browser does not support camera access (getUserMedia unavailable).');
    return;
  }

  setWelcomeStatus('requesting', 'Requesting camera access…');
  btnGrantCameraEl.disabled = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    cameraPermissionGranted = true;
    setWelcomeStatus('granted', 'Camera access granted.');
    startHandTracking(stream).catch((err) => {
      // Not caught inside startHandTracking itself so the fire-and-forget
      // call site stays simple — but this must not be silently swallowed:
      // an unhandled rejection here (e.g. GPU delegate unsupported on this
      // machine) would otherwise leave hand tracking permanently broken
      // with zero visible symptom.
      console.error('[gallery] failed to start hand tracking:', err);
      sidebarHintEl.textContent =
        'Hand tracking failed to start (see browser console for details). Try reloading the page.';
    });
    // Brief confirmation pause so the "granted" status is actually visible,
    // rather than flashing past it into the select screen instantly.
    setTimeout(() => {
      if (currentView === 'welcome') setView('select');
    }, CAMERA_GRANTED_ADVANCE_DELAY_MS);
  } catch (err) {
    setWelcomeStatus(
      'denied',
      'Camera access was denied. This app needs it for gesture tracking — please allow camera access and try again.'
    );
  } finally {
    btnGrantCameraEl.disabled = false;
  }
};

// --- Hand tracking pipeline ---

/**
 * Initialise MediaPipe's HandLandmarker and start the persistent
 * detect-and-render loop. Runs once per app session, independent of
 * whichever gallery view is currently active — the hand overlay and
 * gesture library both need continuous tracking regardless of view.
 *
 * @param {MediaStream} stream - Already-granted camera stream to attach to the hidden webcam video element.
 */
const startHandTracking = async (stream) => {
  if (handTrackingStarted) return;
  handTrackingStarted = true;

  webcamVideoEl.srcObject = stream;

  resizeHandOverlay();
  window.addEventListener('resize', resizeHandOverlay);

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

  webcamVideoEl.addEventListener('loadeddata', startRenderLoop);

  // The video very likely already fired 'loadeddata' while the two awaits
  // above were still resolving (WASM fileset + model download take seconds,
  // the local camera stream is ready almost instantly). A listener attached
  // now would therefore never fire, and the render loop would never start —
  // so kick it off directly if the video already has frame data.
  // HAVE_CURRENT_DATA (2) or better means detectForVideo() has something to read.
  if (webcamVideoEl.readyState >= 2) startRenderLoop();
};

/** Start the detect-and-render loop exactly once, whichever trigger gets there first. */
const startRenderLoop = () => {
  if (renderLoopStarted) return;
  renderLoopStarted = true;
  predictWebcam();
};

const resizeHandOverlay = () => {
  handOverlayCanvasEl.width  = window.innerWidth;
  handOverlayCanvasEl.height = window.innerHeight;
};

const predictWebcam = () => {
  // Wrapped defensively: if detectForVideo/gestureLib.process ever throws on
  // some frame (e.g. an edge-case landmark configuration), the render loop
  // must keep going — an uncaught exception here would otherwise permanently
  // kill hand tracking for the rest of the session, since the
  // requestAnimationFrame() call below would never be reached again.
  try {
    if (lastVideoTime !== webcamVideoEl.currentTime) {
      lastVideoTime = webcamVideoEl.currentTime;

      const results = handLandmarker.detectForVideo(webcamVideoEl, performance.now());
      gestureLib.process(results, performance.now());

      handOverlayCtx.clearRect(0, 0, handOverlayCanvasEl.width, handOverlayCanvasEl.height);
      for (const landmarks of results.landmarks ?? []) {
        drawHandSkeleton(landmarks, handOverlayCanvasEl, handOverlayCtx);
      }

      const handCount = results.landmarks?.length ?? 0;
      sidebarHandsDetectedEl.textContent = `Hands detected: ${handCount}`;
      sidebarHandsDetectedEl.dataset.count = String(handCount);
    }
  } catch (err) {
    console.error('[gallery] hand-tracking frame error (loop continues):', err);
  }

  requestAnimationFrame(predictWebcam);
};

/**
 * Draw a single hand's skeleton onto the full-viewport overlay canvas.
 * Deliberately subtle (thin lines, low opacity, small joints) — this is
 * ambient tracking feedback, not a primary UI element, so it should never
 * fight for attention with the gallery content underneath.
 *
 * Landmarks are mapped directly to viewport coordinates rather than to the
 * source video's own aspect ratio: the webcam feed is never shown to the
 * user (see `startHandTracking`), so there's no underlying image for the
 * skeleton to align with pixel-for-pixel — it only needs to convey
 * approximate hand position/pose across the whole screen.
 *
 * @param {Array<{x:number,y:number}>} landmarks
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 */
const drawHandSkeleton = (landmarks, canvas, ctx) => {
  ctx.lineWidth   = 2;
  ctx.strokeStyle = 'rgba(187, 134, 252, 0.35)';
  for (const [a, b] of HAND_CONNECTIONS) {
    const p1 = landmarks[a], p2 = landmarks[b];
    ctx.beginPath();
    ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
    ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  for (const point of landmarks) {
    ctx.beginPath();
    ctx.arc(point.x * canvas.width, point.y * canvas.height, 2.5, 0, 2 * Math.PI);
    ctx.fill();
  }
};

// --- Source selection ---

const revokeActiveObjectUrls = () => {
  for (const url of activeObjectUrls) URL.revokeObjectURL(url);
  activeObjectUrls = [];
};

const loadDemoImages = () => {
  revokeActiveObjectUrls();
  items = DEMO_IMAGES.map((img) => ({ ...img, type: 'image', objectUrl: false }));
  selectedIndex = 0;
  renderGrid();
  setView('grid');
};

const loadCustomFiles = (fileList) => {
  const files = Array.from(fileList).filter(
    (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
  );
  if (files.length === 0) {
    customUploadHintEl.textContent = 'No supported image/video files found in that selection.';
    return;
  }

  revokeActiveObjectUrls();
  items = files.map((file) => {
    const url = URL.createObjectURL(file);
    activeObjectUrls.push(url);
    return {
      name: file.name,
      src: url,
      type: file.type.startsWith('video/') ? 'video' : 'image',
      objectUrl: true,
    };
  });
  selectedIndex = 0;
  customUploadHintEl.textContent = '';
  renderGrid();
  setView('grid');
};

// --- Grid view ---

const renderGrid = () => {
  gridContainerEl.innerHTML = '';
  gridEmptyHintEl.dataset.visible = String(items.length === 0);

  items.forEach((item, index) => {
    const cell = document.createElement('div');
    cell.className = 'grid-item';
    cell.dataset.selected = String(index === selectedIndex);
    cell.addEventListener('click', () => {
      selectedIndex = index;
      openDetail(index);
    });

    if (item.type === 'video') {
      const video = document.createElement('video');
      video.src = item.src;
      video.muted = true;
      video.playsInline = true;
      cell.appendChild(video);

      const badge = document.createElement('span');
      badge.className = 'grid-item-badge';
      badge.textContent = 'Video';
      cell.appendChild(badge);
    } else {
      const img = document.createElement('img');
      img.src = item.src;
      img.alt = item.name;
      cell.appendChild(img);
    }

    gridContainerEl.appendChild(cell);
  });
};

/**
 * Update which grid cell is marked selected, without re-rendering the whole grid.
 * @param {number} index
 */
const setSelectedIndex = (index) => {
  if (items.length === 0) return;
  const clamped = Math.max(0, Math.min(items.length - 1, index));
  if (clamped === selectedIndex) return;

  const prevCell = gridContainerEl.children[selectedIndex];
  if (prevCell) prevCell.dataset.selected = 'false';

  selectedIndex = clamped;

  const nextCell = gridContainerEl.children[selectedIndex];
  if (nextCell) nextCell.dataset.selected = 'true';
};

// --- Detail view ---

const openDetail = (index) => {
  if (items.length === 0) return;
  selectedIndex = index;
  renderDetail();
  setView('detail');
};

const closeDetail = () => {
  detailVideoEl.pause();
  setView('grid');
};

const renderDetail = () => {
  const item = items[selectedIndex];
  if (!item) return;

  detailTitleEl.textContent = item.name;
  detailPositionEl.textContent = `${selectedIndex + 1} / ${items.length}`;

  if (item.type === 'video') {
    detailImageEl.hidden = true;
    detailImageEl.removeAttribute('src');
    detailVideoEl.hidden = false;
    detailVideoEl.src = item.src;
  } else {
    detailVideoEl.pause();
    detailVideoEl.hidden = true;
    detailVideoEl.removeAttribute('src');
    detailImageEl.hidden = false;
    detailImageEl.src = item.src;
    detailImageEl.alt = item.name;
  }
};

const showNext = () => {
  if (items.length === 0) return;
  selectedIndex = (selectedIndex + 1) % items.length;
  renderDetail();
};

const showPrev = () => {
  if (items.length === 0) return;
  selectedIndex = (selectedIndex - 1 + items.length) % items.length;
  renderDetail();
};

// --- Keyboard fallback (accessibility + testing without gestures/camera) ---

const onKeydown = (e) => {
  if (currentView === 'detail') {
    if (e.key === 'Escape') closeDetail();
    else if (e.key === 'ArrowRight') showNext();
    else if (e.key === 'ArrowLeft') showPrev();
  } else if (currentView === 'grid') {
    if (e.key === 'Enter') openDetail(selectedIndex);
    else if (e.key === 'ArrowRight') setSelectedIndex(selectedIndex + 1);
    else if (e.key === 'ArrowLeft') setSelectedIndex(selectedIndex - 1);
  }
};

// --- Drag & drop ---

const onDragOver = (e) => {
  e.preventDefault();
  uploadDropzoneEl.dataset.dragover = 'true';
};

const onDragLeave = () => {
  uploadDropzoneEl.dataset.dragover = 'false';
};

const onDrop = (e) => {
  e.preventDefault();
  uploadDropzoneEl.dataset.dragover = 'false';
  if (e.dataTransfer?.files?.length) loadCustomFiles(e.dataTransfer.files);
};

// --- Init ---

const init = () => {
  viewWelcomeEl       = document.getElementById('gallery-view-welcome');
  welcomeStatusEl     = document.getElementById('welcome-status');
  welcomeStatusTextEl = document.getElementById('welcome-status-text');
  btnGrantCameraEl    = document.getElementById('btn-grant-camera');
  viewSelectEl        = document.getElementById('gallery-view-select');
  viewGridEl         = document.getElementById('gallery-view-grid');
  viewDetailEl       = document.getElementById('gallery-view-detail');
  gridContainerEl    = document.getElementById('grid-container');
  gridEmptyHintEl    = document.getElementById('grid-empty-hint');
  customUploadEl     = document.getElementById('custom-upload');
  uploadDropzoneEl   = document.getElementById('upload-dropzone');
  fileInputEl        = document.getElementById('file-input');
  customUploadHintEl = document.getElementById('custom-upload-hint');
  detailTitleEl      = document.getElementById('detail-title');
  detailImageEl      = document.getElementById('detail-image');
  detailVideoEl      = document.getElementById('detail-video');
  detailPositionEl   = document.getElementById('detail-position');
  sidebarEl          = document.getElementById('gallery-sidebar');
  sidebarStatusEl    = document.getElementById('sidebar-status');
  sidebarHintEl      = document.getElementById('sidebar-hint');
  sidebarHandsDetectedEl = document.getElementById('sidebar-hands-detected');
  webcamVideoEl      = document.getElementById('gallery-webcam');
  handOverlayCanvasEl = document.getElementById('gallery-hand-overlay');
  handOverlayCtx      = handOverlayCanvasEl.getContext('2d');

  sidebarHintEl.textContent = activationHintText();

  btnGrantCameraEl.addEventListener('click', requestCameraPermission);

  document.getElementById('btn-use-demo').addEventListener('click', loadDemoImages);

  document.getElementById('btn-use-custom').addEventListener('click', () => {
    customUploadEl.dataset.visible = 'true';
  });

  fileInputEl.addEventListener('change', (e) => {
    if (e.target.files?.length) loadCustomFiles(e.target.files);
  });

  uploadDropzoneEl.addEventListener('dragover', onDragOver);
  uploadDropzoneEl.addEventListener('dragleave', onDragLeave);
  uploadDropzoneEl.addEventListener('drop', onDrop);

  document.getElementById('btn-back-to-select').addEventListener('click', () => {
    revokeActiveObjectUrls();
    items = [];
    selectedIndex = 0;
    customUploadEl.dataset.visible = 'false';
    fileInputEl.value = '';
    setView('select');
  });

  document.getElementById('btn-back-to-grid').addEventListener('click', closeDetail);

  document.addEventListener('keydown', onKeydown);
};

document.addEventListener('DOMContentLoaded', init);
