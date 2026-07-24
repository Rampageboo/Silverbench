import { describe, expect, it } from "vitest";
import { validateDoc, type UiOrchestrationDoc } from "./schema";

const canonical: UiOrchestrationDoc = {
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
            title: {
              kind: "text",
              relRect: [0.14, 0.12, 0.86, 0.27],
              phraseTable: "zzz/errands@1"
            },
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

function cloneDoc(): any {
  return structuredClone(canonical);
}

function expectInvalid(doc: unknown, message: string) {
  const result = validateDoc(doc);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(
    result.errors.some((error) => error.includes(message)),
    result.errors.join("\n")
  ).toBe(true);
}

describe("UI Orchestrator schema v1 validator", () => {
  it("accepts the locked canonical example end-to-end", () => {
    expect(validateDoc(canonical)).toEqual({ ok: true });
  });

  it("rejects unknown fields", () => {
    const doc = cloneDoc();
    doc.pages[0].mystery = true;
    expectInvalid(doc, "mystery is an unknown field");
  });

  it("rejects relRect components outside [-1, 2] and inverted coordinates", () => {
    const outOfRange = cloneDoc();
    outOfRange.pages[0].elements.action_card.children.title.relRect = [-1.1, 0, 1, 1];
    expectInvalid(outOfRange, "must be in [-1, 2]");

    const inverted = cloneDoc();
    inverted.pages[0].elements.action_card.children.title.relRect = [0.8, 0, 0.2, 1];
    expectInvalid(inverted, "x0 < x1");
  });

  it("rejects nonexistent and non-container parents", () => {
    const missing = cloneDoc();
    missing.pages[0].elements.action_card.in = "missing";
    expectInvalid(missing, "references nonexistent element");

    const nonContainer = cloneDoc();
    nonContainer.pages[0].elements.label = { kind: "text", detClass: "label" };
    nonContainer.pages[0].elements.action_card.in = "label";
    expectInvalid(nonContainer, "must reference a container");
  });

  it("rejects a page-root element without detClass", () => {
    const doc = cloneDoc();
    delete doc.pages[0].elements.errands_container.detClass;
    expectInvalid(doc, "is page-root and must have detClass");
  });

  it("rejects a child with neither relRect nor detClass", () => {
    const doc = cloneDoc();
    delete doc.pages[0].elements.action_card.children.title.relRect;
    expectInvalid(doc, "must have exactly one location strategy");
  });

  it("rejects trigger minConfidence outside (0, 1]", () => {
    const doc = cloneDoc();
    doc.pages[0].trigger.minConfidence = 0;
    expectInvalid(doc, "minConfidence must be in (0, 1]");
  });

  it("rejects malformed phrase-table references", () => {
    const doc = cloneDoc();
    doc.pages[0].elements.action_card.children.title.phraseTable = "errands";
    expectInvalid(doc, "must match <namespace>/<name>@<integer-version>");
  });

  it("rejects flows with zero or two Start nodes", () => {
    const zero = cloneDoc();
    zero.flows[0].nodes = zero.flows[0].nodes.filter((node: any) => node.kind !== "Start");
    zero.flows[0].edges = zero.flows[0].edges.filter((edge: any) => edge.from !== "start");
    expectInvalid(zero, "exactly one Start node; found 0");

    const two = cloneDoc();
    two.flows[0].nodes.push({ id: "start2", kind: "Start" });
    two.flows[0].edges.push({ from: "start2", to: "seeErrands", on: "Next" });
    expectInvalid(two, "exactly one Start node; found 2");
  });

  it("requires all three Branch outcomes", () => {
    const doc = cloneDoc();
    doc.flows[0].edges = doc.flows[0].edges.filter(
      (edge: any) => !(edge.from === "hasCoffee" && edge.on === "Indeterminate")
    );
    expectInvalid(doc, "requires exactly one Indeterminate edge; found 0");
  });

  it("rejects edges into Start and out of End", () => {
    const intoStart = cloneDoc();
    intoStart.flows[0].edges[0].to = "start";
    expectInvalid(intoStart, "may not target a Start node");

    const outOfEnd = cloneDoc();
    outOfEnd.flows[0].edges.push({ from: "done", to: "nothing", on: "Next" });
    expectInvalid(outOfEnd, "may not originate from an End node");
  });

  it("rejects unreachable nodes", () => {
    const doc = cloneDoc();
    doc.flows[0].nodes.push({ id: "orphan", kind: "End", outcome: "Aborted" });
    expectInvalid(doc, "is unreachable from Start");
  });

  it("rejects ElementRef.element names absent from the observed page", () => {
    const doc = cloneDoc();
    doc.flows[0].nodes.find((node: any) => node.id === "hasCoffee").condition.target.element = "missing";
    expectInvalid(doc, "does not exist in observed page");
  });
});
