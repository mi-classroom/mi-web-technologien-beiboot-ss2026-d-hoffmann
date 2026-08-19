/**
 * @module gallery
 *
 * Weg A vision application (ADR-005): a gesture-controlled image/video
 * gallery viewer. This file currently implements the static frontend shell
 * — camera permission gate, file source selection, grid view, and detail
 * view — driven by mouse clicks and a keyboard fallback. Gesture wiring
 * (pinch-activate, pan, fist, flat-hand, zoom) is added in a later pass;
 * nothing here reaches into `src/gestures` yet.
 *
 * ## Flow
 *
 * 1. **Welcome / camera permission gate**: the app requires webcam access
 *    for gesture tracking, so before anything else it asks the user to
 *    explicitly grant camera permission via a button (rather than calling
 *    `getUserMedia` immediately on load, which would show the browser's
 *    native permission prompt with no context and could be dismissed/denied
 *    without the user understanding why it's asking). Once granted, the
 *    obtained stream's tracks are stopped immediately — this screen only
 *    exists to secure the permission grant itself; the actual camera feed
 *    is (re-)acquired later once gesture tracking is wired in. Browsers
 *    persist the grant per origin, so the later `getUserMedia` call will
 *    not prompt again.
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

// --- View switching ---

/** @type {'welcome'|'select'|'grid'|'detail'} */
let currentView = 'welcome';

const setView = (view) => {
  currentView = view;
  viewWelcomeEl.dataset.active = String(view === 'welcome');
  viewSelectEl.dataset.active  = String(view === 'select');
  viewGridEl.dataset.active    = String(view === 'grid');
  viewDetailEl.dataset.active  = String(view === 'detail');
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
 * Ask the browser for camera permission, then immediately release the
 * stream. This screen only exists to secure the permission grant itself —
 * the real camera feed is (re-)acquired once gesture tracking is wired in,
 * and browsers persist the grant per origin so that call won't re-prompt.
 */
const requestCameraPermission = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    setWelcomeStatus('unsupported', 'This browser does not support camera access (getUserMedia unavailable).');
    return;
  }

  setWelcomeStatus('requesting', 'Requesting camera access…');
  btnGrantCameraEl.disabled = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((track) => track.stop());
    cameraPermissionGranted = true;
    setWelcomeStatus('granted', 'Camera access granted.');
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
