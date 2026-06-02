/**
 * EXPERIMENTAL — Face & Blink Tracking
 *
 * This module is not loaded by default. It was extracted from main.js after
 * Assignment 1 to keep the main application focused on gesture recognition.
 *
 * To re-enable: import and call initFaceTracking(vision) in main.js, then
 * call detectFace(video, canvasCtx, canvasElement) inside the render loop.
 *
 * Known stability issues (see ADR-001 evaluation):
 * - Blink detection requires a high threshold to trigger reliably, causing
 *   occasional false positives on open eyes.
 * - Running hand + face detection in parallel introduces visible input lag.
 */

import { FaceLandmarker } from '@mediapipe/tasks-vision';

let faceLandmarker = null;

export const initFaceTracking = async (vision) => {
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    outputFaceBlendshapes: true,
    runningMode: 'VIDEO',
    numFaces: 1,
  });
};

/**
 * Run face detection for the current video frame and draw eye indicators.
 * Call once per frame inside the render loop after hand detection.
 *
 * @param {HTMLVideoElement} video
 * @param {CanvasRenderingContext2D} canvasCtx
 * @param {HTMLCanvasElement} canvasElement
 */
export const detectFace = (video, canvasCtx, canvasElement) => {
  if (!faceLandmarker) return;

  const faceResults = faceLandmarker.detectForVideo(video, performance.now());
  if (!faceResults.faceLandmarks || faceResults.faceLandmarks.length === 0) return;

  const landmarks = faceResults.faceLandmarks[0];

  let eyeBlinkLeftScore = 0;
  let eyeBlinkRightScore = 0;

  if (faceResults.faceBlendshapes && faceResults.faceBlendshapes.length > 0) {
    const blendshapes = faceResults.faceBlendshapes[0].categories;
    eyeBlinkLeftScore = blendshapes.find(s => s.categoryName === 'eyeBlinkLeft')?.score ?? 0;
    eyeBlinkRightScore = blendshapes.find(s => s.categoryName === 'eyeBlinkRight')?.score ?? 0;
  }

  // Swap left/right to compensate for browser webcam mirroring.
  const eyes = [
    { index: 468, isClosed: eyeBlinkRightScore > 0.4 }, // left iris center (mirrored)
    { index: 473, isClosed: eyeBlinkLeftScore > 0.4 },  // right iris center (mirrored)
  ];

  for (const eye of eyes) {
    const point = landmarks[eye.index];
    const x = point.x * canvasElement.width;
    const y = point.y * canvasElement.height;

    canvasCtx.beginPath();
    canvasCtx.arc(x, y, 3, 0, 2 * Math.PI);
    canvasCtx.fillStyle = eye.isClosed ? '#ff0000' : '#ffffff';
    canvasCtx.fill();
  }
};
