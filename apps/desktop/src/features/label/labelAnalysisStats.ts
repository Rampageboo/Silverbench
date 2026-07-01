import type { VideoAnnotationSession } from "../video/useVideoAnnotationSession";

export type AnalysisClassBucket = {
  key: string;
  name: string;
  count: number;
};

export type AnalysisDetectPoint = {
  classKey: string;
  className: string;
  x: number;
  y: number;
  area: number;
};

export type AnalysisStats = {
  totalMedia: number;
  detectSamples: number;
  detectHits: number;
  clfLabels: number;
  proposals: number;
  reviewed: number;
  junk: number;
  detectClasses: AnalysisClassBucket[];
  clfClasses: AnalysisClassBucket[];
  detectPoints: AnalysisDetectPoint[];
};

export const EMPTY_ANALYSIS_STATS: AnalysisStats = {
  totalMedia: 0,
  detectSamples: 0,
  detectHits: 0,
  clfLabels: 0,
  proposals: 0,
  reviewed: 0,
  junk: 0,
  detectClasses: [],
  clfClasses: [],
  detectPoints: [],
};

export const HEATMAP_COLS = 8;
export const HEATMAP_ROWS = 5;

export function incrementBucket(map: Map<string, AnalysisClassBucket>, key: string, name: string, amount = 1) {
  const trimmedKey = key.trim();
  if (!trimmedKey) return;
  const existing = map.get(trimmedKey);
  if (existing) {
    existing.count += amount;
    if (existing.name === trimmedKey && name !== trimmedKey) existing.name = name;
    return;
  }
  map.set(trimmedKey, { key: trimmedKey, name: name || trimmedKey, count: amount });
}

export function sortedBuckets(map: Map<string, AnalysisClassBucket>): AnalysisClassBucket[] {
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function videoAnalysisStats(videoSession: VideoAnnotationSession): AnalysisStats {
  const frames = Object.values(videoSession.manifest?.frames ?? {});
  const detectNames = new Map(videoSession.classes.map((item) => [String(item.id), item.name]));
  const clfNames = new Map(videoSession.clfClassOptions.map((item) => [item.key, item.name]));
  const detectBuckets = new Map<string, AnalysisClassBucket>();
  const clfBuckets = new Map<string, AnalysisClassBucket>();
  const detectPoints: AnalysisDetectPoint[] = [];
  let detectSamples = 0;
  let detectHits = 0;
  let clfLabels = 0;
  let proposals = 0;
  let reviewed = 0;

  for (const frame of frames) {
    const detect = frame.tasks.detect;
    const clf = frame.tasks.clf;
    const detectBoxCount = detect?.boxes.length ?? 0;
    const proposalCount = detect?.proposals?.length ?? 0;
    if (detect && (detectBoxCount > 0 || proposalCount > 0 || detect.reviewed || detect.empty)) {
      detectSamples += 1;
    }
    detectHits += detectBoxCount;
    proposals += proposalCount;
    for (const box of detect?.boxes ?? []) {
      const key = box.classKey || (typeof box.classId === "number" ? String(box.classId) : "");
      if (!key) continue;
      const name = detectNames.get(key) ?? `#${key}`;
      incrementBucket(detectBuckets, key, name);
      detectPoints.push({
        classKey: key,
        className: name,
        x: clampUnit(box.x),
        y: clampUnit(box.y),
        area: clampUnit(box.w) * clampUnit(box.h),
      });
    }
    if (clf?.classKey) {
      clfLabels += 1;
      incrementBucket(clfBuckets, clf.classKey, clfNames.get(clf.classKey) ?? clf.classKey);
    }
    if (detect?.reviewed || clf?.reviewed) reviewed += 1;
  }

  return {
    totalMedia: videoSession.videos.length,
    detectSamples,
    detectHits,
    clfLabels,
    proposals,
    reviewed,
    junk: 0,
    detectClasses: sortedBuckets(detectBuckets),
    clfClasses: sortedBuckets(clfBuckets),
    detectPoints,
  };
}

export function combineBuckets(items: AnalysisClassBucket[][]): AnalysisClassBucket[] {
  const merged = new Map<string, AnalysisClassBucket>();
  for (const buckets of items) {
    for (const bucket of buckets) {
      incrementBucket(merged, bucket.key, bucket.name, bucket.count);
    }
  }
  return sortedBuckets(merged);
}

export function combineAnalysisStats(...items: AnalysisStats[]): AnalysisStats {
  return items.reduce<AnalysisStats>(
    (total, item) => ({
      totalMedia: total.totalMedia + item.totalMedia,
      detectSamples: total.detectSamples + item.detectSamples,
      detectHits: total.detectHits + item.detectHits,
      clfLabels: total.clfLabels + item.clfLabels,
      proposals: total.proposals + item.proposals,
      reviewed: total.reviewed + item.reviewed,
      junk: total.junk + item.junk,
      detectClasses: combineBuckets([total.detectClasses, item.detectClasses]),
      clfClasses: combineBuckets([total.clfClasses, item.clfClasses]),
      detectPoints: [...total.detectPoints, ...item.detectPoints],
    }),
    EMPTY_ANALYSIS_STATS
  );
}

export function analysisClassPanelSummaries(stats: AnalysisStats) {
  return {
    detect: {
      metrics: [
        { label: "Classes", value: stats.detectClasses.length },
        { label: "Samples", value: stats.detectSamples },
        { label: "Hits", value: stats.detectHits },
        { label: "Props", value: stats.proposals },
      ],
    },
    clf: {
      metrics: [
        { label: "Classes", value: stats.clfClasses.length },
        { label: "Labels", value: stats.clfLabels },
        { label: "Reviewed", value: stats.reviewed },
        { label: "Junk", value: stats.junk },
      ],
    },
  };
}
