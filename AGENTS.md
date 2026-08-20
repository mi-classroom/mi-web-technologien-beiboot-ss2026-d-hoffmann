# AGENTS.md

Guidance for AI agents working in this repository.

## Project context

University semester project (Cologne Media Informatics, SS2026). The long-term goal is a client-server app for managing IPTC metadata on images, but each assignment is a standalone exploratory prototype. Current state (Assignment 5 complete): a purely frontend MediaPipe hand-tracking + gesture library, with two consuming apps - a gesture-controlled image/video gallery (the primary deployed app, Task 5/Weg A) and an earlier hand-tracking-modes demo kept for reference. No backend, no IPTC logic yet.

ADRs in `docs/adr/` document architectural decisions. New decisions should get an ADR.

## Package manager & toolchain

- **npm** (use `npm`, not `pnpm` or `yarn` - `package-lock.json` is committed)
- **Vite 8** as build tool; no TypeScript, no test framework. ESLint (flat config, `@eslint/js` recommended rules) and Prettier are configured for linting/formatting.
- All `.js` files are ES Modules (`"type": "module"` in `package.json`)
- Single runtime dependency: `@mediapipe/tasks-vision`
- Node version: `^20.19.0 || >=22.12.0` (Vite 8's requirement, declared in `package.json`'s `engines` field)

## Dev commands

```bash
npm install          # install dependencies
npm run dev          # dev server (plain HTTP on localhost)
npm run build        # production build → dist/ (both apps, multi-page)
npm run preview      # serve dist/ locally
npm run lint         # ESLint
npm run format       # Prettier - writes fixes
npm run format:check # Prettier - check only (used in CI)
```

No test or typecheck commands exist. `npm run lint` and `npm run format:check` are run in CI (`.github/workflows/ci.yml`) on push and pull_request.

## Non-obvious quirks

- **Dev server runs plain HTTP on localhost, deliberately:** `getUserMedia` (webcam) requires a secure context, but `http://localhost` already counts as one in every major browser - no TLS cert needed. An earlier version of this project ran `vite --host` with `@vitejs/plugin-basic-ssl` to also expose the dev server on the LAN (for testing on a physical phone over HTTPS via IP address); that's no longer needed and was removed. Don't reintroduce it without a concrete reason - it causes a self-signed-cert browser warning for no benefit in normal local development.
- **Two build entries, one shared library:** `vite.config.js` builds two HTML entry points (`index.html` at the root = the gallery app; `test/index.html` = the older demo). Both import from the shared `src/gestures/` library, but each has its own app-shell JS/CSS (`gallery/gallery.js`+`gallery/gallery.css` vs. `test/main.js`+`test/style.css`). Don't assume changes to one shell affect the other - only `src/gestures/*` is truly shared.
- **`base` is env-driven for GitHub Pages:** `vite.config.js` reads `GH_PAGES_BASE` to set Vite's `base` option, defaulting to `/` for local dev/build. The deploy workflow (`.github/workflows/deploy.yml`) sets it to the repo-name subpath since GitHub Pages serves project pages from `https://<org>.github.io/<repo>/`, not the domain root.
- **Models and WASM fetched at runtime from CDN:** The hand landmarker model is downloaded from Google Cloud Storage; WASM is fetched from `cdn.jsdelivr.net` using `@latest` (not pinned to the installed package version - potential drift). No local model files. Internet access required to initialize the landmarkers.
- **FaceLandmarker is gone:** Earlier versions tracked face/eyes. The current code is hand tracking only. There is no face or blink detection.
- **GPU delegate:** The hand landmarker requests `"GPU"` delegate via WebGL. Headless/server environments will not work for running the vision pipeline.
- **Video/canvas mirroring:** `transform: scaleX(-1)` is applied in CSS to both the video and all canvases. MediaPipe already corrects handedness for webcam mirroring (`"Left"` = user's left hand). Do not add additional mirroring logic.
- **`pinch-activate.js` defaults differ from what both apps use:** The gesture file defaults to `fingerB: 16` (ring tip), but `test/main.js` and `gallery/gallery.js` both override it to `fingerB: 8` (index tip). `docs/gestures.md` documents the operative (overridden) value. The override is intentional.
- **Hold timing in gesture files uses the `timestamp` parameter forwarded by the library** (previously used `performance.now()` directly inside `detect()`; fixed - see ADR-003, "Continuous-value gestures").

## Repository structure

```
index.html               # gallery app entry (deployed to GitHub Pages root); DOM IDs bound by gallery/gallery.js
gallery/
  gallery.js              # gallery app shell: webcam, MediaPipe, gesture library wiring, view logic
  gallery.css              # gallery app styles ("Generative Art Studio" theme, see ADR-005)
  samples/                # bundled demo images/video, imported as ES modules
test/
  index.html               # older hand-tracking-modes demo entry (secondary /test/ page, kept for reference)
  main.js                  # demo app: wires webcam, MediaPipe, gesture library, rendering
  style.css                # demo styles; contains dead toggle-switch CSS (no matching HTML)
src/gestures/            # the shared gesture library - consumed by BOTH apps above via its public API
  index.js               # createGestureLibrary() - factory function, core event/activation model
  pinch-activate.js      # activation gesture (role: 'activation')
  cursor.js              # command gesture: pinch-armed absolute on-screen pointer
  click.js               # command gesture: brief thumb+pinky touch, one-shot
  zoom.js                # command gesture: arm-then-stream pinch zoom
  swipe.js               # command gesture: velocity-triggered horizontal navigation
  flat-hand.js           # command gesture: all fingers extended, hold 1000 ms
  fist.js                # command gesture: all fingers curled, hold 1000 ms
  utils.js               # shared helpers: dist3d, handSize, holdGate, remapEdgeMargin
docs/adr/                # Architectural Decision Records (001-006)
docs/gestures.md         # gesture vocabulary: implemented vs. planned
docs/tasks/              # assignment briefs (German)
docs/time-allocation/    # per-assignment time tracking
vite.config.js           # multi-page build (gallery + test), GH_PAGES_BASE-driven `base`
.github/workflows/       # CI (lint/format/build) and GitHub Pages deploy workflows
```

CI: `ci.yml` runs lint, format-check, and build on push and pull_request. `deploy.yml` builds and deploys to GitHub Pages on push to `main` (and currently also `feature/assignment-5` during active development). No monorepo, no sub-packages.

## Gesture library API (src/gestures/index.js)

`createGestureLibrary(config)` returns `{ register, on, off, process, isActive, activationHand }`.

- **`register(gesture)`** - adds a gesture definition `{ name, role, detect(landmarks) }`. Role is `'activation'` (one only) or `'command'`.
- **`on(name, handler)` / `off(name, handler)`** - subscribe/unsubscribe to named gesture events.
- **`process(results, timestamp)`** - call every frame with raw MediaPipe `HandLandmarkerResult`. Command gestures are only evaluated while the activation gesture is held.
- Activation model: **continuous hold** (not toggle). Releasing the pinch deactivates immediately.

## Known gaps / things to check before assuming complete

- `isPinchDetectedInResults()` in `test/main.js` duplicates pinch logic from `pinch-activate.js` (for the pre-activation hint UI). These can drift - documented in ADR-003 as a known issue.
- ADR-005's reflection section and final tuned gesture config values may still need finishing touches - check its "Open items" section.
