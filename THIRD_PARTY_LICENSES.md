# Third-Party Licenses

This project uses the following third-party software and hosted assets. This is
not the project's own license (see `LICENSE`), but an overview of external
components and the terms they are provided under.

## Runtime dependency

### @mediapipe/tasks-vision

- **Version:** 0.10.35 (see `package.json`)
- **License:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **Source:** https://www.npmjs.com/package/@mediapipe/tasks-vision
- **Usage:** provides the `HandLandmarker` used for all hand-tracking and
  gesture recognition in this project.

## Runtime-fetched assets (not bundled, not part of the npm dependency tree)

As documented in the README ("Runtime dependencies"), two additional assets are
fetched from CDNs at runtime and are not stored in this repository:

### MediaPipe WASM runtime

- **License:** Apache License 2.0 (same project as above)
- **Source:** `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm`

### Hand Landmarker model (`hand_landmarker.task`)

- **Provider:** Google
- **License:** Apache License 2.0 (per the [MediaPipe Solutions license](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker#models))
- **Source:** `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
- **Usage:** pre-trained model weights used by `HandLandmarker` for hand
  detection and 21-point landmark estimation. No modification, retraining, or
  redistribution of the model is performed by this project.

## Build tooling (development only, not shipped to end users)

### Vite

- **License:** MIT
- **Source:** https://github.com/vitejs/vite

## Sample media

- The bundled sample images in `gallery/samples/` (`CrystalDepth.jpg`,
  `FracturedGlass.jpg`, `LiquidCircuit.jpg`, `NebulaDrift.jpg`,
  `PlasmaBloom.jpg`, `WovenLight.jpg`) are AI-generated abstract/generative-art
  pieces created with Google's Nano Banana image generator (see ADR-005,
  "Visual theme: Generative Art Studio"). They are original generated content
  used for demonstration purposes only within this university coursework
  project.
- `Video.mp4` is a sample video bundled for demonstration purposes only.

These assets are not redistributed as part of any published package and are
only used to demo the gallery's gesture-controlled browsing/viewing features.
