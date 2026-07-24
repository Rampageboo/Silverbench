import { describe, expect, it } from "vitest";
import { nextTrainingFilenames, nextTrainingStarCount } from "./trainPrepApi";

describe("next training candidates", () => {
  const rows = [
    { filename: "detect.jpg", next_train: "1", detect_enabled: "1", clf_enabled: "0" },
    { filename: "classify.jpg", next_train: true, clf_enabled: true, clf_class: "cat" },
    { filename: "disabled.jpg", next_train: "1", detect_enabled: "1", detect_export_enabled: "0" },
    { filename: "junk.jpg", next_train: "1", detect_enabled: "1", detect_junk: "1" },
    { filename: "plain.jpg", next_train: "0", detect_enabled: "1" },
  ];

  it("counts all starred images independently of task readiness", () => {
    expect(nextTrainingStarCount(rows)).toBe(4);
  });

  it("returns only detection-ready starred images", () => {
    expect(nextTrainingFilenames(rows, "detect")).toEqual(["detect.jpg"]);
  });

  it("returns only classification-ready starred images", () => {
    expect(nextTrainingFilenames(rows, "classify")).toEqual(["classify.jpg"]);
  });
});
