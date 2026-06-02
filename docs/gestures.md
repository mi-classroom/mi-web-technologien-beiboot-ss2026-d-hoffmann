# Gesture Vocabulary

This document maps user interaction intents to concrete hand gestures, evaluates the reliability of available sensor data, and records which gestures were selected for implementation in Assignment 2.

The application context is an IPTC metadata management tool for images. Interactions cover navigation (next/previous image), zoom, and session control (start/stop gesture mode).

---

## Landmark reference

MediaPipe provides 21 points per hand. The ones used in this document:

| Name | ID | Position on hand |
|---|---|---|
| Wrist | 0 | Base of the hand |
| Index MCP | 5 | Base knuckle of index finger |
| Middle MCP | 9 | Base knuckle of middle finger |
| Ring MCP | 13 | Base knuckle of ring finger |
| Pinky MCP | 17 | Base knuckle of pinky |
| Thumb tip | 4 | Tip of thumb |
| Index tip | 8 | Tip of index finger |
| Middle tip | 12 | Tip of middle finger |
| Ring tip | 16 | Tip of ring finger |
| Pinky tip | 20 | Tip of pinky |
| Index middle knuckle | 6 | Middle joint of index finger |
| Middle middle knuckle | 10 | Middle joint of middle finger |
| Ring middle knuckle | 14 | Middle joint of ring finger |
| Pinky middle knuckle | 18 | Middle joint of pinky |

> **Y-axis note:** In normalised coordinates y = 0 is the top of the frame, y = 1 is the bottom. A fingertip *above* a knuckle means `tip.y < knuckle.y`.

---

## Mapping Table

| Interaction | Gesture | Needed data |
|---|---|---|
| **Activate gesture control** ✅ | Open flat hand — all fingers fully extended, palm toward camera | All four fingertips (8, 12, 16, 20) are above their middle knuckles (6, 10, 14, 18) |
| **Deactivate gesture control** ✅ | Closed fist — all fingers fully curled | All four fingertips (8, 12, 16, 20) are below their base knuckles (5, 9, 13, 17) |
| **Navigate forward** | Swipe right — hand moves left to right across the frame | Position of middle base knuckle (9) tracked over ~15 frames; rightward velocity above threshold |
| **Navigate back** | Swipe left — hand moves right to left across the frame | Same as swipe right, opposite direction |
| **Zoom in** | Pinch open — thumb and index finger spread apart | Euclidean distance between thumb tip (4) and index tip (8) increasing over time |
| **Zoom out** | Pinch close — thumb and index finger come together | Same distance decreasing over time |
| **Confirm / Select** | Thumbs up — thumb points upward, all other fingers curled | Thumb tip (4) is above wrist (0); fingertips 8, 12, 16, 20 are below their base knuckles |
| **Pause / Freeze** | Index finger up — only index finger extended, rest curled | Index tip (8) above its middle knuckle (6); all other fingertips below their base knuckles |
| **Scroll up** | Swipe up — whole hand moves upward | Y-position of middle base knuckle (9) decreasing over ~15 frames above a velocity threshold |
| **Scroll down** | Swipe down — whole hand moves downward | Y-position of middle base knuckle (9) increasing over ~15 frames above a velocity threshold |

---
