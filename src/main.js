import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
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

// Gesture control state.
// null = never triggered (initial), true = active, false = inactive.
let gestureActive = null;

// Tracks how long the current static pose has been held continuously.
// { pose: 'flat'|'fist'|null, since: DOMHighResTimeStamp }
let gestureHoldState = { pose: null, since: 0 };

// How long a pose must be held before it triggers (ms).
const GESTURE_HOLD_MS = 3000;

// --- Constants ---
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [5, 9], [9, 10], [10, 11], [11, 12],  // Middle
  [9, 13], [13, 14], [14, 15], [15, 16],// Ring
  [13, 17], [17, 18], [18, 19], [19, 20],// Pinky
  [0, 17]                                // Palm base
];

// Pairs of [fingertip index, PIP joint index] for the four non-thumb fingers.
// In normalised coords y increases downward, so tip.y < pip.y means extended.
const FINGER_TIP_PIP = [
  [8, 6],   // index
  [12, 10], // middle
  [16, 14], // ring
  [20, 18], // pinky
];

// --- Gesture detection ---

/**
 * Classify the current hand pose as 'flat', 'fist', or null.
 *
 * Flat hand: all four non-thumb fingers extended (tip above PIP on y-axis).
 * Fist:      all four non-thumb fingers curled  (tip below MCP on y-axis).
 *
 * @param {Array} landmarks  – normalised 3-D landmarks from MediaPipe
 * @returns {'flat'|'fist'|null}
 */
const detectStaticPose = (landmarks) => {
  let extendedCount = 0;
  let curledCount = 0;

  for (const [tipIdx, pipIdx] of FINGER_TIP_PIP) {
    const tip = landmarks[tipIdx];
    const pip = landmarks[pipIdx];
    if (tip.y < pip.y) extendedCount++;
    else curledCount++;
  }

  if (extendedCount === 4) return 'flat';
  if (curledCount === 4)   return 'fist';
  return null;
};

/**
 * Update the hold-state tracker and return whether a confirmed trigger fired.
 * Returns the triggered pose string if the hold threshold was just crossed,
 * otherwise null.
 *
 * @param {'flat'|'fist'|null} currentPose
 * @returns {'flat'|'fist'|null}
 */
const updateGestureHold = (currentPose) => {
  const now = performance.now();

  if (currentPose !== gestureHoldState.pose) {
    // Pose changed — reset the timer.
    gestureHoldState = { pose: currentPose, since: now };
    return null;
  }

  if (currentPose === null) return null;

  const held = now - gestureHoldState.since;
  if (held >= GESTURE_HOLD_MS) {
    // Reset so the same gesture doesn't keep firing every frame.
    gestureHoldState = { pose: null, since: now };
    return currentPose;
  }

  return null;
};

// --- Sidebar status indicator ---

const updateGestureStatus = (pose, heldMs) => {
  const el = document.getElementById('gesture-status');
  if (!el) return;

  const iconEl  = el.querySelector('.gesture-icon');
  const labelEl = el.querySelector('.gesture-label');
  const ringEl  = el.querySelector('.gesture-ring');

  if (!pose) {
    // No recognised pose — idle state
    el.dataset.state = 'idle';
    iconEl.textContent  = '◎';
    labelEl.textContent = 'No gesture detected';
    if (ringEl) ringEl.style.setProperty('--progress', '0');
    return;
  }

  // A pose is being held — show progress
  const progress = Math.min(heldMs / GESTURE_HOLD_MS, 1);
  el.dataset.state = pose === 'flat' ? 'holding-start' : 'holding-stop';
  iconEl.textContent  = pose === 'flat' ? '▶' : '■';
  labelEl.textContent = pose === 'flat'
    ? 'Hold to activate…'
    : 'Hold to deactivate…';
  if (ringEl) ringEl.style.setProperty('--progress', progress.toString());
};

const setGestureActiveState = (active) => {
  const el = document.getElementById('gesture-status');
  if (!el) return;

  const iconEl  = el.querySelector('.gesture-icon');
  const labelEl = el.querySelector('.gesture-label');
  const ringEl  = el.querySelector('.gesture-ring');

  el.dataset.state = active ? 'active' : 'inactive';
  iconEl.textContent  = active ? '▶' : '■';
  labelEl.textContent = active ? 'Gesture Control: ON' : 'Gesture Control: OFF';
  if (ringEl) ringEl.style.setProperty('--progress', '0');
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
    numHands: 1,
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

    if (results.landmarks && results.landmarks.length > 0) {
      const landmarks = results.landmarks[0];

      // --- Gesture detection ---
      const currentPose = detectStaticPose(landmarks);
      const triggered   = updateGestureHold(currentPose);

      if (triggered === 'flat' && gestureActive !== true) {
        gestureActive = true;
        setGestureActiveState(true);
      } else if (triggered === 'fist' && gestureActive !== false) {
        gestureActive = false;
        setGestureActiveState(false);
      } else {
        // Only show the progress ring when the held pose would cause a transition.
        // - Not yet confirmed (null): show any pose progress or idle.
        // - Active: only show progress for fist (toward deactivation).
        // - Inactive: only show progress for flat (toward activation).
        const relevantPose =
          gestureActive === null                               ? currentPose :
          gestureActive === true  && currentPose === 'fist'   ? currentPose :
          gestureActive === false && currentPose === 'flat'   ? currentPose :
          null; // irrelevant pose — keep confirmed state, don't overwrite

        if (relevantPose !== null || gestureActive === null) {
          const heldMs = currentPose !== null && currentPose === gestureHoldState.pose
            ? performance.now() - gestureHoldState.since
            : 0;
          updateGestureStatus(relevantPose, heldMs);
        }
        // If relevantPose is null and gestureActive is confirmed, do nothing —
        // setGestureActiveState already set the display and it should persist.
      }

      // --- Main video overlay ---
      if (overlayMode === 'fingertips') {
        canvasCtx.fillStyle = '#bb86fc';
        for (const index of [4, 8, 12, 16, 20]) {
          const point = landmarks[index];
          canvasCtx.beginPath();
          canvasCtx.arc(point.x * canvasElement.width, point.y * canvasElement.height, 5, 0, 2 * Math.PI);
          canvasCtx.fill();
        }
      } else if (overlayMode === 'full') {
        canvasCtx.lineWidth   = 4;
        canvasCtx.strokeStyle = '#bb86fc';
        for (const [a, b] of HAND_CONNECTIONS) {
          const p1 = landmarks[a], p2 = landmarks[b];
          canvasCtx.beginPath();
          canvasCtx.moveTo(p1.x * canvasElement.width, p1.y * canvasElement.height);
          canvasCtx.lineTo(p2.x * canvasElement.width, p2.y * canvasElement.height);
          canvasCtx.stroke();
        }
        canvasCtx.fillStyle = '#ffffff';
        for (const point of landmarks) {
          canvasCtx.beginPath();
          canvasCtx.arc(point.x * canvasElement.width, point.y * canvasElement.height, 3, 0, 2 * Math.PI);
          canvasCtx.fill();
        }
      }

      // --- Sidebar hand canvas ---
      if (sidebarMode !== 'none' && sidebarCtx) {
        let drawLandmarks = landmarks;
        const scaleX = sidebarCanvas.width;
        const scaleY = sidebarCanvas.height;

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
          drawLandmarks  = landmarks.map(p => ({
            x: (p.x - centerX) * scale + 0.5,
            y: (p.y - centerY) * scale + 0.5,
          }));
        }

        if (sidebarMode === 'model') {
          sidebarCtx.fillStyle = '#ffb69b';
          sidebarCtx.beginPath();
          for (const idx of [0, 1, 5, 9, 13, 17]) {
            const p = drawLandmarks[idx];
            idx === 0
              ? sidebarCtx.moveTo(p.x * scaleX, p.y * scaleY)
              : sidebarCtx.lineTo(p.x * scaleX, p.y * scaleY);
          }
          sidebarCtx.closePath();
          sidebarCtx.fill();

          sidebarCtx.lineWidth   = 15;
          sidebarCtx.lineCap     = 'round';
          sidebarCtx.lineJoin    = 'round';
          sidebarCtx.strokeStyle = '#ffb69b';
          for (const [a, b] of HAND_CONNECTIONS) {
            const p1 = drawLandmarks[a], p2 = drawLandmarks[b];
            sidebarCtx.beginPath();
            sidebarCtx.moveTo(p1.x * scaleX, p1.y * scaleY);
            sidebarCtx.lineTo(p2.x * scaleX, p2.y * scaleY);
            sidebarCtx.stroke();
          }
        } else {
          sidebarCtx.lineWidth   = 4;
          sidebarCtx.strokeStyle = '#bb86fc';
          for (const [a, b] of HAND_CONNECTIONS) {
            const p1 = drawLandmarks[a], p2 = drawLandmarks[b];
            sidebarCtx.beginPath();
            sidebarCtx.moveTo(p1.x * scaleX, p1.y * scaleY);
            sidebarCtx.lineTo(p2.x * scaleX, p2.y * scaleY);
            sidebarCtx.stroke();
          }
          sidebarCtx.fillStyle = '#ffffff';
          for (const p of drawLandmarks) {
            sidebarCtx.beginPath();
            sidebarCtx.arc(p.x * scaleX, p.y * scaleY, 3, 0, 2 * Math.PI);
            sidebarCtx.fill();
          }
        }
      }
    } else {
      // No hand detected — reset hold timer.
      if (gestureHoldState.pose !== null) {
        gestureHoldState = { pose: null, since: 0 };
      }
      // Only revert to idle if no confirmed state has been set yet.
      if (gestureActive === null) {
        updateGestureStatus(null, 0);
      }
      // If confirmed active/inactive, keep showing that state.
    }
  }

  requestAnimationFrame(predictWebcam);
};

document.addEventListener('DOMContentLoaded', initializeHandTracking);
