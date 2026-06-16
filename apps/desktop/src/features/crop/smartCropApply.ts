import { readFileBase64, readTextFile, writeFileBase64, writeTextFile } from "../../api";
import type { LabelBox } from "../../api";
import {
  boxesToText,
  chooseSmartCropPlans,
  cropRunId,
  mimeFor,
  outputImageExtension,
  sanitizeCropFilename,
  smallPathHash,
  type SmartCropPlan,
  type SmartCropSettings
} from "./smartCropPlans";

export type SmartCropPair = {
  imagePath: string;
  labelPath: string | null;
  boxes: LabelBox[];
};

function canvasToBase64(canvas: HTMLCanvasElement, mime: string) {
  const dataUrl = canvas.toDataURL(mime);
  return dataUrl.split(",")[1] || "";
}

async function loadImageBitmap(datasetRoot: string, imagePath: string) {
  const base64 = await readFileBase64(datasetRoot, imagePath);
  const blob = await fetch(`data:${mimeFor(imagePath)};base64,${base64}`).then((r) => r.blob());
  return createImageBitmap(blob);
}

export async function loadPairBoxes(datasetRoot: string, pair: SmartCropPair) {
  if (pair.boxes.length) return pair.boxes;
  if (!pair.labelPath) return [];
  const text = await readTextFile(datasetRoot, pair.labelPath);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 5)
    .map((parts) => ({
      classId: Math.trunc(Number(parts[0])),
      x: Number(parts[1]),
      y: Number(parts[2]),
      w: Number(parts[3]),
      h: Number(parts[4])
    }))
    .filter((box) => !Number.isNaN(box.classId));
}

export async function previewSmartCropPlans(datasetRoot: string, pair: SmartCropPair, settings: SmartCropSettings) {
  const bitmap = await loadImageBitmap(datasetRoot, pair.imagePath);
  const boxes = await loadPairBoxes(datasetRoot, pair);
  const plans = chooseSmartCropPlans(bitmap.width, bitmap.height, boxes, settings);
  bitmap.close();
  return plans;
}

export async function cropPairIntoOutputs(
  datasetRoot: string,
  pair: SmartCropPair,
  settings: SmartCropSettings,
  runId: string,
  outputPrefix: string,
  trainLines: string[]
) {
  const bitmap = await loadImageBitmap(datasetRoot, pair.imagePath);
  const boxes = await loadPairBoxes(datasetRoot, pair);
  const plans = chooseSmartCropPlans(bitmap.width, bitmap.height, boxes, settings);
  if (!plans.length) {
    bitmap.close();
    return { crops: 0, boxes: 0 };
  }
  const extension = outputImageExtension(pair.imagePath);
  const mime = mimeFor(pair.imagePath);
  const stem = sanitizeCropFilename(pair.imagePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "image");
  const hash = smallPathHash(pair.imagePath);
  let keptBoxes = 0;

  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const canvas = document.createElement("canvas");
    canvas.width = plan.rect.w;
    canvas.height = plan.rect.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(bitmap, plan.rect.x, plan.rect.y, plan.rect.w, plan.rect.h, 0, 0, plan.rect.w, plan.rect.h);
    const name = `${stem}_${hash}_${runId}_crop${String(index + 1).padStart(2, "0")}`;
    const imagePath = `images/crops/${name}.${extension}`;
    const labelPath = `labels/crops/${name}.txt`;
    await writeFileBase64(datasetRoot, `${outputPrefix}/${imagePath}`, canvasToBase64(canvas, mime));
    await writeTextFile(datasetRoot, `${outputPrefix}/${labelPath}`, boxesToText(plan.boxes));
    trainLines.push(imagePath);
    keptBoxes += plan.boxes.length;
  }
  bitmap.close();
  return { crops: plans.length, boxes: keptBoxes };
}

export async function writeSmartCropDatasetFiles(
  datasetRoot: string,
  outputPrefix: string,
  trainLines: string[],
  classNames: Map<number, string>
) {
  await writeTextFile(datasetRoot, `${outputPrefix}/train.txt`, `${trainLines.join("\n")}${trainLines.length ? "\n" : ""}`);
  const classIds = [...new Set([...classNames.keys()])].sort((a, b) => a - b);
  const names = classIds.length
    ? classIds.map((id) => `  ${id}: ${JSON.stringify(classNames.get(id) || `class_${id}`)}`).join("\n")
    : '  0: "class_0"';
  await writeTextFile(datasetRoot, `${outputPrefix}/data.yaml`, `train: images/crops\nval: images/crops\nnames:\n${names}\n`);
}

export { cropRunId };

export function drawSmartCropPreview(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageW: number,
  imageH: number,
  plans: SmartCropPlan[]
) {
  ctx.clearRect(0, 0, imageW, imageH);
  ctx.drawImage(image, 0, 0, imageW, imageH);
  ctx.save();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.95)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  for (const plan of plans) {
    ctx.strokeRect(plan.rect.x, plan.rect.y, plan.rect.w, plan.rect.h);
  }
  ctx.restore();
}
