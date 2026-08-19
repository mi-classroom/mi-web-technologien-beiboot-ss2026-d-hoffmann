/**
 * @module gallery
 *
 * Weg A vision application (ADR-005): a gesture-controlled image/video
 * gallery viewer, driven by a virtual-mouse metaphor: a gesture-controlled
 * on-screen cursor plus a click gesture operate the same buttons and
 * thumbnails a mouse user would, rather than each app state needing
 * bespoke gesture wiring. This file implements the frontend shell — camera
 * permission gate, file source selection, grid view, and detail view — plus
 * the full gesture control layer: `pinch-activate` (enter/exit gesture
 * mode), `cursor` + `click` (virtual mouse), `flat-hand`/`fist` (video
 * play/pause shortcuts), and `zoom` (detail-view image zoom).
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
 * 2. **Demo mode**: a small bundled set of sample images and one sample
 *    video shipped in `gallery/samples/` (see list below), imported
 *    directly as ES modules. No upload needed, good for quick
 *    testing/demoing without needing real files on hand.
 * 3. **Custom mode**: the user supplies their own images and videos via a
 *    file input / drag-and-drop. Files are read entirely client-side via
 *    `URL.createObjectURL` — nothing is uploaded to a server (there is no
 *    backend), and object URLs are revoked when a new set of files replaces
 *    the current one, to avoid leaking memory across selections.
 */

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { createGestureLibrary } from '../src/gestures/index.js';
import { pinchActivate }        from '../src/gestures/pinch-activate.js';
import { cursor as cursorGesture } from '../src/gestures/cursor.js';
import { click as clickGesture }   from '../src/gestures/click.js';
import { flatHand }             from '../src/gestures/flat-hand.js';
import { fist }                 from '../src/gestures/fist.js';
import { zoom }                 from '../src/gestures/zoom.js';
import { swipe }                from '../src/gestures/swipe.js';
import { remapEdgeMargin }      from '../src/gestures/utils.js';
import './gallery.css';
import sample01 from './samples/NebulaDrift.jpg';
import sample02 from './samples/FracturedGlass.jpg';
import sample03 from './samples/LiquidCircuit.jpg';
import sample04 from './samples/PlasmaBloom.jpg';
import sample05 from './samples/WovenLight.jpg';
import sample06 from './samples/CrystalDepth.jpg';
import sample07 from './samples/Video.mp4';

/**
 * Bundled demo images, imported directly as modules from `gallery/samples/`
 * so Vite resolves/hashes/copies them like any other asset — no dependency
 * on the root-level `public/` directory or absolute paths.
 */
const DEMO_IMAGES = [
  { name: 'Nebula Drift', src: sample01, type: 'image' },
  { name: 'Fractured Glass', src: sample02, type: 'image' },
  { name: 'Liquid Circuit', src: sample03, type: 'image' },
  { name: 'Plasma Bloom', src: sample04, type: 'image' },
  { name: 'Woven Light', src: sample05, type: 'image' },
  { name: 'Crystal Depth', src: sample06, type: 'image' },
  { name: 'Generative Loop', src: sample07, type: 'video' },
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
let cursorEl;

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

/**
 * Single source of truth for the edge-margin dead zone (see
 * `remapEdgeMargin()` in `src/gestures/utils.js` and ADR-005): both the
 * `cursor` gesture's own reported position *and* this app's ambient
 * hand-skeleton overlay rendering (`drawHandSkeleton()`) must use the same
 * value, or the overlay and the cursor visibly diverge near the frame edges
 * — the overlay would show the true (un-remapped) fingertip position while
 * the cursor "detaches" from it. Defining it once here and reusing it in
 * both places prevents that drift.
 */
const EDGE_MARGIN = 0.15;

const gestureLib = createGestureLibrary({
  activationHand:         'left',
  activationDebounceMs:   500,
  deactivationDebounceMs: 333,
  gestureConfig: {
    'pinch-activate': ACTIVATION_CONFIG,
    'cursor': {
      fingerA:         4,   // thumb tip
      fingerB:         8,   // index fingertip
      touchThreshold:  0.3,
      armHoldMs:       200,
      smoothingFrames: 3,
      edgeMargin:      EDGE_MARGIN,
    },
    'click': {
      fingerA:        4,    // thumb tip
      fingerB:        20,   // pinky fingertip — deliberately different from cursor's pair,
      touchThreshold: 0.3,  // so the two are mutually exclusive (the thumb can only touch one at a time)
      holdMs:         80,
    },
    'zoom': {
      fingerA:        4,
      fingerB:        8,
      outerFingers:   [12, 16, 20],
      wristLandmark:  0,
      closeThreshold: 0.7,
      armHoldMs:      400,
    },
    'flat-hand': { holdMs: 1000 },
    'fist':      { holdMs: 1000 },
    'swipe': {
      trackedLandmark:   9,    // middle finger MCP
      windowMs:          200,
      velocityThreshold: 1.2,
      cooldownMs:        500,
    },
  },
});

gestureLib.register(pinchActivate);
gestureLib.register(cursorGesture);
gestureLib.register(clickGesture);
gestureLib.register(zoom);
gestureLib.register(flatHand);
gestureLib.register(fist);
gestureLib.register(swipe);

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
gestureLib.on('deactivate', () => {
  setSidebarStatus(false);
  cursorEl.dataset.visible = 'false'; // hide the pointer entirely once gesture mode itself ends
  if (hoveredEl) { hoveredEl.classList.remove('gesture-hover'); hoveredEl = null; }
});

gestureLib.on('frame', ({ active, activationDetected }) => {
  if (active) return; // 'activate' handler already owns the label while active
  sidebarStatusEl.dataset.state = activationDetected ? 'holding' : 'inactive';
  sidebarHintEl.textContent     = activationDetected ? 'Hold to activate…' : activationHintText();
});

// --- Cursor (virtual mouse) ---
//
// `cursor`'s value is the normalised (0-1) midpoint of the pinched
// fingertips, in the same coordinate space as raw MediaPipe landmarks.
// Since the hand overlay already covers the full viewport 1:1 (see
// `resizeHandOverlay`), mapping to real screen pixels is a direct multiply
// by the viewport size — no canvas-rect lookup needed, unlike `demo/` where
// the overlay is constrained to a video element's aspect box. The `(1 - x)`
// undoes the mirrored presentation, same convention used everywhere else in
// this repo. This mapping intentionally lives here, not inside
// `cursor.js` — the gesture module stays DOM-agnostic like every other
// gesture in this library (see ADR-005).
//
// Per ADR-005, the cursor is deliberately never hidden again once first
// shown: releasing the pinch just stops position updates, letting the user
// "park" the cursor before clicking with the separate `click` gesture.
let lastCursorPoint = null; // last known viewport position, kept across pinch release
let hoveredEl        = null; // element currently under the cursor, for manual hover-class toggling

const moveCursorTo = ({ x, y }) => {
  const screenX = (1 - x) * window.innerWidth;
  const screenY = y * window.innerHeight;

  lastCursorPoint = { x: screenX, y: screenY };
  cursorEl.style.transform = `translate(${screenX}px, ${screenY}px)`;
  cursorEl.dataset.visible = 'true';
};

gestureLib.on('cursor', ({ value }) => moveCursorTo(value));

/**
 * Manual hover-state tracking (see ADR-005: genuine CSS `:hover` cannot be
 * reliably triggered by synthetic events). Called once per animation frame
 * from `predictWebcam()`, so hover feedback stays live even while the
 * cursor isn't actively being repositioned (i.e. between pinches).
 */
const updateHover = () => {
  if (!lastCursorPoint || cursorEl.dataset.visible !== 'true') return;

  const el = document.elementFromPoint(lastCursorPoint.x, lastCursorPoint.y);

  if (el === hoveredEl) return;
  if (hoveredEl) hoveredEl.classList.remove('gesture-hover');
  hoveredEl = el && el !== document.body && el !== document.documentElement ? el : null;
  if (hoveredEl) hoveredEl.classList.add('gesture-hover');
};

// --- Click ---
//
// Resolves against whatever's under the cursor's last known position —
// `click` carries no position of its own (it uses a different finger pair
// entirely, see ADR-005), by design: cursor and click are mutually
// exclusive gestures, so the cursor is always "parked" wherever it was
// last positioned by the time a click fires.
gestureLib.on('click', () => {
  if (!lastCursorPoint) return;

  const el = document.elementFromPoint(lastCursorPoint.x, lastCursorPoint.y);
  if (el) el.click();

  cursorEl.dataset.clicked = 'true';
  setTimeout(() => { cursorEl.dataset.clicked = 'false'; }, 150);
});

// --- Video play/pause shortcuts + quick close ---

gestureLib.on('flat-hand', () => {
  if (currentView === 'detail' && !detailVideoEl.hidden) detailVideoEl.play();
});

/**
 * Two-step: for videos, the first fist pauses playback (so you don't
 * accidentally leave the view with a video still running); a second fist,
 * once already paused, closes the detail view. Images have no playback
 * state to stop first, so fist closes them immediately. `closeDetail()`
 * itself also pauses the video as a safety net (see below), so this never
 * leaves a video playing in the background even if fist is skipped
 * entirely in favour of clicking "back to grid".
 */
gestureLib.on('fist', () => {
  if (currentView !== 'detail') return;

  if (!detailVideoEl.hidden) {
    if (!detailVideoEl.paused) {
      detailVideoEl.pause();
      return;
    }
    closeDetail();
    return;
  }

  closeDetail(); // showing an image: nothing to pause first, close immediately
});

// --- Zoom (detail view, images only) ---

const ZOOM_MIN         = 0.5;
const ZOOM_MAX         = 3;
const ZOOM_SENSITIVITY = 4; // multiplies the raw per-frame pinch-distance delta

let zoomScale = 1;

const applyZoomDelta = (delta) => {
  if (currentView !== 'detail' || detailImageEl.hidden) return; // zoom only applies to images, detail view only
  zoomScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomScale + delta));
  detailImageEl.style.transform = `scale(${zoomScale})`;
};

const resetZoom = () => {
  zoomScale = 1;
  detailImageEl.style.transform = 'scale(1)';
};

gestureLib.on('zoom', ({ value }) => applyZoomDelta(value * ZOOM_SENSITIVITY));

// --- Swipe (detail view navigation shortcut, alongside the prev/next buttons) ---
//
// Left = next, right = previous (see ADR-005/docs/gestures.md) — a quick,
// no-aim-required alternative to clicking the on-screen prev/next buttons
// via cursor+click, same relationship flat-hand/fist have to the video's
// native controls.
gestureLib.on('swipe', ({ value }) => {
  if (currentView !== 'detail') return;
  if (value.direction === 'left') showNext();
  else showPrev();
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

    // Hover feedback is re-evaluated every frame (not just on 'cursor'
    // events) so it stays live even while the cursor is "parked" between
    // pinches — see ADR-005.
    updateHover();
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
 * Each landmark is remapped through the same `EDGE_MARGIN` dead zone used
 * by the `cursor` gesture's own config before being drawn (see
 * `remapEdgeMargin()`/ADR-005). Without this, the overlay and the cursor
 * element would visibly diverge near the frame edges — the overlay showing
 * the true, un-remapped fingertip position while the cursor (which *is*
 * remapped) appears to detach from it.
 *
 * @param {Array<{x:number,y:number}>} landmarks
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 */
const drawHandSkeleton = (landmarks, canvas, ctx) => {
  const mapped = landmarks.map((p) => ({
    x: remapEdgeMargin(p.x, EDGE_MARGIN),
    y: remapEdgeMargin(p.y, EDGE_MARGIN),
  }));

  ctx.lineWidth   = 2;
  ctx.strokeStyle = 'rgba(192, 132, 252, 0.35)'; // matches the --accent-a token in gallery.css
  for (const [a, b] of HAND_CONNECTIONS) {
    const p1 = mapped[a], p2 = mapped[b];
    ctx.beginPath();
    ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
    ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  for (const point of mapped) {
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
  items = DEMO_IMAGES.map((img) => ({ ...img, objectUrl: false }));
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
  resetZoom(); // start each newly-opened item unzoomed
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
  resetZoom(); // each item starts unzoomed
  renderDetail();
};

const showPrev = () => {
  if (items.length === 0) return;
  selectedIndex = (selectedIndex - 1 + items.length) % items.length;
  resetZoom();
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
  cursorEl            = document.getElementById('gallery-cursor');

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
  document.getElementById('btn-detail-prev').addEventListener('click', showPrev);
  document.getElementById('btn-detail-next').addEventListener('click', showNext);

  document.addEventListener('keydown', onKeydown);
};

document.addEventListener('DOMContentLoaded', init);
