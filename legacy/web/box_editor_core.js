function boxEditorClamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function boxEditorBoxToImageRect(box, displayRect) {
  if (!box || !displayRect) return null;
  const imageW = displayRect.imageW;
  const imageH = displayRect.imageH;
  return {
    x1: Math.round((box.x - box.w / 2) * imageW),
    y1: Math.round((box.y - box.h / 2) * imageH),
    x2: Math.round((box.x + box.w / 2) * imageW),
    y2: Math.round((box.y + box.h / 2) * imageH)
  };
}

function boxEditorRectToBox(rect, classId, displayRect) {
  const imageW = displayRect.imageW;
  const imageH = displayRect.imageH;
  return {
    classId: Number.isFinite(classId) ? classId : 0,
    x: boxEditorClamp01(((rect.x1 + rect.x2) / 2) / imageW),
    y: boxEditorClamp01(((rect.y1 + rect.y2) / 2) / imageH),
    w: boxEditorClamp01((rect.x2 - rect.x1) / imageW),
    h: boxEditorClamp01((rect.y2 - rect.y1) / imageH)
  };
}

function boxEditorImagePointToCanvas(point, displayRect) {
  return {
    x: displayRect.x + point.x * displayRect.w / displayRect.imageW,
    y: displayRect.y + point.y * displayRect.h / displayRect.imageH
  };
}

function boxEditorImageRectToCanvasRect(rect, displayRect) {
  const a = boxEditorImagePointToCanvas({ x: rect.x1, y: rect.y1 }, displayRect);
  const b = boxEditorImagePointToCanvas({ x: rect.x2, y: rect.y2 }, displayRect);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

function boxEditorCanvasPixelsToImagePixels(px, displayRect) {
  if (!displayRect?.w || !displayRect?.h) return px;
  return px * Math.max(displayRect.imageW / displayRect.w, displayRect.imageH / displayRect.h);
}

function boxEditorPointInRect(point, rect, pad = 0) {
  return point.x >= Math.min(rect.x1, rect.x2) - pad
    && point.x <= Math.max(rect.x1, rect.x2) + pad
    && point.y >= Math.min(rect.y1, rect.y2) - pad
    && point.y <= Math.max(rect.y1, rect.y2) + pad;
}

function boxEditorRectArea(rect) {
  return Math.abs((rect.x2 - rect.x1) * (rect.y2 - rect.y1));
}

function boxEditorBestHitIndexAtImagePoint(point, boxes, displayRect, pad = 0) {
  let bestIndex = -1;
  let bestArea = Infinity;
  for (let index = boxes.length - 1; index >= 0; index--) {
    const rect = boxEditorBoxToImageRect(boxes[index], displayRect);
    if (!rect || !boxEditorPointInRect(point, rect, pad)) continue;
    const area = Math.max(1, boxEditorRectArea(rect));
    if (area < bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function boxEditorBestHitIndexAtCanvasPoint(point, boxes, displayRect, pad = 3) {
  let bestIndex = -1;
  let bestArea = Infinity;
  for (let index = boxes.length - 1; index >= 0; index--) {
    const imageRect = boxEditorBoxToImageRect(boxes[index], displayRect);
    if (!imageRect) continue;
    const rect = boxEditorImageRectToCanvasRect(imageRect, displayRect);
    if (!boxEditorPointInRect(point, rect, pad)) continue;
    const area = Math.max(1, boxEditorRectArea(rect));
    if (area < bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function boxEditorHandlePoints(rect) {
  const midX = (rect.x1 + rect.x2) / 2;
  const midY = (rect.y1 + rect.y2) / 2;
  return [
    ["nw", rect.x1, rect.y1], ["ne", rect.x2, rect.y1],
    ["sw", rect.x1, rect.y2], ["se", rect.x2, rect.y2],
    ["n", midX, rect.y1], ["s", midX, rect.y2],
    ["w", rect.x1, midY], ["e", rect.x2, midY]
  ];
}

function boxEditorRectInterior(rect, inset) {
  const left = Math.min(rect.x1, rect.x2);
  const right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2);
  const bottom = Math.max(rect.y1, rect.y2);
  return { x1: left + inset, y1: top + inset, x2: right - inset, y2: bottom - inset };
}

function boxEditorHitEdgeAtPoint(point, rect, tolerance) {
  const left = Math.min(rect.x1, rect.x2);
  const right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2);
  const bottom = Math.max(rect.y1, rect.y2);
  const nearX = point.x >= left - tolerance && point.x <= right + tolerance;
  const nearY = point.y >= top - tolerance && point.y <= bottom + tolerance;
  const candidates = [];
  if (nearX) {
    candidates.push(["n", Math.abs(point.y - top)]);
    candidates.push(["s", Math.abs(point.y - bottom)]);
  }
  if (nearY) {
    candidates.push(["w", Math.abs(point.x - left)]);
    candidates.push(["e", Math.abs(point.x - right)]);
  }
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0]?.[1] <= tolerance ? candidates[0][0] : null;
}

function boxEditorHitHandleAtCanvasPoint(point, imageRect, displayRect) {
  const rect = boxEditorImageRectToCanvasRect(imageRect, displayRect);
  const minEdge = Math.min(Math.abs(rect.x2 - rect.x1), Math.abs(rect.y2 - rect.y1));
  const cornerTolerance = minEdge < 24 ? Math.max(3, Math.min(6, minEdge / 3)) : 11;
  const edgeTolerance = minEdge < 24 ? Math.max(2, Math.min(4, minEdge / 4)) : 8;
  let best = null;
  let bestDistance = Infinity;
  for (const [name, x, y] of boxEditorHandlePoints(rect)) {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= cornerTolerance && distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  if (best) return best;
  const interior = boxEditorRectInterior(rect, edgeTolerance + 2);
  if (interior.x2 > interior.x1 && interior.y2 > interior.y1 && boxEditorPointInRect(point, interior)) return null;
  return boxEditorHitEdgeAtPoint(point, rect, edgeTolerance);
}

function boxEditorHitHandleAtImagePoint(point, rect, displayRect) {
  const w = Math.max(1, rect.x2 - rect.x1);
  const h = Math.max(1, rect.y2 - rect.y1);
  const edge = Math.max(1, Math.min(
    Math.round(boxEditorCanvasPixelsToImagePixels(6, displayRect)),
    Math.floor(Math.min(w, h) / 4)
  ));
  const nearN = point.y >= rect.y1 && point.y - rect.y1 <= edge;
  const nearS = point.y <= rect.y2 && rect.y2 - point.y <= edge;
  const nearW = point.x >= rect.x1 && point.x - rect.x1 <= edge;
  const nearE = point.x <= rect.x2 && rect.x2 - point.x <= edge;
  if (!nearN && !nearS && !nearW && !nearE) return "move";
  if (nearN && nearW) return "nw";
  if (nearN && nearE) return "ne";
  if (nearS && nearW) return "sw";
  if (nearS && nearE) return "se";
  if (nearN) return "n";
  if (nearS) return "s";
  if (nearW) return "w";
  if (nearE) return "e";
  return "move";
}

function boxEditorNormalizeRectInPlace(rect) {
  if (rect.x1 > rect.x2) [rect.x1, rect.x2] = [rect.x2, rect.x1];
  if (rect.y1 > rect.y2) [rect.y1, rect.y2] = [rect.y2, rect.y1];
}

function boxEditorMoveRect(rect, dx, dy, maxW, maxH) {
  const w = rect.x2 - rect.x1;
  const h = rect.y2 - rect.y1;
  rect.x1 = Math.max(0, Math.min(maxW - w, rect.x1 + dx));
  rect.y1 = Math.max(0, Math.min(maxH - h, rect.y1 + dy));
  rect.x2 = rect.x1 + w;
  rect.y2 = rect.y1 + h;
}

function boxEditorResizeRectByHandle(rect, handle, dx, dy, maxW, maxH, minSize = 2) {
  if (handle.includes("w")) rect.x1 = Math.max(0, Math.min(rect.x2 - minSize, rect.x1 + dx));
  if (handle.includes("e")) rect.x2 = Math.min(maxW, Math.max(rect.x1 + minSize, rect.x2 + dx));
  if (handle.includes("n")) rect.y1 = Math.max(0, Math.min(rect.y2 - minSize, rect.y1 + dy));
  if (handle.includes("s")) rect.y2 = Math.min(maxH, Math.max(rect.y1 + minSize, rect.y2 + dy));
}

function boxEditorResizeRectByEdges(rect, handles, grow, step, maxW, maxH, minSize = 2) {
  if (handles.includes("w")) rect.x1 = grow
    ? Math.max(0, rect.x1 - step)
    : Math.min(rect.x2 - minSize, rect.x1 + step);
  if (handles.includes("e")) rect.x2 = grow
    ? Math.min(maxW, rect.x2 + step)
    : Math.max(rect.x1 + minSize, rect.x2 - step);
  if (handles.includes("n")) rect.y1 = grow
    ? Math.max(0, rect.y1 - step)
    : Math.min(rect.y2 - minSize, rect.y1 + step);
  if (handles.includes("s")) rect.y2 = grow
    ? Math.min(maxH, rect.y2 + step)
    : Math.max(rect.y1 + minSize, rect.y2 - step);
}
