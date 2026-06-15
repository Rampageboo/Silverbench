import { describe, expect, it } from "vitest";
import {
  classificationClassNameForPath,
  classDisplay,
  ext,
  findPairs,
  inferDatasetTask,
  labelPathFor,
  naturalCompare,
  parseClassNameValue,
  parseLabels,
  resolveClassificationTargetClass
} from "./datasetCore";

describe("ext and naturalCompare", () => {
  it("extracts lowercase extension", () => {
    expect(ext("images/a.JPG")).toBe(".jpg");
    expect(ext("noext")).toBe("");
  });

  it("sorts paths with numeric awareness", () => {
    expect(naturalCompare("img2.jpg", "img10.jpg")).toBeLessThan(0);
    expect(naturalCompare("img10.jpg", "img2.jpg")).toBeGreaterThan(0);
  });
});

describe("parseLabels", () => {
  it("parses valid YOLO lines", () => {
    const text = "0 0.5 0.5 0.2 0.3\n1 0.1 0.2 0.3 0.4\n";
    expect(parseLabels(text)).toEqual([
      { classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.3 },
      { classId: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
    ]);
  });

  it("skips malformed lines", () => {
    expect(parseLabels("bad line\n0 0.5 0.5 0.2 0.3\n")).toHaveLength(1);
    expect(parseLabels("0 0.5 0.5\n")).toHaveLength(0);
  });
});

describe("parseClassNameValue", () => {
  it("parses quoted JSON names", () => {
    expect(parseClassNameValue('"cat"')).toBe("cat");
    expect(parseClassNameValue("'dog'")).toBe("dog");
  });

  it("strips inline comments and keeps plain text", () => {
    expect(parseClassNameValue("bird # comment")).toBe("bird");
  });
});

describe("classificationClassNameForPath", () => {
  it("reads class folder under train/val/test splits", () => {
    expect(classificationClassNameForPath("train/cats/img.jpg")).toBe("cats");
    expect(classificationClassNameForPath("val/dogs/x.png")).toBe("dogs");
  });

  it("reads top-level class folder when not under images/labels", () => {
    expect(classificationClassNameForPath("birds/a.jpg")).toBe("birds");
  });

  it("returns empty for shallow paths", () => {
    expect(classificationClassNameForPath("solo.jpg")).toBe("");
  });
});

describe("inferDatasetTask", () => {
  it("prefers detect when images/ or labels/ layout exists", () => {
    expect(inferDatasetTask(new Set(["images/train/a.jpg", "labels/train/a.txt"]))).toBe("detect");
  });

  it("detects classify layout from class folders", () => {
    expect(inferDatasetTask(new Set(["train/cats/a.jpg", "train/dogs/b.jpg"]))).toBe("classify");
  });

  it("defaults to detect when layout is ambiguous", () => {
    expect(inferDatasetTask(new Set(["readme.txt"]))).toBe("detect");
  });
});

describe("labelPathFor and findPairs", () => {
  const filePaths = new Set([
    "images/train/a.jpg",
    "labels/train/a.txt",
    "images/val/b.png",
    "train/cats/c.jpg"
  ]);

  it("resolves label path candidates for detect images", () => {
    expect(labelPathFor("images/train/a.jpg", filePaths, "")).toBe("labels/train/a.txt");
  });

  it("builds detect pairs with label paths", () => {
    const pairs = findPairs(filePaths, "detect");
    const trainPair = pairs.find((pair) => pair.imagePath === "images/train/a.jpg");
    expect(trainPair?.labelPath).toBe("labels/train/a.txt");
    expect(trainPair?.className).toBe("");
  });

  it("builds classify pairs without label paths", () => {
    const pairs = findPairs(new Set(["train/cats/c.jpg"]), "classify");
    expect(pairs).toHaveLength(1);
    expect(pairs[0].labelPath).toBeNull();
    expect(pairs[0].className).toBe("cats");
  });
});

describe("classDisplay and resolveClassificationTargetClass", () => {
  const classNames = new Map<number, string>([
    [0, "cat"],
    [1, "dog"]
  ]);

  it("shows mapped class name or fallback", () => {
    expect(classDisplay(classNames, 0)).toBe("cat");
    expect(classDisplay(classNames, 9)).toBe("class 9");
  });

  it("matches numeric and name inputs", () => {
    expect(resolveClassificationTargetClass("1", classNames)).toEqual({
      folderName: "dog",
      classId: 1,
      matched: true
    });
    expect(resolveClassificationTargetClass("cat", classNames)).toEqual({
      folderName: "cat",
      classId: 0,
      matched: true
    });
  });

  it("returns unmatched folder name for unknown labels", () => {
    expect(resolveClassificationTargetClass("unknown", classNames)).toEqual({
      folderName: "unknown",
      classId: null,
      matched: false
    });
    expect(resolveClassificationTargetClass("", classNames)).toEqual({
      folderName: "",
      classId: null,
      matched: false
    });
  });
});
