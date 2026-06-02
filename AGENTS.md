# AGENTS.md

Guidance for AI agents working in this repository.

## Project context

University semester project (Cologne Media Informatics, SS2026). The long-term goal is a client-server app for managing IPTC metadata on images, but each assignment is a standalone exploratory prototype. The current state (Assignment 1) is a purely frontend MediaPipe hand/face tracking demo — no backend, no IPTC logic yet.

ADRs in `docs/adr/` document architectural decisions. New decisions should get an ADR.

## Package manager & toolchain

- **npm** (use `npm`, not `pnpm` or `yarn` — `package-lock.json` is committed)
- **Vite 8** as build tool; no TypeScript, no test framework, no linter configured
- All `.js` files are ES Modules (`"type": "module"` in `package.json`)

## Dev commands

```bash
npm install          # install dependencies
npm run dev          # dev server with HTTPS + LAN exposure (--host)
npm run build        # production build → dist/
npm run preview      # serve dist/ locally
```

No test, lint, or typecheck commands exist yet.

## Non-obvious quirks

- **HTTPS required in dev:** `@vitejs/plugin-basic-ssl` auto-generates a self-signed cert. Without it `getUserMedia` (webcam) silently fails in browsers. Do not remove the plugin.
- **`--host` is intentional:** The dev server is exposed on the local network so the app can be tested on physical mobile devices.
- **Models fetched at runtime from CDN:** Hand and face landmarker models are downloaded from Google Cloud Storage on first use. No local model files. Internet access is required to initialize the landmarkers.
- **Left/right eye label swap:** Blink detection in `src/main.js` intentionally swaps `eyeBlinkLeft`/`eyeBlinkRight` to compensate for browser webcam mirroring. This is correct behavior, not a bug.
- **GPU delegate:** Both landmarkers request `"GPU"` delegate via WebGL. Headless/server environments will not work for running the vision pipeline.

## Repository structure

```
src/main.js          # entire frontend application (single file)
src/style.css        # styles
index.html           # entry point
docs/adr/            # Architectural Decision Records
docs/time-allocation/ # per-assignment time tracking
vite.config.js       # only configures basicSsl plugin
```

No CI, no monorepo, no sub-packages.
