# Graph Report - D:\MyProjects\YoloWorkBench  (2026-08-04)

## Corpus Check
- Large corpus: 470 files · ~541,343 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 3546 nodes · 9198 edges · 153 communities (137 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 96 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Backend
- Backend
- Backend
- Desktop App
- Desktop Features
- Backend
- Desktop Features
- Desktop Features
- Backend
- Desktop App
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Backend
- Desktop Components
- Backend
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop App
- Desktop Features
- Desktop Features
- Backend
- Backend
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Backend
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Backend
- Desktop App
- Backend
- Desktop Features
- Desktop Features
- Desktop App
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Backend
- Desktop Features
- Desktop Features
- Tests
- Desktop Features
- Desktop Features
- Backend
- Backend
- Apps
- Desktop Features
- Apps
- Backend
- Desktop Features
- Desktop App
- Desktop App
- Desktop App
- Tests
- Yoloworkbench
- Apps
- Desktop Features
- Desktop Features
- Desktop App
- Desktop App
- Backend
- Backend
- Desktop Features
- Desktop Features
- Desktop App
- Desktop App
- Desktop Features
- Desktop Features
- Apps
- Desktop Features
- Desktop Features
- Tests
- Desktop App
- Backend
- Backend
- Tests
- Apps
- Desktop Features
- Desktop App
- Desktop App
- Desktop Features
- Desktop Features
- Desktop App
- Backend
- Tests
- Desktop Components
- Desktop App
- Desktop App
- Desktop App
- Apps
- Desktop App
- Desktop App
- Yoloworkbench
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop App
- Backend
- Desktop Features
- Desktop App
- Desktop App
- Tests
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop Features
- Desktop App
- Desktop App
- Desktop App
- Scripts
- Backend
- Yoloworkbench
- Tests
- Desktop App
- Desktop App
- Tests
- Desktop App
- Tests
- Desktop App
- Desktop App
- Apps
- Desktop Features
- Desktop App
- Desktop App
- Apps
- Apps
- Apps
- Apps
- Apps
- Apps
- Backend
- Playwright

## God Nodes (most connected - your core abstractions)
1. `BackendService` - 157 edges
2. `callJson()` - 75 edges
3. `useVideoAnnotationSession()` - 53 edges
4. `create_workspace()` - 47 edges
5. `load_workspace_config()` - 44 edges
6. `useWorkspace()` - 38 edges
7. `PathAccess` - 36 edges
8. `useBoxLabel()` - 35 edges
9. `useDatasetReview()` - 35 edges
10. `writeTextFile()` - 34 edges

## Surprising Connections (you probably didn't know these)
- `DesktopBackendService` --uses--> `PathAccess`  [INFERRED]
  backend_api/dialogs.py → backend/path_access.py
- `DesktopBackendService` --uses--> `BackendService`  [INFERRED]
  backend_api/dialogs.py → backend/service.py
- `AppSettingsTests` --uses--> `BackendService`  [INFERRED]
  tests/test_app_settings.py → backend/service.py
- `AutoLabelModelImportTests` --uses--> `BackendService`  [INFERRED]
  tests/test_auto_label_model_import.py → backend/service.py
- `ListDatasetFilesTests` --uses--> `BackendService`  [INFERRED]
  tests/test_list_dataset_files.py → backend/service.py

## Import Cycles
- None detected.

## Communities (153 total, 16 thin omitted)

### Community 0 - "Backend"
Cohesion: 0.06
Nodes (89): api_call(), ApiCallRequest, app_settings(), app_settings_write(), _args_for_backend_call(), _boxes_to_yolo_text(), _data_yaml_text(), _ensure_workspace_child() (+81 more)

### Community 1 - "Backend"
Cohesion: 0.06
Nodes (78): _cleanup_empty_parents(), create_class_folder(), _default_class_dir(), move_images_to_class(), move_val_back_to_train(), Any, Path, _safe_child_path() (+70 more)

### Community 3 - "Desktop App"
Cohesion: 0.05
Nodes (68): ApiCallResponse, apiErrorMessage(), assertOk(), BackendHealth, BuildJobState, call(), callJson(), cancelPtJob() (+60 more)

### Community 4 - "Desktop Features"
Cohesion: 0.07
Nodes (58): API_BASE_URL, JobStatusPanel(), JobStatusPanelProps, dispatchWorkspaceMediaChanged(), isSameWorkspaceRoot(), isWorkspaceMediaChangedEvent(), WORKSPACE_MEDIA_CHANGED_EVENT, WorkspaceMediaChangedDetail (+50 more)

### Community 5 - "Backend"
Cohesion: 0.08
Nodes (55): _allows_flat_pool_backup_fallback(), _basename(), ensure_image_pool_backup(), ensure_image_pool_label_backup(), generic_backup_file(), generic_label_backup_file(), image_pool_backup_dir(), image_pool_backup_file() (+47 more)

### Community 6 - "Desktop Features"
Cohesion: 0.09
Nodes (50): callBackend(), writeWorkspaceSession(), classMapToLabelClasses(), defaultLabelPath(), detectLabelPathForMediaFilename(), entryBasename(), loadDatasetClassNames(), loadDetectDatasetClassIndex() (+42 more)

### Community 7 - "Desktop Features"
Cohesion: 0.08
Nodes (56): ActNode, BranchNode, ButtonElement, ClickIntent, collectElement(), collectRefUses(), ContainerElement, DetBox (+48 more)

### Community 8 - "Backend"
Cohesion: 0.10
Nodes (43): compact_inbox_session_for_storage(), default_inbox_session(), _default_media_dir_for_workspace(), ensure_workspace_v2_structure(), find_parent_workspace(), _has_workspace_data_dir(), infer_dataset_task(), init_stats_payload() (+35 more)

### Community 9 - "Desktop App"
Cohesion: 0.08
Nodes (39): appSettings, writeAppSettings(), App(), StartupPhase, APP_THEME_OPTIONS, applyAppTheme(), AppTheme, normalizeAppTheme() (+31 more)

### Community 10 - "Desktop Features"
Cohesion: 0.10
Nodes (45): loadLabelClasses(), saveLabelClasses(), WorkspaceClassesView(), emptyManifest(), readManifestForMutation(), uniqueCleanNames(), useWorkspaceClasses(), UseWorkspaceClassesResult (+37 more)

### Community 11 - "Desktop Features"
Cohesion: 0.08
Nodes (41): ClassDef, ClassesManifest, classesManifestFromLegacyClasses(), classIdToKey(), classKeyToClfFolder(), classKeyToDetectId(), createDefaultClassesManifest(), normalizeClassesManifest() (+33 more)

### Community 12 - "Desktop Features"
Cohesion: 0.13
Nodes (45): LabelBox, defaultClasses(), filterVideoJunk(), mergeVideoSources(), SaveState, useVideoAnnotationSession(), VIDEO_PREVIEW_DEBOUNCE_MS, timestampKey() (+37 more)

### Community 13 - "Desktop Features"
Cohesion: 0.09
Nodes (35): GoldenCase, GoldenCheckpoint, GoldenSuite, maps, suite, evaluateConditionSnapshot(), ActionRequest, ActionResultEvent (+27 more)

### Community 14 - "Desktop Features"
Cohesion: 0.09
Nodes (44): Condition, ElementRef, AbortEvent, ArgumentValue, ChannelMissing, ChannelOk, ClickIntentV2, evidenceTransition() (+36 more)

### Community 15 - "Desktop Features"
Cohesion: 0.10
Nodes (40): listDatasetFiles(), chooseMergeDirectory(), MergeTask, moveMergeValBackToTrain(), openMergeFolder(), collectBackendSourceFiles(), copySourceFileToBackend(), CopyTask (+32 more)

### Community 16 - "Desktop Features"
Cohesion: 0.09
Nodes (35): WorkspaceContext, WorkspaceContextValue, AddClassRowProps, ClfClassRowProps, DetectClassRowProps, LibraryPage(), LibraryView, Props (+27 more)

### Community 17 - "Desktop Features"
Cohesion: 0.09
Nodes (43): END_OUTCOMES, FlowGraphPanel(), FlowGraphPanelProps, newNode(), NODE_KINDS, OUTCOMES_BY_KIND, bindByAssociate(), Box (+35 more)

### Community 18 - "Backend"
Cohesion: 0.12
Nodes (34): _add_class_name(), _bool_to_csv(), _csv_to_bool(), _csv_to_bool_default(), _estimate_build_total(), get_workspace_classes(), list_clf_dataset_classes(), list_detect_dataset_classes() (+26 more)

### Community 19 - "Desktop Components"
Cohesion: 0.08
Nodes (25): scanImagePool(), WorkbenchToolDefinition, WorkbenchBodyProps, FeatureErrorBoundary, FeatureErrorBoundaryProps, FeatureErrorBoundaryState, ImageWorkspaceTopbar(), ImageWorkspaceTopbarProps (+17 more)

### Community 20 - "Backend"
Cohesion: 0.10
Nodes (32): apriltag_detect(), apriltag_sheet(), AprilTagDetectRequest, multimodal_status(), BaseModel, get, post, StreamingResponse (+24 more)

### Community 21 - "Desktop Features"
Cohesion: 0.10
Nodes (30): imagePoolThumbUrl(), animateCompaction(), BOX_LABEL_GRID_PARAMS, BoxLabelGallery(), BoxLabelGalleryProps, LazyThumb(), readThumbRects(), GalleryNavigationKey (+22 more)

### Community 22 - "Desktop Features"
Cohesion: 0.12
Nodes (33): readTextFile(), loadShortcutSlots(), migrateLocalShortcutEntry(), saveShortcutSlots(), shortcutStorageKey(), detectClassesFromManifest(), loadWorkspaceDetectClasses(), saveWorkspaceDetectManifest() (+25 more)

### Community 23 - "Desktop Features"
Cohesion: 0.13
Nodes (33): ImagePoolItem, upsertMetadataRows(), chooseRandomUnusedSample(), detectClassChipLabel(), filterInboxItems(), inboxHasNoAssignmentMetadata(), inboxIsUnusedForDataset(), shuffle() (+25 more)

### Community 24 - "Desktop App"
Cohesion: 0.07
Nodes (33): AutoLabelTool, CropTool, ExportHubTool, HomeTool, ImageBoxLabelTool, ImageWorkspaceTool, LabelTool, LibraryTool (+25 more)

### Community 25 - "Desktop Features"
Cohesion: 0.09
Nodes (27): UseBoxLabelInteractionOptions, isNumpadCode(), KEYBOARD_STEP_MULTIPLIERS, keyboardMultiplierForNumpad(), KeyboardStepMultiplier, numpadResizeKey(), BoxLabelPreviewToolbar(), BoxLabelPreviewToolbarProps (+19 more)

### Community 26 - "Desktop Features"
Cohesion: 0.12
Nodes (34): arrowKeyDelta(), boxCenter(), boxCenterPixel(), boxIou(), boxToRect(), canvasPixelsToImagePixels(), clamp(), clamp01() (+26 more)

### Community 27 - "Backend"
Cohesion: 0.14
Nodes (36): ArgumentParser, build_workspace_links(), parse_class_names(), WorkspacePaths, _add_build_arguments(), build_clf_dataset(), build_detect_dataset(), BuildStats (+28 more)

### Community 28 - "Backend"
Cohesion: 0.19
Nodes (28): add_snapshot_version_entry(), _copy_workspace_snapshot_contents(), create_initial_versions_manifest(), create_snapshot_version(), _entry_id(), find_snapshot_container_for_version(), initialize_snapshot_versioning(), is_snapshot_version_dir_name() (+20 more)

### Community 29 - "Desktop Features"
Cohesion: 0.07
Nodes (32): formatMs(), HeaderProps, LabelSourceBadge(), LabelSourceSummaryBar(), LabelWorkbenchHeader(), ModeSwitchProps, SourceBadgeProps, sourceKindFromMode() (+24 more)

### Community 30 - "Desktop Features"
Cohesion: 0.10
Nodes (34): chooseAnnotationVideos(), clamp01(), createVideoAnnotationManifest(), DEFAULT_VIDEO_ANNOTATIONS_ROOT, FrameV1, getAnnotationFrameUrl(), hashPath(), LABEL_VIDEO_PREVIEW_FAST_EDGE (+26 more)

### Community 31 - "Desktop Features"
Cohesion: 0.13
Nodes (31): classifyImageBase64WithPt(), detectImageBase64WithPt(), startClassifyImageWithPt(), startDetectImageWithPt(), readAutoLabelModelRegistry(), AutoLabelModelKind, BoxLabelEntry, BoxLabelAutoLabelResult (+23 more)

### Community 32 - "Desktop Features"
Cohesion: 0.12
Nodes (31): readMetadataRows(), datasetRootForTask(), ensureTrainPrepDataYaml(), getTrainingStatus(), loadTrainPrepWorkspace(), metadataFlagEnabledByDefault(), nextTrainingFilenames(), nextTrainingStarCount() (+23 more)

### Community 33 - "Desktop Features"
Cohesion: 0.11
Nodes (28): ImageRect, loadCanvasImage(), resizeCanvasToParent(), DatasetReviewPreviewProps, clamp01(), deleteElementAtPath(), elementEntries(), ElementEntry (+20 more)

### Community 34 - "Backend"
Cohesion: 0.13
Nodes (13): _normalize_path(), PathAccess, Path, Normalize local and UNC paths consistently on all platforms., Tracks local filesystem paths selected during the current app session., app_settings_path(), list_dataset_files(), Return browsable dataset files relative to a YOLO dataset root. (+5 more)

### Community 35 - "Desktop Features"
Cohesion: 0.11
Nodes (29): LabelClass, getAnnotationFrameBase64(), VideoAnnotationManifest, buildDetectClassKeyIndex(), classIdToKey(), classKeyToClassId(), classNameToSafeKey(), encodeImageWithBlackouts() (+21 more)

### Community 36 - "Desktop Features"
Cohesion: 0.11
Nodes (23): useWorkspace(), WorkbenchBodyContent(), useToast(), CropPage(), DatasetReviewPage(), DatasetReviewPageProps, DatasetReviewPreview(), ExportHubPage() (+15 more)

### Community 37 - "Desktop Features"
Cohesion: 0.14
Nodes (31): CropPageProps, canvasToBase64(), cropPairIntoOutputs(), drawSmartCropPreview(), loadImageBitmap(), loadPairBoxes(), previewSmartCropPlans(), SmartCropPair (+23 more)

### Community 38 - "Desktop Features"
Cohesion: 0.12
Nodes (24): BoxLabelPage(), migrateShortcutEntry(), normalizeFixedBoxSlotsFromSession(), normalizeShortcutSlotsFromSession(), parsePoolLabelSession(), PoolLabelSession, resolveResumeImagePath(), BoxLabelModel (+16 more)

### Community 39 - "Desktop Features"
Cohesion: 0.12
Nodes (24): chooseMaskDirectory(), chooseMaskImageFile(), defaultMaskNoiseSettings(), DeleteImagesResult, deleteMaskImages(), DuplicateImagesResult, duplicateMaskImages(), fileToBase64() (+16 more)

### Community 41 - "Desktop App"
Cohesion: 0.16
Nodes (28): backend_port_open(), backend_settings(), BackendProcess, bundled_resource_roots(), default_backend_host(), default_backend_port(), dismiss_launch_splash(), dismiss_launch_splash_impl() (+20 more)

### Community 42 - "Backend"
Cohesion: 0.14
Nodes (20): assert_safe_pt_file(), _check_global(), _iter_pickle_streams(), Path, ValueError, Best-effort screening of PyTorch ``.pt`` checkpoints for malicious pickles.…, Raised when a ``.pt`` file references disallowed globals in its pickle., Raise :class:`UnsafeModelError` if the checkpoint pickle looks malicious. Best-… (+12 more)

### Community 43 - "Desktop Features"
Cohesion: 0.14
Nodes (26): drawZoomImageRect(), MainCanvasRenderInput, renderMainCanvas(), renderZoomCanvas(), ZoomCanvasRenderInput, boxToCanvasRect(), CanvasPreviewSource, classNameFor() (+18 more)

### Community 44 - "Desktop Features"
Cohesion: 0.15
Nodes (26): analysisClassPanelSummaries(), adjacentVideoMarkerTime(), initialVideoAnnotationTargetTime(), markerDrivenAnnotationTargetTime(), nextVideoKeyboardTime(), shouldClearActiveMarker(), useVideoPlaybackTimeline(), UseVideoPlaybackTimelineOptions (+18 more)

### Community 45 - "Desktop App"
Cohesion: 0.12
Nodes (18): CommandEnvelope, distance(), GestureCommandInterpreter, GestureInterpreterOptions, GestureObservation, HandLandmark, MotionSample, palmCenter() (+10 more)

### Community 46 - "Desktop Features"
Cohesion: 0.12
Nodes (20): FolderPickerRow(), FolderPickerRowProps, LogPanel(), LogPanelProps, NumberField(), NumberFieldProps, AutoLabelTask, cancelAutoLabelJob() (+12 more)

### Community 47 - "Desktop Features"
Cohesion: 0.17
Nodes (23): addImageProposal(), clearImageProposals(), emptyProposalManifest(), imageProposalKey(), ImageProposalManifest, imageProposalRelativePath(), loadImageProposals(), normalizeImageProposalManifest() (+15 more)

### Community 48 - "Desktop Features"
Cohesion: 0.13
Nodes (24): autoFitSubjectFromImage(), axisRunSupport(), bridgeDirectionMatchesLocalStroke(), bridgeTargetIndex(), buildSimilarColorMask(), clampRectToBitmap(), clampSeedPoint(), COLOR_PICK_MAX_DRAG_PX (+16 more)

### Community 49 - "Desktop Features"
Cohesion: 0.13
Nodes (22): chooseKeeper(), formatBytes(), ImagePoolDuplicates(), ImagePoolDuplicatesProps, naturalCompare(), ImagePoolToolbar(), ImagePoolToolbarProps, cardExtraClasses() (+14 more)

### Community 50 - "Desktop Features"
Cohesion: 0.16
Nodes (21): AnalysisClassBucket, AnalysisDetectPoint, AnalysisStats, clampUnit(), combineAnalysisStats(), combineBuckets(), EMPTY_ANALYSIS_STATS, HEATMAP_COLS (+13 more)

### Community 51 - "Backend"
Cohesion: 0.17
Nodes (25): load_ui_map(), _parse_json_document(), Any, Path, ValueError, Base typed error for UI-map persistence failures., sanitize_ui_map_name(), save_ui_map() (+17 more)

### Community 52 - "Desktop Features"
Cohesion: 0.11
Nodes (18): react, actionDisabled(), actionState(), actionStatusText(), DetectClassPaletteView(), formatInspectorMs(), InspectorActionButton(), isProposalAction() (+10 more)

### Community 53 - "Desktop Features"
Cohesion: 0.12
Nodes (20): applySessionTab(), openedWorkspaceState(), readInitialWorkspaceRoot(), resolveStartupWorkspaceRoot(), WorkspaceInitPhase, WorkspaceProvider(), normalizeImageWorkspaceTab(), saveActiveTabSession() (+12 more)

### Community 54 - "Tests"
Cohesion: 0.15
Nodes (11): apply_blackout_rects(), Any, ndarray, Non-destructive blackout renderer for export-time frame processing. Core…, Apply normalized blackout rects to a copy of `image`. Args: image: NumPy…, ndarray, Tests for backend.blackout_renderer.apply_blackout_rects. Core invariant under…, Create a white (all-255) uint8 image. (+3 more)

### Community 55 - "Desktop Features"
Cohesion: 0.12
Nodes (23): applyDetectThresholds(), ArchivedDetectClassFilter, dedupPredictions(), DEFAULT_DEDUP_IOU_THRESHOLD, DEFAULT_HIGH_CONFIDENCE, DEFAULT_MEDIUM_CONFIDENCE, detectPredictionUsesArchivedClass(), DuplicateCluster (+15 more)

### Community 56 - "Desktop Features"
Cohesion: 0.17
Nodes (23): galleryThumbTags(), datasetPreviewImageUrl(), INBOX_JUNK_CLASS, isClfJunk(), isDetectJunk(), isFlaggedFile(), isNextTrainingFile(), isReviewedFile() (+15 more)

### Community 57 - "Backend"
Cohesion: 0.15
Nodes (19): _base64_decoded_size(), _base64_payload(), choose_directory(), choose_image_file(), choose_image_files(), choose_media_files(), choose_model_file(), choose_onnx_file() (+11 more)

### Community 58 - "Backend"
Cohesion: 0.15
Nodes (17): Any, require_cuda_device(), torch_runtime_info(), _clamp01(), _class_name(), detect_folder_with_pt(), detect_image_with_pt(), _fmt() (+9 more)

### Community 59 - "Apps"
Cohesion: 0.15
Nodes (22): loadBackendConfig(), appendBackendLog(), backend, backendLogPath, canRunPython(), desktopDir, ensureLogsDir(), ensurePythonDeps() (+14 more)

### Community 60 - "Desktop Features"
Cohesion: 0.17
Nodes (20): BoxLabelEditorSnapshot, BoxLabelUndoTransaction, clearScopeHistory(), emptyUndoRedoState(), hasRedoForScope(), hasUndoForScope(), pushScopedTransaction(), redoScoped() (+12 more)

### Community 61 - "Apps"
Cohesion: 0.08
Nodes (24): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+16 more)

### Community 62 - "Backend"
Cohesion: 0.23
Nodes (19): _box_to_cv_rect(), _box_to_dict(), _box_to_rect(), boxes_to_text(), _clamp01(), _dict_to_box(), label_path_for(), _merge_box_into_label() (+11 more)

### Community 63 - "Desktop Features"
Cohesion: 0.15
Nodes (20): BlackoutBoxOverlapWarning, BlackoutOverlay, BlackoutOverlayManifest, BlackoutPolygonShape, BlackoutShape, BlackoutTarget, clamp01(), clampBetween() (+12 more)

### Community 64 - "Desktop App"
Cohesion: 0.16
Nodes (18): AprilTagDetectionResponse, calibrationSheetUrl(), captureVideoFrameBase64(), detectAprilTags(), AprilTagCalibrationOptions, AprilTagDetection, computeHomography(), homographyFromAprilTags() (+10 more)

### Community 65 - "Desktop App"
Cohesion: 0.12
Nodes (15): ArmIndexes, ArmSide, average(), distance(), landmarkConfidence(), LEFT_ARM, mirrored(), MotionCandidate (+7 more)

### Community 66 - "Desktop App"
Cohesion: 0.16
Nodes (20): WorkspaceArchitectureContext, WorkspaceArchitectureContextValue, WorkspaceArchitecturePhase, WorkspaceArchitectureProvider(), defaultPaths(), defaultTools(), ensureWorkspaceManifest(), hasText() (+12 more)

### Community 67 - "Tests"
Cohesion: 0.19
Nodes (12): import_media_files(), list_workspace_videos(), Any, Path, _unique_media_path(), find_videos(), list_workspace_files(), load_workspace_config() (+4 more)

### Community 68 - "Yoloworkbench"
Cohesion: 0.28
Nodes (7): DatasetKind, _dict_result(), _job_id(), Any, Maps MCP business tools onto the existing FastAPI service methods., _string_list(), YoloWorkBenchBridge

### Community 69 - "Apps"
Cohesion: 0.19
Nodes (19): desktopDir, main(), runNodeScript(), main(), desktopDir, ensureUsableVitePort(), isCurrentFrontend(), isPortOpen() (+11 more)

### Community 70 - "Desktop Features"
Cohesion: 0.25
Nodes (18): addBlackoutOverlay(), blackoutManifestRelativePath(), DEFAULT_OVERLAYS_ROOT, imageBlackoutSourceKey(), loadBlackoutOverlays(), normalizeOverlaysRoot(), removeBlackoutOverlay(), safeStem() (+10 more)

### Community 71 - "Desktop Features"
Cohesion: 0.19
Nodes (16): TimestampSource, UseVideoSamplingOptions, computeSamplingPool(), EnabledSegment, isTooCloseToExisting(), makeSeededRng(), pickWeightedSegment(), Rng (+8 more)

### Community 72 - "Desktop App"
Cohesion: 0.15
Nodes (18): createCommandEnvelope(), MultimodalControlContext, MultimodalControlContextValue, MultimodalControlProvider(), readBoolean(), readHomography(), writeBoolean(), BrowserSpeechStatus (+10 more)

### Community 73 - "Desktop App"
Cohesion: 0.10
Nodes (19): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+11 more)

### Community 74 - "Backend"
Cohesion: 0.13
Nodes (7): BackendBridge, Path, QWebChannel bridge exposed to the HTML frontend as `backend`., Dispatch any BackendService API call; returns JSON {ok, result|error}., Open the web UI in the system browser (Chrome/Edge)., QObject, Slot

### Community 75 - "Backend"
Cohesion: 0.20
Nodes (12): _class_name(), classify_folder_with_pt(), classify_image_with_pt(), _effective_image_size(), _image_size_from_source(), _prob_predictions(), Any, Path (+4 more)

### Community 76 - "Desktop Features"
Cohesion: 0.27
Nodes (16): copyModelToWorkspace(), importAutoLabelClassifyModel(), importAutoLabelDetectModel(), importModelViaBackend(), pickAndImportAutoLabelModel(), activeModelFilename(), AutoLabelModelEntry, AutoLabelModelRegistry (+8 more)

### Community 77 - "Desktop Features"
Cohesion: 0.23
Nodes (18): selectionLooksLikeColorPick(), selectionTooSmallPixels(), boxToImagePixelRect(), canvasToImagePoint(), cursorForPoint(), defaultPoolLabelCursor(), eventCanvasPoint(), hitTest() (+10 more)

### Community 78 - "Desktop App"
Cohesion: 0.11
Nodes (18): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+10 more)

### Community 79 - "Desktop App"
Cohesion: 0.11
Nodes (18): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+10 more)

### Community 80 - "Desktop Features"
Cohesion: 0.19
Nodes (13): ensureImagePoolBackup(), readFileBase64(), writeFileBase64(), cache, invalidateDatasetImageUrl(), mimeFor(), mimeForPath(), applyBlackEditsForImage() (+5 more)

### Community 81 - "Desktop Features"
Cohesion: 0.12
Nodes (13): GoldenCase, GoldenSuite, suites, interpret(), cardA, cardB, doc, goA (+5 more)

### Community 82 - "Apps"
Cohesion: 0.12
Nodes (17): devDependencies, eslint, prettier, @tauri-apps/cli, @types/react-dom, typescript-eslint, vite, @vitejs/plugin-react (+9 more)

### Community 83 - "Desktop Features"
Cohesion: 0.15
Nodes (16): BackendMethod, getWorkspaceInfo(), WorkspaceInfo, BatchCropFileItem, BatchCropResult, chooseCropDirectory(), CropAnchor, defaultBatchCropOutput() (+8 more)

### Community 84 - "Desktop Features"
Cohesion: 0.15
Nodes (14): BoxLabelShortcutDropdown(), BoxLabelShortcutDropdownProps, normalizeSearch(), searchTerms(), ShortcutDropdownOption, RemotePointerState, VideoTimelineMarker, MarkerDragState (+6 more)

### Community 85 - "Tests"
Cohesion: 0.15
Nodes (10): McpStdioContractTests, ProjectConfigTests, BackendClient, BackendError, BackendUnavailableError, Raised when the local YoloWorkBench backend rejects a request., Raised when the local YoloWorkBench backend cannot be reached., Small JSON client for the existing localhost FastAPI backend. (+2 more)

### Community 86 - "Desktop App"
Cohesion: 0.19
Nodes (13): CommandSource, DEFAULT_SAFETY, WorkbenchCommand, CHINESE_DIGITS, DEFAULT_WAKE_WORDS, extractWakeWord(), normalizeTranscript(), parseChineseInteger() (+5 more)

### Community 87 - "Backend"
Cohesion: 0.25
Nodes (4): JobStore, Any, Event, PtJobCleanupTests

### Community 88 - "Backend"
Cohesion: 0.30
Nodes (15): _class_names_from_metadata(), Classifier, classify_dataset_images(), classify_image(), _input_size(), load_classifier(), model_info(), _preprocess_image() (+7 more)

### Community 89 - "Tests"
Cohesion: 0.16
Nodes (4): BaseHTTPRequestHandler, _ApiHandler, BackendClientTests, Any

### Community 90 - "Apps"
Cohesion: 0.13
Nodes (15): scripts, backend:dev, build, dev, dev:shell, format, format:check, lint (+7 more)

### Community 91 - "Desktop Features"
Cohesion: 0.18
Nodes (12): ClassListEditorProps, CreateWorkspaceDialog(), CreateWorkspaceOptions, Props, HomePage(), loadRecent(), Props, pushRecent() (+4 more)

### Community 92 - "Desktop App"
Cohesion: 0.19
Nodes (8): CommandArbiter, CommandArbiterOptions, CommandDecision, PendingConfirmation, CommandListener, DecisionListener, commandKey(), commandSafety

### Community 93 - "Desktop App"
Cohesion: 0.13
Nodes (14): anyOf, definitions, Number, Target, Value, description, anyOf, description (+6 more)

### Community 94 - "Desktop Features"
Cohesion: 0.27
Nodes (10): bitsToHex(), computeAHash(), computeDHash(), hammingDistance(), ImageFingerprint, normalizeSimilarityScore(), POPCOUNT4, rankSimilarityCandidates() (+2 more)

### Community 95 - "Desktop Features"
Cohesion: 0.34
Nodes (13): boxEdges(), boxFromEdges(), clamp(), Corner, displayRect(), DragState, eventPoint(), hitBox() (+5 more)

### Community 96 - "Desktop App"
Cohesion: 0.14
Nodes (13): description, identifier, permissions, $schema, windows, core:default, core:window:allow-close, core:window:allow-hide (+5 more)

### Community 97 - "Backend"
Cohesion: 0.26
Nodes (12): build_predictions(), _clf(), _det_boxes(), Any, Map raw detector/classifier output into the UI Orchestrator schema v1.0…, Assemble the schema-§12 Predictions dict. `clf` is always present (schema §12…, _approx_box(), _raw_clf() (+4 more)

### Community 98 - "Tests"
Cohesion: 0.27
Nodes (4): PathPolicyTests, PathPolicy, Path, Restrict every MCP filesystem argument to configured local roots.

### Community 99 - "Desktop Components"
Cohesion: 0.24
Nodes (9): ConfirmContext, ConfirmContextValue, ConfirmOptions, ConfirmProvider(), ConfirmProviderProps, ConfirmState, EMPTY_STATE, useConfirm() (+1 more)

### Community 100 - "Desktop App"
Cohesion: 0.15
Nodes (13): properties, Identifier, default, description, type, description, oneOf, type (+5 more)

### Community 101 - "Desktop App"
Cohesion: 0.15
Nodes (13): definitions, Number, PermissionEntry, Target, Value, anyOf, description, anyOf (+5 more)

### Community 102 - "Desktop App"
Cohesion: 0.15
Nodes (13): properties, Identifier, description, oneOf, type, default, description, type (+5 more)

### Community 103 - "Apps"
Cohesion: 0.17
Nodes (11): dependencies, react-dom, @tauri-apps/api, @tauri-apps/plugin-dialog, name, private, type, version (+3 more)

### Community 104 - "Desktop App"
Cohesion: 0.17
Nodes (12): $ref, array, null, description, items, type, uniqueItems, description (+4 more)

### Community 105 - "Desktop App"
Cohesion: 0.17
Nodes (12): $ref, array, null, description, items, type, uniqueItems, description (+4 more)

### Community 106 - "Yoloworkbench"
Cohesion: 0.32
Nodes (8): InferenceKind, _bounded_int(), _filenames(), _inference_kind(), _positive_int(), _probability(), _validate_device(), YoloWorkBench MCP integration.

### Community 107 - "Desktop Features"
Cohesion: 0.29
Nodes (9): getBuildJob(), startBuildYoloLinks(), restoreMetadataSnapshots(), runBuildYoloLinksJob(), filenamesNeedingDatasetRebuild(), metadataRowToUpdate(), MetadataUpdate, rebuildDatasetLinksForFilenames() (+1 more)

### Community 108 - "Desktop Features"
Cohesion: 0.29
Nodes (10): trackYoloForward(), findNearestBoxIndex(), mergeCopiedBox(), mergeCopiedBoxWithIndex(), adjustCurrentBoxIndexes(), cloneBox(), DuplicateInternalState, emptyDuplicateState (+2 more)

### Community 109 - "Desktop Features"
Cohesion: 0.25
Nodes (9): BoxLabelTopbar(), BoxLabelTopbarProps, BoxLabelPageModel, BoxLabelPageProps, BoxLabelSurface(), BoxLabelSurfaceProps, activeClassificationClasses(), chooseClassificationManifest() (+1 more)

### Community 110 - "Desktop App"
Cohesion: 0.29
Nodes (10): createWorkspaceEvent(), dayKey(), pathSafeTimestamp(), randomId(), recordWorkspaceEvent(), recordWorkspaceEventBestEffort(), recordWorkspaceOperation(), WorkspaceEventInput (+2 more)

### Community 112 - "Backend"
Cohesion: 0.53
Nodes (9): Anchor, batch_crop_files(), batch_crop_images(), _class_name_from_relative(), _crop_one(), _crop_one_file(), Path, _summarize_crop_results() (+1 more)

### Community 113 - "Desktop Features"
Cohesion: 0.27
Nodes (9): FrameEvent, TemporalFrame, coffee, coffeeFrame(), contract, farm, frame(), readyFarmFrame() (+1 more)

### Community 114 - "Desktop App"
Cohesion: 0.20
Nodes (10): type, webviews, windows, items, description, items, type, description (+2 more)

### Community 115 - "Desktop App"
Cohesion: 0.20
Nodes (10): type, webviews, windows, items, description, items, type, description (+2 more)

### Community 117 - "Desktop Features"
Cohesion: 0.39
Nodes (7): writeTextFile(), writeAutoLabelModelRegistry(), AUTO_LABEL_RUNS_REL_PATH, AutoLabelRunRegistry, parseAutoLabelRunRegistry(), readAutoLabelRunKeys(), writeAutoLabelRunKeys()

### Community 118 - "Desktop Features"
Cohesion: 0.39
Nodes (6): LabelWorkbenchContext, LabelWorkbenchContextValue, isLabelWorkbenchEmbedded(), baseContext, useIsLabelWorkbenchEmbedded(), useLabelWorkbench()

### Community 119 - "Desktop Features"
Cohesion: 0.36
Nodes (5): BlackoutRectShape, applyBlackoutRectsToImageData(), computeExportBlackoutWarnings(), ExportBlackoutWarning, rectIouSimple()

### Community 120 - "Desktop Features"
Cohesion: 0.22
Nodes (4): ImageSource, Source, SourceFingerprint, VideoSource

### Community 121 - "Desktop App"
Cohesion: 0.22
Nodes (9): description, properties, required, type, CapabilityRemote, urls, urls, description (+1 more)

### Community 122 - "Desktop App"
Cohesion: 0.22
Nodes (9): description, properties, required, type, CapabilityRemote, urls, urls, description (+1 more)

### Community 124 - "Scripts"
Cohesion: 0.39
Nodes (7): draw_icon(), _gradient_color(), _i(), _lerp(), main(), Image, Generate raster app icons from the vector design for Qt / OS shortcuts.

### Community 125 - "Backend"
Cohesion: 0.43
Nodes (6): Path, Write bytes to ``path`` atomically (see :func:`write_text_atomic`)., Write text to ``path`` atomically. The content is written to a temporary file…, _silent_unlink(), write_bytes_atomic(), write_text_atomic()

### Community 126 - "Yoloworkbench"
Cohesion: 0.43
Nodes (5): FastMCP, ToolAnnotations, create_server(), _read_only(), _stateful()

### Community 128 - "Desktop App"
Cohesion: 0.33
Nodes (6): description, required, type, Capability, identifier, permissions

### Community 129 - "Desktop App"
Cohesion: 0.33
Nodes (6): description, required, type, Capability, identifier, permissions

### Community 130 - "Tests"
Cohesion: 0.33
Nodes (4): path, projectRoot, { spawn }, { test, expect }

### Community 131 - "Desktop App"
Cohesion: 0.40
Nodes (4): anyOf, description, $schema, title

### Community 132 - "Tests"
Cohesion: 0.50
Nodes (3): ApiSchemaVersionTests, _constant(), Path

### Community 133 - "Desktop App"
Cohesion: 0.50
Nodes (4): default, description, type, local

### Community 134 - "Desktop App"
Cohesion: 0.50
Nodes (4): default, description, type, description

### Community 137 - "Desktop App"
Cohesion: 0.67
Nodes (3): PermissionEntry, anyOf, description

## Knowledge Gaps
- **642 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+637 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `BackendService` connect `Backend` to `Backend`, `Backend`, `Backend`, `Backend`, `Backend`, `Backend`, `Backend`, `Backend`, `Backend`, `Backend`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `useWorkspace()` connect `Desktop Features` to `Desktop Features`, `Desktop Features`, `Desktop Features`, `Desktop Features`, `Desktop Features`, `Desktop App`, `Desktop Features`, `Desktop Features`, `Desktop Features`, `Desktop Features`, `Desktop Features`, `Desktop Components`, `Desktop Features`, `Desktop Features`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `BackendService` (e.g. with `DesktopBackendService` and `BackendBridge`) actually correct?**
  _`BackendService` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `useVideoAnnotationSession()` (e.g. with `defaultClasses()` and `labelBoxToDetectBox()`) actually correct?**
  _`useVideoAnnotationSession()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _642 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Backend` be split into smaller, more focused modules?**
  _Cohesion score 0.05733482642777156 - nodes in this community are weakly interconnected._
- **Should `Backend` be split into smaller, more focused modules?**
  _Cohesion score 0.05934242181234964 - nodes in this community are weakly interconnected._