import { useEffect, useState } from "react";
import { useWorkspace } from "../../app/WorkspaceProvider";
import type { LabelBox } from "../../api";
import { DatasetReviewClassifierPanel } from "./DatasetReviewClassifierPanel";
import { DatasetReviewEditor } from "./DatasetReviewEditor";
import { DatasetReviewGallery } from "./DatasetReviewGallery";
import { DatasetReviewLightbox } from "./DatasetReviewLightbox";
import { DatasetReviewPreview } from "./DatasetReviewPreview";
import { useDatasetClassifier } from "./useDatasetClassifier";
import { useDatasetReview } from "./useDatasetReview";

type DatasetReviewPageProps = {
  onReady?: () => void;
  onStatusText?: (text: string) => void;
};

export function DatasetReviewPage({ onReady, onStatusText }: DatasetReviewPageProps) {
  const { workspaceRoot, chooseWorkspaceFolder, setActiveTab } = useWorkspace();
  const review = useDatasetReview({ workspaceRoot, onReady });
  const classifier = useDatasetClassifier(review.datasetRoot);

  const [reviewMode, setReviewMode] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [cropMenu, setCropMenu] = useState<{ x: number; y: number; classId: number } | null>(null);
  const [detectMenu, setDetectMenu] = useState<{ x: number; y: number } | null>(null);
  const [editBoxes, setEditBoxes] = useState<LabelBox[]>([]);

  const { setSelectedBoxIndex, currentBoxes, currentPair, navigate, currentIndex, pairs } = review;

  useEffect(() => {
    setEditBoxes(currentBoxes);
    setSelectedBoxIndex(null);
  }, [currentPair?.imagePath, currentBoxes, setSelectedBoxIndex]);

  useEffect(() => {
    onStatusText?.(review.status || review.error);
  }, [onStatusText, review.status, review.error]);

  useEffect(() => {
    classifier.updateCurrentResultText(currentPair);
  }, [classifier, currentPair]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if ((key === "a" || key === "arrowleft" || key === "arrowup") && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        navigate(currentIndex - 1);
        return;
      }
      if ((key === "d" || key === "arrowright" || key === "arrowdown") && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        navigate(currentIndex + 1);
        return;
      }
      if (key === "r" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        review.toggleReviewed();
        return;
      }
      if (key === "f" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        review.toggleFlagged();
        return;
      }
      if (key === "n" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        review.nextIssue();
        return;
      }
      if (key === "escape") {
        event.preventDefault();
        setSelectedBoxIndex(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentIndex, navigate, review, setSelectedBoxIndex]);

  useEffect(() => {
    if (!cropMenu && !detectMenu) return;
    function close() {
      setCropMenu(null);
      setDetectMenu(null);
    }
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [cropMenu, detectMenu]);

  const reviewedCount = review.selectedPairs.filter((pair) => review.reviewedPaths.has(pair.imagePath)).length;
  const reviewedLabel =
    review.selectedPairs.length > 1
      ? `Reviewed ${reviewedCount}/${review.selectedPairs.length}`
      : review.currentPair && review.reviewedPaths.has(review.currentPair.imagePath)
        ? "Reviewed: Yes"
        : "Reviewed";
  const flagged = review.currentPair !== null && review.flaggedPaths.has(review.currentPair.imagePath);
  const reviewedActive =
    review.selectedPairs.length > 0 &&
    review.selectedPairs.every((pair) => review.reviewedPaths.has(pair.imagePath));
  const editablePreview = review.mode === "detect" && review.datasetTask === "detect";

  return (
    <div className={`react-dataset-review-page${reviewMode ? " review" : ""}`}>
      <main className="workspace yolo-workspace" id="yoloWorkspace">
        <div className="yolo-mode-bar">
          <div className="inbox-target-toggle" id="yoloViewModes" role="group" aria-label="Dataset mode">
            <button
              type="button"
              className={`inbox-target-option${review.mode === "detect" ? " active" : ""}`}
              onClick={() => review.switchMode("detect")}
            >
              Detect
            </button>
            <button
              type="button"
              className={`inbox-target-option${review.mode === "clf" ? " active" : ""}`}
              onClick={() => review.switchMode("clf")}
            >
              Clf
            </button>
          </div>
          <div className="row yolo-toolbar">
            <button type="button" className="primary" onClick={() => chooseWorkspaceFolder().catch(() => {})}>
              Open Workspace
            </button>
            <button type="button" disabled={review.pending} onClick={() => review.reload()}>
              Refresh
            </button>
            <button
              type="button"
              id="reviewModeBtn"
              className={reviewMode ? "active" : ""}
              onClick={() => setReviewMode((value) => !value)}
            >
              {reviewMode ? "Exit Review" : "Review Mode"}
            </button>
            <button
              type="button"
              id="showAllImagesBtn"
              className={review.imageViewMode === "all" ? "active" : ""}
              onClick={() => review.changeImageViewMode("all")}
            >
              Show All
            </button>
            <button
              type="button"
              id="hideReviewedImagesBtn"
              className={review.imageViewMode === "hideReviewed" ? "active" : ""}
              onClick={() => review.changeImageViewMode("hideReviewed")}
            >
              Hide Reviewed
            </button>
            <button
              type="button"
              id="showFlaggedImagesBtn"
              className={review.imageViewMode === "flagged" ? "active" : ""}
              onClick={() => review.changeImageViewMode("flagged")}
            >
              Show Flagged
            </button>
            <button
              type="button"
              id="sendToCropBtn"
              disabled={!review.canSendToCrop}
              onClick={() =>
                review.sendFilteredToCrop().then(() => setActiveTab("crop")).catch((err) => window.alert(err.message))
              }
            >
              Send to Crop
            </button>
            <button
              type="button"
              id="markReviewedBtn"
              className={reviewedActive ? "primary" : ""}
              onClick={() => review.toggleReviewed()}
            >
              {reviewedLabel}
            </button>
            <button type="button" id="flagBtn" className={flagged ? "danger" : ""} onClick={() => review.toggleFlagged()}>
              {flagged ? "Flagged" : "Flag"}
            </button>
            <button type="button" id="nextIssueBtn" onClick={() => review.nextIssue()}>
              Next Issue
            </button>
            <button type="button" className="danger" onClick={() => review.markJunk()}>
              Mark Junk
            </button>
            <button type="button" disabled={!review.canUndoJunk} onClick={() => review.undoJunk()}>
              Undo Junk
            </button>
          </div>
        </div>

        {review.error ? <div className="error-banner">{review.error}</div> : null}

        <DatasetReviewGallery
          datasetRoot={review.datasetRoot}
          pairs={pairs}
          currentIndex={currentIndex}
          shiftSelectedPaths={review.shiftSelectedPaths}
          reviewedPaths={review.reviewedPaths}
          flaggedPaths={review.flaggedPaths}
          metadata={review.metadata}
          junkScope={review.junkScope}
          restoreScrollTop={review.galleryScrollTop}
          onSelect={review.selectGallery}
          onScrollChange={review.onGalleryScroll}
          onDoubleClick={(index) => setLightboxIndex(index)}
          onContextMenu={(index, event) => {
            if (!review.canSendToDetect) return;
            event.preventDefault();
            review.selectGallery(index, { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, metaKey: event.metaKey });
            setDetectMenu({ x: event.clientX, y: event.clientY });
          }}
          classifierResults={classifier.results}
        />

        {editablePreview ? (
          <DatasetReviewEditor
            datasetRoot={review.datasetRoot}
            pair={currentPair}
            boxes={editBoxes}
            selectedBoxIndex={review.selectedBoxIndex}
            classifierResult={classifier.resultForPair(currentPair)}
            onBoxesChange={setEditBoxes}
            onSelectBox={review.setSelectedBoxIndex}
            onPersist={review.persistBoxes}
            onStatus={(text) => onStatusText?.(text)}
          />
        ) : (
          <DatasetReviewPreview
            datasetRoot={review.datasetRoot}
            pair={currentPair}
            boxes={review.currentBoxes}
            onPrev={() => navigate(currentIndex - 1)}
            onNext={() => navigate(currentIndex + 1)}
            canPrev={currentIndex > 0}
            canNext={currentIndex < pairs.length - 1}
          />
        )}

        {!reviewMode ? (
          <aside className="side-stack yolo-side-stack" id="yoloSideStack">
            <section className="panel txt-info-panel" id="txtInfoPanel">
              <div className="panel-header">
                <span>TXT Info</span>
                <span id="imageCount" className="status">
                  {pairs.length ? `${currentIndex + 1} / ${pairs.length}` : "0 / 0"}
                  {review.allPairs.length !== pairs.length ? ` (${review.allPairs.length} total)` : ""}
                </span>
              </div>
              <div className="panel-body txt-info-body">
                <div className="meta">
                  <div id="fileMeta">{review.currentPair?.imagePath || "No image selected."}</div>
                </div>
                <textarea
                  id="labelText"
                  readOnly
                  value={review.currentBoxes
                    .map((box) => `${box.classId} ${box.x} ${box.y} ${box.w} ${box.h}`)
                    .join("\n")}
                />
              </div>
            </section>

            <DatasetReviewClassifierPanel
              modelStatus={classifier.modelStatus}
              topK={classifier.topK}
              resultText={classifier.resultText}
              running={classifier.running}
              onTopKChange={classifier.setTopK}
              onChooseModel={() => classifier.chooseModel().catch((err) => window.alert(err.message))}
              onClassifyCurrent={() =>
                currentPair
                  ? classifier.classifyPaths([currentPair.imagePath]).catch((err) => window.alert(err.message))
                  : undefined
              }
              onClassifySelected={() =>
                classifier
                  .classifyPaths(review.selectedPairs.map((pair) => pair.imagePath))
                  .catch((err) => window.alert(err.message))
              }
              onClassifyVisible={() =>
                classifier.classifyPaths(pairs.map((pair) => pair.imagePath)).catch((err) => window.alert(err.message))
              }
            />

            <section className="panel filter-panel">
              <div className="panel-header">
                <span>Filter</span>
              </div>
              <div className="panel-body filter-panel-body">
                <div className="yolo-filter-tools row" style={{ marginBottom: 8 }}>
                  <button type="button" id="clearIncludeBtn" onClick={() => review.clearInclude()}>
                    Deselect Include
                  </button>
                  <button type="button" id="clearExcludeBtn" onClick={() => review.clearExclude()}>
                    Deselect Exclude
                  </button>
                  <button type="button" id="clearFilterBtn" onClick={() => review.clearFilters()}>
                    Deselect All
                  </button>
                </div>
                <div className="yolo-filter-tools filter-list" id="filterList">
                  {review.classFilterItems.length ? (
                    review.classFilterItems.map((item) => (
                      <label
                        key={item.id}
                        className="filter-row"
                        onContextMenu={(event) => {
                          if (!review.canSendToCrop) return;
                          event.preventDefault();
                          setCropMenu({ x: event.clientX, y: event.clientY, classId: item.id });
                        }}
                      >
                        <span>
                          {item.id}: {item.name} ({item.imageCount})
                        </span>
                        <span>
                          <input
                            type="checkbox"
                            checked={review.include.has(item.id)}
                            onChange={(event) => review.toggleInclude(item.id, event.target.checked)}
                          />{" "}
                          inc
                          <input
                            type="checkbox"
                            checked={review.exclude.has(item.id)}
                            onChange={(event) => review.toggleExclude(item.id, event.target.checked)}
                          />{" "}
                          exc
                        </span>
                      </label>
                    ))
                  ) : (
                    <div className="empty">No classes loaded.</div>
                  )}
                </div>
                <div className="yolo-filter-tools hint" id="filterStatus">
                  {review.filterStatus}
                </div>
              </div>
            </section>
          </aside>
        ) : null}
      </main>

      {cropMenu ? (
        <div className="context-menu" style={{ left: cropMenu.x, top: cropMenu.y, position: "fixed", zIndex: 2000 }}>
          <button
            type="button"
            onClick={() => {
              setCropMenu(null);
              review.sendClassToCrop(cropMenu.classId).then(() => setActiveTab("crop")).catch((err) => window.alert(err.message));
            }}
          >
            Send class to Crop
          </button>
        </div>
      ) : null}

      {detectMenu ? (
        <div className="context-menu" style={{ left: detectMenu.x, top: detectMenu.y, position: "fixed", zIndex: 2000 }}>
          <button
            type="button"
            onClick={() => {
              setDetectMenu(null);
              review.sendSelectedToDetect().catch((err) => window.alert(err.message));
            }}
          >
            Send selected to Detect ({review.selectedPairs.length})
          </button>
        </div>
      ) : null}

      <DatasetReviewLightbox
        open={lightboxIndex !== null}
        datasetRoot={review.datasetRoot}
        pairs={pairs}
        index={lightboxIndex ?? 0}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={(index) => {
          setLightboxIndex(index);
          navigate(index);
        }}
      />
    </div>
  );
}
