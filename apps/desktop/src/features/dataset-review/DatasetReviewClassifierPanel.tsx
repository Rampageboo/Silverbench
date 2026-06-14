type DatasetReviewClassifierPanelProps = {
  modelStatus: string;
  topK: number;
  resultText: string;
  running: boolean;
  onTopKChange: (value: number) => void;
  onChooseModel: () => void;
  onClassifyCurrent: () => void;
  onClassifySelected: () => void;
  onClassifyVisible: () => void;
};

export function DatasetReviewClassifierPanel({
  modelStatus,
  topK,
  resultText,
  running,
  onTopKChange,
  onChooseModel,
  onClassifyCurrent,
  onClassifySelected,
  onClassifyVisible
}: DatasetReviewClassifierPanelProps) {
  return (
    <section className="panel classifier-stack">
      <div className="panel-header">
        <span>Classifier</span>
        <span id="classifierModelStatus" className="status">
          {modelStatus}
        </span>
      </div>
      <div className="panel-body">
        <div className="row" style={{ marginBottom: 8 }}>
          <button type="button" id="chooseClassifierModelBtn" disabled={running} onClick={onChooseModel}>
            Choose ONNX
          </button>
          <label>
            Top K{" "}
            <input
              id="classifierTopKInput"
              type="number"
              min={1}
              max={20}
              value={topK}
              onChange={(event) => onTopKChange(Number(event.target.value) || 5)}
            />
          </label>
        </div>
        <div className="row" style={{ marginBottom: 8 }}>
          <button type="button" id="classifyCurrentBtn" disabled={running} onClick={onClassifyCurrent}>
            Current
          </button>
          <button type="button" id="classifySelectedBtn" disabled={running} onClick={onClassifySelected}>
            Selected
          </button>
          <button type="button" id="classifyVisibleBtn" disabled={running} onClick={onClassifyVisible}>
            Visible
          </button>
        </div>
        <pre id="classifierResult" className="classifier-result">
          {resultText}
        </pre>
      </div>
    </section>
  );
}
