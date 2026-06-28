# Feature Access Audit

**Last updated:** 2026-06-27  
**Branch:** feature/timestamp-first-detect-clf-architecture  
**Audited by:** conversation-driven review

Statuses: `exposed` | `hidden` | `partial` | `broken` | `duplicated` | `not implemented` | `not verified`

A feature is **exposed** only if a normal user can discover and use it from the UI without reading source code.

---

## Video

| Feature | Implementation files | UI entry point | User action | Persistence | Tests | Status | Problem | Fix in this PR | Risk |
|---|---|---|---|---|---|---|---|---|---|
| Add video | `videoCaptureApi.ts`, `useVideoAnnotationSession.ts` | Video Label sidebar / Video Segments sidebar | Click "Add Video" | None (in-memory list; video manifest per workspace) | No | exposed | — | — | Low |
| Direct timestamp annotation | `VideoAnnotationCanvas.tsx`, `useVideoAnnotationSession.ts`, `videoAnnotationApi.ts` | Video Label | Draw box on frame preview | `workspace/video_annotations/*.json` | No | exposed | — | — | Low |
| Random Next | `useVideoSampling.ts`, `videoSamplingDomain.ts` | Video Label → Random Sampling panel | Click "Random Next" | None (in-memory state) | Yes (domain) | exposed | — | — | Low |
| Sampling mode (whole-video / segments-preferred / segments-only) | `useVideoSampling.ts` | Video Label → Sampling mode select | Drop-down | None | Yes (domain) | exposed | — | — | Low |
| Minimum spacing | `useVideoSampling.ts` | Video Label → Min spacing input | Number input | None | Yes (domain) | exposed | — | — | Low |
| Timestamp source indicator | `VideoLabelPage.tsx` | Video Label → Source: label | Auto-updated by Random Next | None | No | exposed | — | — | Low |
| Segment count indicator | `useVideoSampling.ts` | Video Label → Random Sampling header | Auto | None | No | exposed | — | — | Low |
| Video segment editor | `VideoCapturePage.tsx`, `useVideoSegments.ts`, `videoSegmentApi.ts` | Video Segments tab | Click "Video Segments" in nav, add segments | `video_segments/<name>-<hash>.json` | Yes (domain) | exposed | — | — | Low |
| Segment enabled/disabled | `VideoCapturePage.tsx` | Video Segments → checkbox in segment row | Toggle checkbox | Persisted with segment manifest | No | exposed | — | — | Low |
| Segment label/name | `VideoCapturePage.tsx` | Video Segments → label input in segment row | Text input | Persisted | No | exposed | — | — | Low |
| Segment manifest | `videoSegmentDomain.ts`, `videoSegmentApi.ts` | Implicit (auto-loaded in Video Label) | Background | `video_segments/*.json` | Yes | exposed | — | — | Low |
| Workspace manifest path `video_segments` | `workspaceManifest.ts` | Settings → Workspace Architecture | Read-only display | `workspace/workspace.json` | Yes | exposed | Fixed: was showing `video_annotations` only | Added `video_segments` to settings display | Low |
| Reviewed/annotated counts | `VideoLabelPage.tsx` | Video Label → Current Frame panel stats | Auto | Annotation manifest | No | exposed | — | — | Low |
| Copy Previous Boxes | `useVideoAnnotationSession.ts` | Video Label → Current Frame | Button | Annotation manifest | No | exposed | — | — | Low |
| Mark Empty / Reviewed | `useVideoAnnotationSession.ts` | Video Label → Current Frame | Button | Annotation manifest | No | exposed | — | — | Low |
| Clear Frame Record | `useVideoAnnotationSession.ts` | Video Label → Current Frame | Button | Annotation manifest | No | exposed | — | — | Low |
| Explicit frame export | `VideoCapturePage.tsx`, `videoCaptureApi.ts` | Video Segments → Export Frames tab | Tab switch + Export | `image_pool` or custom folder | No | exposed | — | — | Low |
| Video annotation manifest | `videoAnnotationApi.ts`, `videoAnnotationDomain.ts` | Implicit | Auto-saved on annotation | `workspace/video_annotations/*.json` | No | exposed | — | — | Low |
| Workspace manifest paths (video_annotations) | `workspaceManifest.ts` | Settings | Read-only | `workspace/workspace.json` | Yes | exposed | — | — | Low |
| Preview frame no image_pool write | `useVideoAnnotationSession.ts` | Info hint in Video Label | UI hint text | Never written | No | exposed | — | — | Low |
| Video metadata display | `VideoLabelPage.tsx` | Video Label header | Auto | — | No | exposed | — | — | Low |
| Previous/Next Reviewed navigation | `VideoLabelPage.tsx`, `useVideoAnnotationSession.ts` | Video Label | Buttons | — | No | exposed | — | — | Low |
| Video list (multi-video) | `VideoLabelPage.tsx` | Video Label → Videos panel | Click video name | — | No | exposed | — | — | Low |
| Remove video | `VideoLabelPage.tsx` | Video Label → Remove button | Click | — | No | exposed | — | — | Low |

---

## Box Label

| Feature | Implementation files | UI entry point | User action | Persistence | Tests | Status | Problem | Fix in this PR | Risk |
|---|---|---|---|---|---|---|---|---|---|
| Shortcut class binding | `geometry.ts`, `useBoxLabelClasses.ts`, `BoxLabelView.tsx` | Box Label → Shortcuts panel | Drop-down per slot | `localStorage` + session JSON | Yes | exposed | — | — | Low |
| Shortcut mode binding (draw / subject-select) | `session.ts`, `useBoxLabelClasses.ts`, `BoxLabelView.tsx` | Box Label → D/SS toggle per slot | Toggle button | `localStorage` + session JSON | Yes | exposed | — | — | Low |
| Migration from old numeric shortcuts | `session.ts`, `geometry.ts` | Transparent (on load) | — | — | Yes | exposed | — | — | Low |
| Local fallback storage | `geometry.ts` | Transparent | — | `localStorage` | No | exposed | — | — | Low |
| Workspace session storage | `session.ts`, `useBoxLabel.ts` | Transparent | — | `workspace/pool_label_session.json` | Yes | exposed | — | — | Low |
| Single-click class safety | `useBoxLabelClasses.ts` | Box Label → class list | Single click | Never relabels selected box | Yes (description) | exposed | — | — | Low |
| Double-click class relabel | `useBoxLabelClasses.ts`, `BoxLabelView.tsx` | Box Label → class list | Double click | Labels file | No | exposed | — | — | Low |
| Keyboard shortcut no-relabel | `useBoxLabelClasses.ts` | Keyboard (0-9) | Key press | — | No | exposed | — | — | Low |
| Mark Junk immediate removal | `useBoxLabelGallery.ts`, `BoxLabelGallery.tsx` | Box Label gallery | Right-click or key | Metadata | No | exposed | — | — | Low |
| Undo Junk | `useBoxLabelGallery.ts` | Box Label gallery | Undo button | Metadata | No | exposed | — | — | Low |
| Grid FLIP compaction animation | `BoxLabelGallery.tsx` | Box Label gallery | After junk | — | No | exposed | — | — | Low |
| Mouse click no auto-center | `BoxLabelGallery.tsx` | Box Label gallery | Click thumbnail | — | No | exposed | — | — | Low |
| A/D keyboard reveal active item | `BoxLabelGallery.tsx` | Box Label gallery | A/D key | — | No | exposed | — | — | Low |
| Reviewed/flagged states | `useBoxLabelInteraction.ts` | Box Label | R key / flag button | Labels + metadata | No | exposed | — | — | Low |
| Class filter include/exclude | `useBoxLabelClasses.ts` | Box Label → class list | Right-click | — | No | exposed | — | — | Low |
| Fixed box shortcuts (alt slots) | `session.ts`, `useBoxLabelClasses.ts`, `BoxLabelView.tsx` | Box Label → Alt shortcut drop-downs | Drop-down | Session JSON | No | exposed | — | — | Low |
| Subject-select mode | `useBoxLabelClasses.ts` | Box Label → SS mode slot | Toggle | Session JSON | No | exposed | — | — | Low |
| Auto-fit / black-box tool | `useBoxLabelClasses.ts` | Box Label preview toolbar | Toolbar buttons | Session | No | exposed | — | — | Low |
| Copy selected box to next frame | `useBoxTracking.ts` | Box Label toolbar | "Copy Next" button | Labels file | No | exposed | — | — | Low |
| CSRT tracking | `useBoxTracking.ts` | Box Label toolbar | "Track" button | Labels file | No | exposed | — | — | Low |
| Box undo | `useBoxUndo.ts` | Box Label | Ctrl+Z | — | No | exposed | — | — | Low |

---

## Multimodal

| Feature | Implementation files | UI entry point | User action | Persistence | Tests | Status | Problem | Fix in this PR | Risk |
|---|---|---|---|---|---|---|---|---|---|
| Command bus | `commandBus.ts`, `commands.ts` | Transparent | — | — | No | exposed | — | — | Low |
| Lock / unlock controls | `commandArbiter.ts`, `MultimodalControlDock.tsx` | Multimodal dock (bottom-left) | Lock/Unlock button | — | Yes | exposed | — | — | Low |
| Enable voice | `useBrowserSpeechCommands.ts`, `MultimodalControlDock.tsx` | Multimodal dock | Voice checkbox | — | Yes | exposed | — | — | Low |
| Enable gesture/arm | `useMediaPipeGestureCommands.ts`, `MultimodalControlDock.tsx` | Multimodal dock | Gesture checkbox | — | No | exposed | — | — | Low |
| Require wake word | `voiceCommandParser.ts`, `MultimodalControlDock.tsx` | Multimodal dock | Wake word checkbox | — | Yes | exposed | — | — | Low |
| Mirror camera | `MultimodalControlDock.tsx`, `MultimodalControlProvider.tsx` | Multimodal dock | Mirror checkbox | — | No | exposed | — | — | Low |
| Camera status | `MultimodalControlDock.tsx` | Multimodal dock header | Auto-updated | — | No | exposed | — | — | Low |
| Last transcript | `MultimodalControlDock.tsx` | Multimodal dock → status area | Auto | — | No | exposed | — | — | Low |
| Last gesture | `MultimodalControlDock.tsx` | Multimodal dock → status area | Auto | — | No | exposed | — | — | Low |
| Last arm motion | `MultimodalControlDock.tsx` | Multimodal dock → status area | Auto | — | No | exposed | — | — | Low |
| Last command decision | `MultimodalControlDock.tsx` | Multimodal dock → status area | Auto | — | No | exposed | — | — | Low |
| AprilTag auto calibration | `apriltagCalibrationApi.ts`, `MultimodalControlDock.tsx` | Multimodal dock → "AprilTag 自动校准" | Button (camera must be running) | `localStorage` (homography) | Yes (homography) | exposed | — | — | Low |
| Manual calibration (4-corner) | `homography.ts`, `MultimodalControlDock.tsx` | Multimodal dock → "四角手动校准" | Click 4 corners on video feed | `localStorage` | Yes | exposed | — | — | Low |
| Printable calibration sheet | `apriltagCalibrationApi.ts`, `MultimodalControlDock.tsx` | Multimodal dock → "打开打印标定板" | Button opens new tab | None | No | exposed | — | — | Low |
| Clear calibration | `MultimodalControlDock.tsx` | Multimodal dock | "清除校准" button | Clears localStorage | No | exposed | — | — | Low |
| Calibration status indicator | `MultimodalControlDock.tsx` | Multimodal dock | Auto | — | No | exposed | — | — | Low |
| Calibration requirement explanation | `MultimodalControlDock.tsx` | Multimodal dock → AprilTag details | details/summary | — | No | exposed | Explanation is in Chinese; only pointing/pinch requires calibration is documented | — | Low |
| Arm sweep gestures | `poseMotionInterpreter.ts`, `MultimodalControlDock.tsx` | Multimodal dock | Enable gesture | — | Yes | exposed | — | — | Low |
| Hand gestures (palm, pinch, etc.) | `gestureInterpreter.ts` | Multimodal dock | Enable gesture | — | Yes | exposed | — | — | Low |
| Command arbiter (confidence, cooldown) | `commandArbiter.ts` | Transparent (decision shown in dock) | — | — | Yes | exposed | — | — | Low |
| Pointing/pinch drawing | `MultimodalControlProvider.tsx` | Requires calibration | After calibration | — | No | partial | Only works after AprilTag/manual calibration; no visible prompt when uncalibrated | — | Medium |

---

## Workspace / Architecture

| Feature | Implementation files | UI entry point | User action | Persistence | Tests | Status | Problem | Fix in this PR | Risk |
|---|---|---|---|---|---|---|---|---|---|
| Tool registry | `types/tools.ts`, `app/toolRegistry.tsx` | All tools available from nav | Nav click | — | No | exposed | — | — | Low |
| Navigation order | `types/tools.ts` | ToolNav | Hover over nav rail | — | No | exposed | Order: Video Label → Video Segments → Image Box Label → Image Pool → Dataset Prep → Auto Label → Batch Crop → Mask Cleanup → Dataset Merge | — | Low |
| Settings modal | `SettingsModal.tsx` | Settings gear (bottom of nav) | Click | — | No | exposed | — | Added video_segments path | Low |
| Workspace manifest migration | `workspaceManifest.ts` | Transparent (auto on open) | — | `workspace/workspace.json` | Yes | exposed | — | — | Low |
| Workspace root display | `SettingsModal.tsx` | Settings → Workspace Architecture | Read-only | — | No | exposed | — | — | Low |
| Manifest version display | `SettingsModal.tsx` | Settings → header | Read-only | — | No | exposed | — | — | Low |
| video_annotations path | `SettingsModal.tsx` | Settings | Read-only | — | No | exposed | — | — | Low |
| video_segments path | `SettingsModal.tsx` | Settings | Read-only | — | No | **broken→exposed** | Was not displayed | Fixed | Low |
| logs path | `SettingsModal.tsx` | Settings | Read-only | — | No | exposed | — | — | Low |
| cache path | `SettingsModal.tsx` | Settings | Read-only | — | No | exposed | — | — | Low |
| App mode (video-first) | `SettingsModal.tsx` | Settings | Read-only | — | No | **partial→exposed** | Was not labelled | Added "App mode: video-first" label | Low |
| Session JSON persistence | `session.ts`, `useBoxLabel.ts` | Transparent | — | `workspace/pool_label_session.json` | Yes | exposed | — | — | Low |
| Workspace audit log | `workbench/auditLog.ts` | Transparent | — | `workspace/logs/*.log` | No | hidden | Exists but no UI exposes the log | — | Low |
| Error visibility | Various | Toast notifications, error banners | Auto | — | No | partial | Most errors surface via toast, but some only in console | — | Medium |
| CI test coverage | `*.test.ts` files | `npm test` | — | — | Yes | partial | 216 tests; no e2e/integration | — | Low |
| Backend routing (multimodal/status) | `backend_api/main.py` | Transparent | — | — | No | **broken→fixed** | StaticFiles mount at "/" intercepted `/api/multimodal/status` before route handler | Fixed: mount moved to startup hook | Low |
| ToolNav icon for Video Segments | `ToolNav.tsx` | ToolNav | Hover | — | No | **broken→fixed** | Fell back to image-pool grid icon | Added video-segments icon | Low |

---

## Exact wording

> Segments are metadata time ranges. They do not create screenshots. Decoded frames are preview-only. Exporting screenshots or sampled frames is an explicit export action.

This appears in:
- `VideoLabelPage.tsx` — info hint at bottom of page
- `VideoCapturePage.tsx` — hint in Segments panel
- `docs/video-first-architecture.md` — product rules section

---

## Manual Regression Checklist

### Video

1. Open workspace.
2. Open Video Label.
3. Click "Add Video" and load a video file.
4. Click "Random Next" — verify time changes, no files appear in `image_pool`.
5. Draw boxes on the frame. Verify "Saved" status appears.
6. Open Video Segments. Add a segment. Save.
7. Return to Video Label. Change Sampling mode to "Segments only". Click "Random Next" — verify it lands inside the defined segment.
8. Reload app. Verify segments and annotations reload from manifest.
9. In Video Segments, switch to "Export Frames". Export one frame. Verify file appears in chosen output folder (not image_pool unless chosen).

### Box Label

1. Open Image Box Label.
2. Assign a class to shortcut slot 1. Toggle mode to "SS".
3. Reload workspace. Verify shortcut slot 1 still shows the class and SS mode.
4. Select a box. Single-click a different class. Verify box class does NOT change; status shows hint.
5. Double-click a class. Verify box IS relabeled.
6. Press shortcut key 1 while a box is selected. Verify box class does NOT change.
7. Mark current image as junk. Verify it disappears immediately and grid compacts.
8. Click Undo junk. Verify image is restored.
9. Click a gallery thumbnail with the mouse. Verify gallery does NOT scroll to center it.
10. Press A or D. Verify gallery scrolls to reveal the active item.

### Multimodal

1. Click the multimodal dock (bottom-left corner).
2. Enable "Gesture & Arm". Verify camera feed appears.
3. Click "Unlock controls".
4. Make a left-arm sweep. Verify "video.seekBy" command appears in decision area.
5. Click "打开打印标定板" — verify calibration sheet opens.
6. Click "AprilTag 自动校准" with calibration sheet visible. Verify detection succeeds or shows which IDs are missing.
7. Enable "Voice". Verify browser speech API status appears.

---

## Known Remaining Risks

- **No e2e tests** — all tests are unit/domain-level. Feature workflows verified by manual checklist only.
- **Pointing/pinch calibration messaging** — when uncalibrated, pointer commands silently fail. A visible "calibration required" prompt is missing.
- **Audit log not exposed** — `workbench/auditLog.ts` writes structured logs but no UI reads or displays them.
- **Video sampling state not persisted** — sampling mode and min spacing reset on page reload. Session persistence for these is not implemented.
- **Backend startup delay** — `isCurrentBackend()` requires `/api/multimodal/status` to return `{ok: true, calibration: "apriltag-opencv"}`. If the multimodal backend fails, dev-shell kills and restarts the backend, causing the startup splash overlay to show for 90 seconds before timeout. **Fixed in a prior PR** by moving the `StaticFiles` mount to the startup event handler.
- **No clf task layer in Video Label** — `VideoFrameAnnotation` (v1 format) stores only detect boxes. The v2 task-layer model (`videoAnnotationTaskDomain.ts`) and types are defined in this branch, but the Video Label session hook (`useVideoAnnotationSession.ts`) still reads v1 format. Full UI wiring of clf task is a follow-up task.
- **No export UI** — `exportPlanner.ts` defines the export plan types and pure planning functions, but no export button or workflow exists yet in the UI.
- **No sources.json** — `sourceDomain.ts` defines the Source model, but actual persistence of sources to `workspace/sources.json` is not implemented. Videos are still held as in-memory session state.

---

## Timestamp-first detect+clf architecture audit

This section audits every action that could write persistent image files during the normal annotation workflow. The principle is:

> **Video samples are timestamp annotations, not saved screenshots. Frames are decoded only for preview and export.**

| Feature | Does it write image files? | Should it write image files? | Current behavior | Required fix | Status |
|---|---|---|---|---|---|
| Random Next | **No** | No | Calls `sampleTimestamp()` → sets `session.gotoTime()` → triggers debounced `getAnnotationFrameBase64()` which returns base64 in memory only | — | ✓ Correct |
| Video preview decode | **No** | No | `getAnnotationFrameBase64(videoPath, seconds, "jpg")` is Tauri invoke that decodes frame to base64 string in memory; never written to workspace | — | ✓ Correct |
| Segment creation | **No** | No | `saveVideoSegmentManifest()` writes only `video_segments/<name>-<hash>.json` metadata | — | ✓ Correct |
| Segment editing | **No** | No | Same as segment creation | — | ✓ Correct |
| Marking reviewed | **No** | No | `updateCurrentFrame()` → `updateVideoFrameAnnotation()` → `saveVideoAnnotationManifest()` writes only annotation JSON | — | ✓ Correct |
| Adding detect boxes | **No** | No | `updateCurrentFrame()` → annotation manifest JSON only | — | ✓ Correct |
| Adding clf class | **Not yet implemented** | No | No clf UI exists; v1 manifest stores only detect boxes | Add clf task layer UI; never write image file | ⚠ Not implemented |
| Copying previous boxes | **No** | No | Reads from manifest in memory, calls `updateCurrentFrame()` | — | ✓ Correct |
| Video annotation save | **No** | No | `saveVideoAnnotationManifest()` writes JSON only | — | ✓ Correct |
| Box Label video-derived frames | **N/A** | N/A | Box Label operates on `image_pool` (manually imported images), not video timestamps | — | N/A |
| Explicit frame export (Video Segments tab) | **Yes** | Yes | User explicitly clicks Export Frames → writes to user-chosen folder | — | ✓ Correct (explicit action) |
| YOLO detect export (planned) | **Yes, at export time** | Yes | `exportPlanner.ts` defines plan; execution would decode frame from video and write to `exports/detect_dataset/` | Implement export executor | Planned |
| YOLO clf export (planned) | **Yes, at export time** | Yes | Same as detect export but writes to `exports/clf_dataset/<class>/` | Implement export executor | Planned |

### Conclusion

No path in the current normal annotation workflow writes persistent image files. The architecture is correctly timestamp-first. The gaps are:

1. **clf task layer** — type model defined (`videoAnnotationTaskDomain.ts`), UI not wired.
2. **Export UI** — planner defined (`exportPlanner.ts`), executor not implemented.
3. **sources.json** — domain model defined (`sourceDomain.ts`), persistence not implemented.
