var state = {
  datasetHandle: null,
  workspaceRoot: "",
  activeTab: "video",
  yoloSource: "",
  datasetBackendRoot: "",
  backupHandle: null,
  rootName: "",
  datasetTask: "detect",
  files: new Map(),
  allPairs: [],
  pairs: [],
  classNames: new Map(),
  labelCache: new Map(),
  classIndex: new Map(),
  imageClassSet: new Map(),
  imageClassBoxCounts: new Map(),
  classBoxCounts: new Map(),
  include: new Set(),
  exclude: new Set(),
  imageViewMode: "all",
  currentIndex: 0,
  currentImagePath: null,
  galleryScrollTop: 0,
  currentImage: null,
  previewBoxes: [],
  previewBoxesImagePath: null,
  displayRect: null,
  viewZoom: 1,
  viewPanX: 0,
  viewPanY: 0,
  viewPanDrag: null,
  selection: null,
  dragStart: null,
  boxDrag: null,
  pending: new Map(),
  labelEdits: new Map(),
  reviewedPaths: new Set(),
  flaggedPaths: new Set(),
  selectedBoxIndex: null,
  shiftSelectedPaths: new Set(),
  multiSelectAnchorIndex: null,
  blackRepeatTemplate: [],
  smartCropPreviewPlans: [],
  duplicateScan: null,
  urls: new Map()
};

var galleryVirtual = { rowHeight: 132, columns: 1, startIndex: -1, endIndex: -1 };
var bitmapCache = new Map();

var mergeState = {
  sources: [],
  targetHandle: null,
  targetBackendRoot: "",
  targetName: "",
  targetExplicit: false,
  workspaceDetectRoot: "",
  workspaceClfRoot: ""
};

var cropState = {
  stopRequested: false,
  classAnchors: new Map(),
  queue: { items: [], sources: [] }
};

var maskNoiseState = {
  photoFile: null,
  maskFile: null,
  photoBitmap: null,
  maskBitmap: null,
  folderName: "",
  folderItems: [],
  folderBackendRoot: "",
  folderUrls: new Map(),
  gridCards: new Map(),
  selectedPaths: new Set(),
  anchorPath: "",
  outputHandle: null,
  outputBackendRoot: "",
  outputName: "",
  photoPath: "",
  maskPath: "",
  outputReady: false
};

var videoState = {
  file: null,
  url: null,
  outputHandle: null,
  outputPath: "",
  screenshotOutputExplicit: false,
  stopBatch: false,
  exporting: false,
  exportSequence: 0,
  videos: [],
  currentVideoIndex: -1,
  backendCurrentTime: 0,
  backendPreviewRequestId: 0,
  backendPreviewInFlight: false,
  backendPreviewPendingTime: null,
  segments: [],
  activeSegmentIndex: -1,
  segmentDrag: null,
  timelineDrag: false,
  scrubberDrag: false,
  segmentContextTarget: null
};

var classifierState = {
  modelPath: "",
  modelInfo: null,
  results: new Map(),
  running: false
};
