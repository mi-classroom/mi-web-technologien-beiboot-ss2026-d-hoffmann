# ADR-001: Select MediaPipe for real-world input detection

**Status:** Accepted

**Date:** 2026-05-06

**Deciders:** David Hoffmann 

## Context
The application needs to observe events in the physical world and translate them into API calls that control application behavior. Likely input sources include camera-based perception such as face, hand, gesture, object, pose, or holistic body detection, and the implementation should favor modular components, practical integration paths, and strong documentation for engineering use.

The broader technical direction emphasizes a modular architecture in which sensor input is separated from event interpretation and downstream API actions. In this setup, the vision layer should expose reusable capabilities that can be composed into higher-level rules such as “gesture detected,” “person present,” or “pose condition met,” without forcing a monolithic application framework.

## Considered Options

### MediaPipe Tasks
**Selected.** Provides high-level, production-ready vision tasks optimized for the edge via WASM/WebGL, offering immediate access to precise topologies (e.g., 21-point hand, 478-point face).

### OpenCV
**Rejected.** Requires extensive custom pipeline design to reach high-level interaction concepts. Increases implementation complexity and maintenance burden compared to packaged task frameworks.

### Ultralytics YOLO
**Rejected.** Strong for object detection, but less optimized out-of-the-box for the dense, high-frequency kinematic landmarking (hands/face) required by this application.

### Cloud-based Inference (e.g., AWS Rekognition)
**Rejected.** Introduces unacceptable network latency for real-time control, high recurring infrastructure costs, and significant privacy concerns regarding raw video transmission.

## Decision
MediaPipe Tasks has been selected as the primary perception framework for the first implementation of the real-world input layer. While the initial implementation focuses specifically on **Hand and Face Landmarking**, the framework retains the capability to seamlessly expand to other modes like Gesture Recognition.
MediaPipe Tasks Vision provides a set of discrete task classes rather than a single opaque pipeline, including FaceDetector, FaceLandmarker, GestureRecognizer, HandLandmarker, HolisticLandmarker, ImageClassifier, ImageEmbedder, ImageSegmenter, ObjectDetector, and PoseLandmarker. This task-oriented structure maps well to an architecture where each detector can be selected independently and connected to an event-processing and API layer.


The decision is based on four main factors:

- MediaPipe offers high-level, production-oriented vision tasks that cover the most relevant interaction modes for the application, including gesture recognition, hand landmarks, face landmarks, object detection, and pose detection.
- The framework exposes an easy to use JavaScript API, which supports web and backend prototyping without requiring a fully custom computer vision stack from day one.
- The package documentation includes concrete creation patterns built around `FilesetResolver.forVisionTasks(...)` and task-specific constructors such as `HandLandmarker.createFromOptions(...)`, which directly fetch models via URL in the browser, reducing integration friction and improving maintainability.
- The API surface is modular enough to support incremental adoption, allowing one task to be implemented first and additional tasks to be added later without replacing the perception layer wholesale.

## Consequences

### Positive
- No Heavy Server Computations: All computer vision processing happens directly on the user's device, keeping the backend simple and lightweight.
- Low Latency: Inference occurs locally within the browser's requestAnimationFrame render cycle, eliminating network latency from the vision processing step.
- Privacy by Design: Raw camera feeds are bound locally to the device and never transmitted over the network.
- Architectural Flexibility: The discrete, task-oriented structure allows us to start with a single detector and expand to multimodal perception without redesigning the integration boundary.
- High Precision: Out-of-the-box access to pre-trained AI models that are lightweight enough to run directly in the browser.
- Hardware Acceleration: Built-in support for the GPU delegate via WebGL ensures real-time inference efficiency directly in the browser.

### Negative / Risks
- Client Device Dependency: Telemetry accuracy and frame rate are coupled to client hardware. Low-end devices may require frame-skipping logic to maintain performance.
- Optimization Constraints: If future requirements shift toward highly specialized classical vision operations not covered by MediaPipe tasks, a hybrid architecture utilizing OpenCV may be necessary.