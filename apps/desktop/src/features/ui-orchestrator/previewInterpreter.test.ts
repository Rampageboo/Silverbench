import { describe, expect, it } from "vitest";
import { interpret } from "./previewInterpreter";
import type { Predictions, UiOrchestrationDoc } from "./schema";

// The locked canonical coffee-errand map (schema §14).
const doc: UiOrchestrationDoc = {
  schemaVersion: "1.0",
  game: "Zenless_Zone_Zero",
  pages: [
    {
      id: "Schedule.Errands",
      trigger: { clf: "Schedule_Errands", minConfidence: 0.9 },
      guard: { require: ["errands_container"] },
      elements: {
        errands_container: { kind: "container", detClass: "errands_container" },
        action_card: {
          kind: "container",
          in: "errands_container",
          detClass: "errand_card",
          repeat: { control: "horizontal_scroll" },
          children: {
            title: { kind: "text", relRect: [0.14, 0.12, 0.86, 0.27], phraseTable: "zzz/errands@1" },
            go_button: {
              kind: "button",
              detClass: "go_button",
              associate: { rule: "xColumn", verticalToleranceRatio: 0.2 }
            }
          }
        }
      }
    }
  ],
  flows: [
    {
      id: "daily.coffee_errand",
      nodes: [
        { id: "start", kind: "Start" },
        { id: "seeErrands", kind: "Observe", page: "Schedule.Errands", timeoutMs: 8000 },
        {
          id: "hasCoffee",
          kind: "Branch",
          condition: {
            type: "elementFound",
            target: {
              element: "action_card",
              select: {
                by: "ocrMatch",
                child: "title",
                phraseTable: "zzz/errands@1",
                phrase: "Try 1 coffee",
                minScore: 0.78
              }
            }
          }
        },
        {
          id: "clickGo",
          kind: "Act",
          intent: {
            type: "click",
            target: {
              element: "action_card",
              select: {
                by: "ocrMatch",
                child: "title",
                phraseTable: "zzz/errands@1",
                phrase: "Try 1 coffee",
                minScore: 0.78
              },
              child: "go_button"
            }
          }
        },
        { id: "done", kind: "End", outcome: "Completed" },
        { id: "nothing", kind: "End", outcome: "NothingToDo" },
        { id: "notFound", kind: "End", outcome: "Failed" }
      ],
      edges: [
        { from: "start", to: "seeErrands", on: "Next" },
        { from: "seeErrands", to: "hasCoffee", on: "Next" },
        { from: "seeErrands", to: "notFound", on: "Timeout" },
        { from: "hasCoffee", to: "clickGo", on: "True" },
        { from: "hasCoffee", to: "nothing", on: "False" },
        { from: "hasCoffee", to: "nothing", on: "Indeterminate" },
        { from: "clickGo", to: "done", on: "Next" }
      ]
    }
  ]
};

// Two cards side by side; card A is the coffee errand.
const cardA: [number, number, number, number] = [200, 250, 600, 650];
const cardB: [number, number, number, number] = [700, 250, 1100, 650];
const goA: [number, number, number, number] = [300, 660, 500, 700];
const goB: [number, number, number, number] = [800, 660, 1000, 700];

function predictions(withOcr: boolean, clfConf = 0.95): Predictions {
  return {
    imageSize: [1600, 900],
    clf: { label: "Schedule_Errands", conf: clfConf },
    det: [
      { class: "errands_container", box: [100, 200, 1500, 700], conf: 0.99 },
      { class: "errand_card", box: cardA, conf: 0.95 },
      { class: "errand_card", box: cardB, conf: 0.93 },
      { class: "go_button", box: goA, conf: 0.9 },
      { class: "go_button", box: goB, conf: 0.9 }
    ],
    ...(withOcr
      ? {
          ocr: [
            { box: [270, 300, 530, 350], text: "Try 1 coffee", conf: 0.95 },
            { box: [770, 300, 1030, 350], text: "Buy potions", conf: 0.95 }
          ]
        }
      : {})
  };
}

describe("previewInterpreter — canonical coffee flow", () => {
  it("reaches Completed and intends the coffee card's GO button when OCR confirms it", () => {
    const result = interpret(doc, predictions(true));
    expect(result.outcome).toBe("Completed");
    expect(result.intended?.element).toBe("go_button");
    expect(result.intended?.box).toEqual(goA);
    expect(result.intended?.point).toEqual([400, 680]);
    expect(result.trace).toEqual(["start", "seeErrands", "hasCoffee", "clickGo", "done"]);
  });

  it("is fail-closed (NothingToDo via Indeterminate) when OCR is unavailable", () => {
    const result = interpret(doc, predictions(false));
    expect(result.outcome).toBe("NothingToDo");
    expect(result.trace).toEqual(["start", "seeErrands", "hasCoffee", "nothing"]);
    expect(result.intended).toBeUndefined();
  });

  it("times out to Failed when the classifier is not confident enough", () => {
    const result = interpret(doc, predictions(true, 0.5));
    expect(result.outcome).toBe("Failed");
    expect(result.trace).toEqual(["start", "seeErrands", "notFound"]);
  });

  it("does not select the wrong card: potions title does not match the coffee phrase", () => {
    const onlyPotions = predictions(true);
    onlyPotions.ocr = [{ box: [770, 300, 1030, 350], text: "Buy potions", conf: 0.95 }];
    const result = interpret(doc, onlyPotions);
    // coffee card title has no OCR read -> no instance matches -> absent -> False
    expect(result.outcome).toBe("NothingToDo");
    expect(result.trace).toEqual(["start", "seeErrands", "hasCoffee", "nothing"]);
  });
});
