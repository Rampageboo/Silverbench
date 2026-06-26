# Multimodal Controls

This branch adds a global input layer for hand gestures, whole-arm motion, pointing, pinch drawing, and spoken commands. Feature pages consume canonical workbench commands and do not depend directly on MediaPipe, camera APIs, speech APIs, or AprilTag detection.

## Architecture

```text
Camera / microphone
  ├─ MediaPipe Gesture Recognizer (hand shape + 21 hand landmarks)
  ├─ MediaPipe Pose Landmarker (shoulder + elbow + wrist motion)
  ├─ Browser Speech Recognition adapter
  └─ AprilTag detector (OpenCV backend)
          ↓
Hand / pose / voice interpreters
          ↓
Canonical CommandEnvelope
          ↓
CommandArbiter
  ├─ arm/disarm gate
  ├─ confidence threshold
  ├─ per-command cooldown
  └─ repeated confirmation for destructive commands
          ↓
MultimodalCommandBus
          ↓
Video Label command handler / calibrated annotation canvas
```

## Hand gesture mapping

| Gesture | Command |
|---|---|
| `ILoveYou` held | Unlock controls |
| `Closed_Fist` held | Lock controls |
| `Thumb_Up` held | Mark current timestamp reviewed |
| `Victory` held | Copy boxes from previous annotated timestamp |
| `Open_Palm` swipe left | Move backward one video step |
| `Open_Palm` swipe right | Move forward one video step |
| `Pointing_Up` | Move calibrated canvas cursor |
| Thumb/index pinch | Begin drawing a box |
| Release pinch | Commit the box |

## Whole-arm and forearm motion

Hand classification is not required for directional arm controls. The pose interpreter tracks the shoulder, elbow, and wrist of both arms. Its control point is a weighted combination of wrist and elbow, so a partially hidden or imprecise hand can still produce a usable motion signal.

| Arm motion | Command |
|---|---|
| Clear sweep left | Move backward one video step |
| Clear sweep right | Move forward one video step |
| Clear sweep up | Copy boxes from the previous annotated timestamp |
| Clear sweep down | Mark the current timestamp reviewed |

Motion is normalized by detected shoulder width and expressed relative to the torso center. This reduces false triggers when the person shifts position or the camera framing changes slightly. A dominant-axis check rejects diagonal or ambiguous strokes, and a global cooldown prevents one long movement from firing repeatedly.

Discrete hand gestures and directional arm sweeps do not require camera-plane calibration. Pointing and pinch drawing require calibration.

## Voice commands

The first adapter uses the browser speech-recognition API and reports `unsupported` when the current WebView does not expose it. Chinese and English commands are normalized into the same command contract.

Examples:

```text
工作台，下一帧
工作台，向后两秒
标注助手，复制上一帧的框
Yolo，标记为空帧
Workbench, select class 3
工作台，清除当前帧记录
```

Wake words are enabled by default. Push-to-talk mode can disable the wake-word requirement. A local whisper.cpp adapter can be added later without changing feature pages or the command arbiter.

## AprilTag calibration

The backend uses OpenCV's AprilTag 36h11 dictionary. The printable sheet places IDs clockwise:

```text
0 — top-left
1 — top-right
2 — bottom-right
3 — bottom-left
```

The inward-facing corner of each tag defines the interaction rectangle. A four-point homography maps the oblique camera view to normalized canvas coordinates.

The control dock provides:

- Printable calibration sheet endpoint.
- Automatic detection of IDs 0–3 from the live camera.
- Manual fallback by clicking top-left, top-right, bottom-right, and bottom-left.
- Mirrored-camera support.
- Persistent calibration matrix in local application storage.

A planar homography corrects perspective only for points near the calibrated plane. A hand substantially above or below that plane introduces parallax error; this is a physical limitation of a single uncalibrated-depth camera.

## Safety

Multimodal input starts locked. Commands are accepted only after unlock and then pass confidence and cooldown checks. `video.clearFrameRecord` is destructive and requires the same source to repeat the command within 3.5 seconds.

No destructive action is mapped to a canned gesture or arm sweep in the initial implementation.

## Runtime assets

The camera adapter currently loads the official MediaPipe web bundle, WASM runtime, Gesture Recognizer model, and Pose Landmarker Lite model over HTTPS. This keeps the first branch small, but it is not an offline release configuration. A packaged release should vendor and checksum these assets under the desktop bundle before being considered production-ready.

MediaPipe's browser inference methods are synchronous. This MVP alternates hand and pose inference at a throttled rate; a production pass should move both tasks into Web Workers and measure latency on the target Windows hardware.

## Relevant files

```text
apps/desktop/src/input/commands.ts
apps/desktop/src/input/commandArbiter.ts
apps/desktop/src/input/commandBus.ts
apps/desktop/src/input/voiceCommandParser.ts
apps/desktop/src/input/gestureInterpreter.ts
apps/desktop/src/input/poseMotionInterpreter.ts
apps/desktop/src/input/homography.ts
apps/desktop/src/input/useBrowserSpeechCommands.ts
apps/desktop/src/input/useMediaPipeGestureCommands.ts
apps/desktop/src/input/MultimodalControlProvider.tsx
apps/desktop/src/input/MultimodalControlDock.tsx
backend/multimodal_calibration.py
backend_api/multimodal_main.py
```
