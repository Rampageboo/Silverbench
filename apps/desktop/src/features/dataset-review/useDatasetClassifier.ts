import { useCallback, useState } from "react";
import * as api from "../../api";
import type { ClassifierImageResult } from "../../api";
import type { DatasetPair } from "./datasetCore";

export function useDatasetClassifier(datasetRoot: string) {
  const [modelPath, setModelPath] = useState("");
  const [modelInfo, setModelInfo] = useState<{ classes?: string[] } | null>(null);
  const [results, setResults] = useState<Map<string, ClassifierImageResult>>(new Map());
  const [running, setRunning] = useState(false);
  const [topK, setTopK] = useState(5);
  const [resultText, setResultText] = useState("Load a best.onnx classifier, then run CPU classification on dataset images.");

  const chooseModel = useCallback(async () => {
    const path = await api.chooseClassifierModel();
    if (!path) return "";
    setModelPath(path);
    setModelInfo(await api.classifierModelInfo(path));
    setResults(new Map());
    setResultText("Model loaded. Run classification on current, selected, or visible images.");
    return path;
  }, []);

  const classifyPaths = useCallback(
    async (paths: string[]) => {
      if (!datasetRoot || !paths.length) return;
      setRunning(true);
      setResultText(`Classifying ${paths.length} image(s) on CPU...`);
      try {
        let path = modelPath;
        if (!path) {
          path = await chooseModel();
          if (!path) return;
        }
        const payload = await api.classifyDatasetImages(datasetRoot, path, paths, topK);
        if (payload.model) setModelInfo(payload.model);
        setResults((current) => {
          const next = new Map(current);
          for (const item of payload.results || []) next.set(item.relativePath, item);
          return next;
        });
        const errorLines = (payload.errors || [])
          .slice(0, 6)
          .map((item) => `ERR ${item.relativePath}: ${item.error}`);
        setResultText(
          [`Batch: ${(payload.results || []).length} done, ${(payload.errors || []).length} error(s).`, ...errorLines].join("\n")
        );
      } finally {
        setRunning(false);
      }
    },
    [chooseModel, datasetRoot, modelPath, topK]
  );

  const modelStatus = modelPath
    ? `${modelPath.split(/[\\/]/).pop()}${modelInfo?.classes?.length ? ` | ${modelInfo.classes.length} classes` : ""}`
    : "No ONNX model";

  const formatPrediction = useCallback((prediction: { classId: number; name: string; confidence: number }) => {
    return `${prediction.classId}: ${prediction.name} ${(prediction.confidence * 100).toFixed(1)}%`;
  }, []);

  const resultForPair = useCallback(
    (pair: DatasetPair | null) => (pair ? results.get(pair.imagePath) || null : null),
    [results]
  );

  const updateCurrentResultText = useCallback(
    (pair: DatasetPair | null) => {
      const current = pair ? results.get(pair.imagePath) : null;
      const lines: string[] = [];
      if (current?.top) {
        lines.push(`Current: ${formatPrediction(current.top)}`);
        for (const prediction of (current.predictions || []).slice(1)) {
          lines.push(`  ${formatPrediction(prediction)}`);
        }
      } else if (modelPath) {
        lines.push("Current: not classified yet.");
      } else {
        lines.push("Load a best.onnx classifier, then run CPU classification on dataset images.");
      }
      setResultText(lines.join("\n"));
    },
    [formatPrediction, modelPath, results]
  );

  return {
    modelStatus,
    running,
    topK,
    resultText,
    results,
    setTopK,
    chooseModel,
    classifyPaths,
    resultForPair,
    updateCurrentResultText
  };
}
