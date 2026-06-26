# Multimodal Controls

This branch adds a global input layer for gesture, pointing, pinch drawing, and spoken commands. Feature pages consume canonical workbench commands and do not depend directly on MediaPipe, camera APIs, speech APIs, or AprilTag detection.

## Architecture

```text
Camera / microphone
  ├─ MediaPipe Gesture Recognizer adapter
  ├─ Browser Speech Recognition adapter
  └─ AprilTag detector (OpenCV backend)
          ↓
Gesture / voice interpreters
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

## Gesture mapping

| Gesture | Command |
|---|---|
| `ILoveYou` held | Unlock controls |
| `Closed_Fist` held | Lock controls |
| `Thumb_Up` held | Mark current timestamp reviewed |
| `Victory` held | Copy boxes from previous annotated timestamp |
| `Open_Palm` swipe left | Move forward one video step |
| `Open_Palm` swipe right | Move backward one video step |
| `Pointing_Up` | Move calibrated canvas cursor |
| Thumb/index pinch | Begin drawing a box |
| Release pinch | Commit the box |

Discrete gestures do not require camera calibration. Pointing and pinch drawing require a plane calibration.

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

No destructive action is mapped to a canned gesture in the initial implementation.

## Runtime assets

The gesture adapter currently loads the official MediaPipe web bundle, WASM runtime, and gesture model over HTTPS. This keeps the first branch small, but it is not an offline release configuration. A packaged release should vendor and checksum these assets under the desktop bundle before being considered production-ready.

## Relevant files

```text
apps/desktop/src/input/commands.ts
apps/desktop/src/input/commandArbiter.ts
apps/desktop/src/input/commandBus.ts
apps/desktop/src/input/voiceCommandParser.ts
apps/desktop/src/input/gestureInterpreter.ts
apps/desktop/src/input/homography.ts
apps/desktop/src/input/useBrowserSpeechCommands.ts
apps/desktop/src/input/useMediaPipeGestureCommands.ts
apps/desktop/src/input/MultimodalControlProvider.tsx
apps/desktop/src/input/MultimodalControlDock.tsx
backend/multimodal_calibration.py
backend_api/multimodal_main.py
```
