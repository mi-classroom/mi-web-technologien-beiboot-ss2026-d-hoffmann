# AGENTS.md

Guidance for AI agents working in this repository.

## Project context

University semester project (Cologne Media Informatics, SS2026). The long-term goal is a client-server app for managing IPTC metadata on images, but each assignment is a standalone exploratory prototype. Current state (Assignment 3 complete): a purely frontend MediaPipe hand-tracking + gesture library demo — no backend, no IPTC logic yet.

ADRs in `docs/adr/` document architectural decisions. New decisions should get an ADR.

## Package manager & toolchain

- **npm** (use `npm`, not `pnpm` or `yarn` — `package-lock.json` is committed)
- **Vite 8** as build tool; no TypeScript, no test framework, no linter configured
- All `.js` files are ES Modules (`"type": "module"` in `package.json`)
- Single runtime dependency: `@mediapipe/tasks-vision`

## Dev commands

```bash
npm install          # install dependencies
npm run dev          # dev server with HTTPS + LAN exposure (--host)
npm run build        # production build → dist/
npm run preview      # serve dist/ locally
```

No test, lint, or typecheck commands exist.

## Non-obvious quirks

- **HTTPS required in dev:** `@vitejs/plugin-basic-ssl` auto-generates a self-signed cert. Without it `getUserMedia` (webcam) silently fails in browsers. Do not remove the plugin.
- **`--host` is intentional:** The dev server is exposed on the local network so the app can be tested on physical mobile devices.
- **Models and WASM fetched at runtime from CDN:** The hand landmarker model is downloaded from Google Cloud Storage; WASM is fetched from `cdn.jsdelivr.net` using `@latest` (not pinned to the installed package version — potential drift). No local model files. Internet access required to initialize the landmarkers.
- **FaceLandmarker is gone:** Earlier versions tracked face/eyes. The current code is hand tracking only. There is no face or blink detection.
- **GPU delegate:** The hand landmarker requests `"GPU"` delegate via WebGL. Headless/server environments will not work for running the vision pipeline.
- **Video/canvas mirroring:** `transform: scaleX(-1)` is applied in CSS to both the video and all canvases. MediaPipe already corrects handedness for webcam mirroring (`"Left"` = user's left hand). Do not add additional mirroring logic.
- **`pinch-activate.js` defaults differ from what `main.js` uses:** The gesture file defaults to `fingerB: 16` (ring tip), but `main.js` overrides it to `fingerB: 8` (index tip). `docs/gestures.md` documents the operative (overridden) value. The override is intentional.
- **Hold timing in gesture files uses `performance.now()` directly** inside `detect()` rather than the `timestamp` parameter passed by the library. This is a known design inconsistency (see ADR-003).

## Repository structure

```
src/main.js              # app entry: wires webcam, MediaPipe, gesture library, rendering
src/style.css            # styles; contains dead toggle-switch CSS (no matching HTML)
src/gestures/
  index.js               # createGestureLibrary() — factory function, core event/activation model
  pinch-activate.js      # activation gesture (role: 'activation')
  flat-hand.js           # command gesture: all fingers extended, hold 1000 ms
  fist.js                # command gesture: all fingers curled, hold 1000 ms
index.html               # entry point; DOM IDs that JS binds: #webcam, #output_canvas,
                         #   #sidebar_hand_canvas, #gesture-status, #activation-hint,
                         #   #overlay-mode, #sidebar-mode
docs/adr/                # Architectural Decision Records (001, 002, 003)
docs/gestures.md         # gesture vocabulary: implemented vs. planned
docs/tasks/              # assignment briefs (German)
docs/time-allocation/    # per-assignment time tracking
vite.config.js           # only configures basicSsl plugin
```

No CI, no monorepo, no sub-packages.

## Gesture library API (src/gestures/index.js)

`createGestureLibrary(config)` returns `{ register, on, off, process, isActive, activationHand }`.

- **`register(gesture)`** — adds a gesture definition `{ name, role, detect(landmarks) }`. Role is `'activation'` (one only) or `'command'`.
- **`on(name, handler)` / `off(name, handler)`** — subscribe/unsubscribe to named gesture events.
- **`process(results, timestamp)`** — call every frame with raw MediaPipe `HandLandmarkerResult`. Command gestures are only evaluated while the activation gesture is held.
- Activation model: **continuous hold** (not toggle). Releasing the pinch deactivates immediately.

## Known gaps / things to check before assuming complete

- Task 3 requires at least **4 gestures**; currently only 3 are implemented (`pinch-activate`, `flat-hand`, `fist`). A 4th gesture may need to be added.
- `isPinchDetectedInResults()` in `main.js` duplicates pinch logic from `pinch-activate.js` (for the pre-activation hint UI). These can drift — documented in ADR-003 as a known issue.
- No `docs/time-allocation/assignment-3.md` exists yet.
