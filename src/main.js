import { HandLandmarker, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import './style.css'; 

let video;
let canvasElement;
let canvasCtx;
let handLandmarker;
let faceLandmarker;
let lastVideoTime = -1;
let isFaceTrackingEnabled = false;
let overlayMode = 'fingertips';
let sidebarMode = 'synced';
let sidebarCanvas;
let sidebarCtx;

const HAND_CONNECTIONS = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [5, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [13, 17], [17, 18], [18, 19], [19, 20],
  // Palm base
  [0, 17]
];

const initializeHandTracking = async () => {
  // Bind the DOM elements
  video = document.getElementById('webcam');
  canvasElement = document.getElementById('output_canvas');
  
  const faceToggle = document.getElementById('face-toggle');
  if (faceToggle) {
    faceToggle.addEventListener('change', (e) => {
      isFaceTrackingEnabled = e.target.checked;
    });
  }
  
  const overlaySelect = document.getElementById('overlay-mode');
  if (overlaySelect) {
    overlaySelect.addEventListener('change', (e) => {
      overlayMode = e.target.value;
    });
  }
  
  const sidebarSelect = document.getElementById('sidebar-mode');
  if (sidebarSelect) {
    sidebarSelect.addEventListener('change', (e) => {
      sidebarMode = e.target.value;
      if (sidebarMode === 'none' && sidebarCtx) {
        sidebarCtx.clearRect(0, 0, sidebarCanvas.width, sidebarCanvas.height);
      }
    });
  }
  
  sidebarCanvas = document.getElementById('sidebar_hand_canvas');
  if (sidebarCanvas) {
    sidebarCtx = sidebarCanvas.getContext('2d');
  }
  
  if (!canvasElement || !video) {
    console.error("DOM elements missing. Ensure index.html contains #webcam and #output_canvas.");
    return;
  }
  
  canvasCtx = canvasElement.getContext('2d');

  // Fetch WASM files required for the inference engine
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );
  
  // Initialize the hand landmarker model
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1
  });
  
  // Initialize the face landmarker model
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU"
    },
    outputFaceBlendshapes: true,
    runningMode: "VIDEO",
    numFaces: 1
  });
  
  startWebcam();
};

const startWebcam = async () => {
  const constraints = { video: { width: 640, height: 480 } };
  
  // Start the video stream
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.addEventListener("loadeddata", () => {
      document.getElementById('video-container').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      predictWebcam();
    });
  } catch (err) {
    console.error("Error accessing media devices.", err);
  }
};

const predictWebcam = () => {
  canvasElement.width = video.videoWidth;
  canvasElement.height = video.videoHeight;

  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    
    const results = handLandmarker.detectForVideo(video, performance.now());
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    if (sidebarMode !== 'none' && sidebarCtx) {
      sidebarCanvas.width = video.videoWidth;
      sidebarCanvas.height = video.videoHeight;
      sidebarCtx.clearRect(0, 0, sidebarCanvas.width, sidebarCanvas.height);
    }
    
    if (results.landmarks && results.landmarks.length > 0) {
      const landmarks = results.landmarks[0];
      
      if (overlayMode === 'fingertips') {
        const fingertipIndices = [4, 8, 12, 16, 20];
        canvasCtx.fillStyle = '#bb86fc';
        for (const index of fingertipIndices) {
          const point = landmarks[index];
          const x = point.x * canvasElement.width;
          const y = point.y * canvasElement.height;
          
          canvasCtx.beginPath();
          canvasCtx.arc(x, y, 5, 0, 2 * Math.PI);
          canvasCtx.fill();
        }
      } else if (overlayMode === 'full') {
        canvasCtx.lineWidth = 4;
        canvasCtx.strokeStyle = '#bb86fc';
        for (const connection of HAND_CONNECTIONS) {
          const p1 = landmarks[connection[0]];
          const p2 = landmarks[connection[1]];
          
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

      if (sidebarMode !== 'none' && sidebarCtx) {
        let drawLandmarks = landmarks;
        let scaleX = sidebarCanvas.width;
        let scaleY = sidebarCanvas.height;

        if (sidebarMode === 'fixed' || sidebarMode === 'model') {
          let minX = 1, maxX = 0, minY = 1, maxY = 0;
          
          for (const point of landmarks) {
            if (point.x < minX) minX = point.x;
            if (point.x > maxX) maxX = point.x;
            if (point.y < minY) minY = point.y;
            if (point.y > maxY) maxY = point.y;
          }
          
          const rangeX = maxX - minX;
          const rangeY = maxY - minY;
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          
          // Use 0.6 padding to ensure it fits entirely, even with thick lines
          const scale = Math.min(1 / rangeX, 1 / rangeY) * 0.6;
          
          drawLandmarks = landmarks.map(point => ({
            x: (point.x - centerX) * scale + 0.5,
            y: (point.y - centerY) * scale + 0.5
          }));
        }

        if (sidebarMode === 'model') {
          // Draw Palm as a polygon
          sidebarCtx.fillStyle = '#ffb69b'; // Skin tone
          sidebarCtx.beginPath();
          sidebarCtx.moveTo(drawLandmarks[0].x * scaleX, drawLandmarks[0].y * scaleY);
          sidebarCtx.lineTo(drawLandmarks[1].x * scaleX, drawLandmarks[1].y * scaleY);
          sidebarCtx.lineTo(drawLandmarks[5].x * scaleX, drawLandmarks[5].y * scaleY);
          sidebarCtx.lineTo(drawLandmarks[9].x * scaleX, drawLandmarks[9].y * scaleY);
          sidebarCtx.lineTo(drawLandmarks[13].x * scaleX, drawLandmarks[13].y * scaleY);
          sidebarCtx.lineTo(drawLandmarks[17].x * scaleX, drawLandmarks[17].y * scaleY);
          sidebarCtx.closePath();
          sidebarCtx.fill();

          // Draw thick connections for fingers
          sidebarCtx.lineWidth = 15;
          sidebarCtx.lineCap = 'round';
          sidebarCtx.lineJoin = 'round';
          sidebarCtx.strokeStyle = '#ffb69b';
          
          for (const connection of HAND_CONNECTIONS) {
            const p1 = drawLandmarks[connection[0]];
            const p2 = drawLandmarks[connection[1]];
            
            sidebarCtx.beginPath();
            sidebarCtx.moveTo(p1.x * scaleX, p1.y * scaleY);
            sidebarCtx.lineTo(p2.x * scaleX, p2.y * scaleY);
            sidebarCtx.stroke();
          }
        } else {
          // Draw regular skeleton connections
          sidebarCtx.lineWidth = 4;
          sidebarCtx.strokeStyle = '#bb86fc';
          for (const connection of HAND_CONNECTIONS) {
            const p1 = drawLandmarks[connection[0]];
            const p2 = drawLandmarks[connection[1]];
            
            sidebarCtx.beginPath();
            sidebarCtx.moveTo(p1.x * scaleX, p1.y * scaleY);
            sidebarCtx.lineTo(p2.x * scaleX, p2.y * scaleY);
            sidebarCtx.stroke();
          }
          
          // Draw regular landmarks
          sidebarCtx.fillStyle = '#ffffff';
          for (const point of drawLandmarks) {
            sidebarCtx.beginPath();
            sidebarCtx.arc(point.x * scaleX, point.y * scaleY, 3, 0, 2 * Math.PI);
            sidebarCtx.fill();
          }
        }
      }
    }

    if (isFaceTrackingEnabled && faceLandmarker) {
      const faceResults = faceLandmarker.detectForVideo(video, performance.now());
      if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
        const landmarks = faceResults.faceLandmarks[0];
        
        let eyeBlinkLeftScore = 0;
        let eyeBlinkRightScore = 0;

        // Check blink blendshapes
        if (faceResults.faceBlendshapes && faceResults.faceBlendshapes.length > 0) {
          const blendshapes = faceResults.faceBlendshapes[0].categories;
          eyeBlinkLeftScore = blendshapes.find(shape => shape.categoryName === 'eyeBlinkLeft')?.score || 0;
          eyeBlinkRightScore = blendshapes.find(shape => shape.categoryName === 'eyeBlinkRight')?.score || 0;
        }

        // Swap the left and right blink scores because the video is mirrored
        const eyes = [
          { index: 468, isClosed: eyeBlinkRightScore > 0.4 }, // left iris center
          { index: 473, isClosed: eyeBlinkLeftScore > 0.4 }  // right iris center
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
      }
    }
  }
  
  requestAnimationFrame(predictWebcam);
};

// Start the app after the DOM is ready
document.addEventListener('DOMContentLoaded', initializeHandTracking);