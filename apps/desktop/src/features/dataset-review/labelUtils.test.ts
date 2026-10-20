import { describe, expect, it } from "vitest";
import { boxesToText, resolveLabelPathForWrite } from "./labelUtils";
import type { DatasetPair } from "./datasetCore";

describe("boxesToText", () => {
  it("returns empty string for no boxes", () => {
    expect(boxesToText([])).toBe("");
  });

  it("serializes a single box with trailing newline", () => {
    expect(boxesToText([{ classId: 1, x: 0.5, y: 0.5, w: 0.2, h: 0.3 }])).toBe("1 0.5 0.5 0.2 0.3\n");
  });

  it("joins multiple boxes on separate lines", () => {
    const text = boxesToText([
      { classId: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      { classId: 2, x: 0.5, y: 0.6, w: 0.1, h: 0.1 }
    ]);
    expect(text).toBe("0 0.1 0.2 0.3 0.4\n2 0.5 0.6 0.1 0.1\n");
  });
});

describe("resolveLabelPathForWrite", () => {
  const pair: DatasetPair = {
    imagePath: "images/train/a.jpg",
    labelPath: null,
    classId: null,
    className: ""
  };

  it("returns empty for classify task", () => {
    expect(resolveLabelPathForWrite(pair, "classify")).toBe("");
  });

  it("prefers existing labelPath on detect task", () => {
    expect(resolveLabelPathForWrite({ ...pair, labelPath: "labels/train/a.txt" }, "detect")).toBe(
      "labels/train/a.txt"
    );
  });

  it("maps images/ prefix to labels/ for detect task", () => {
    expect(resolveLabelPathForWrite(pair, "detect")).toBe("labels/train/a.txt");
  });

  it("falls back to sibling txt for non-images paths", () => {
    expect(
      resolveLabelPathForWrite({ ...pair, imagePath: "custom/foo.png", labelPath: null }, "detect")
    ).toBe("custom/foo.txt");
  });
});
