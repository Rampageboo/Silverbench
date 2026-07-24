import { describe, expect, it } from "vitest";
import { interpret } from "../previewInterpreter";
import { validateDoc, type Predictions, type UiOrchestrationDoc } from "../schema";
import coffeeMap from "./coffee_errand/map.json";
import coffeeCases from "./coffee_errand/cases.json";

// Golden conformance suite (schema §14 / plan §6). Each case is neutral JSON:
// a map (UiOrchestrationDoc) + Predictions + the expected DecisionResult. This
// editor's previewInterpreter and AutoHoyo's executor must both pass the same
// cases — that shared suite is what keeps the two interpreters from drifting.

type GoldenCase = {
  name: string;
  description?: string;
  predictions: Predictions;
  expected: {
    outcome: string;
    intended?: { element: string; point: [number, number] };
    trace: string[];
  };
};
type GoldenSuite = { schemaVersion: string; map: string; flowId: string; cases: GoldenCase[] };

const suites: { doc: UiOrchestrationDoc; suite: GoldenSuite }[] = [
  { doc: coffeeMap as UiOrchestrationDoc, suite: coffeeCases as unknown as GoldenSuite }
];

describe("UI Orchestrator golden conformance", () => {
  for (const { doc, suite } of suites) {
    it(`map for ${suite.flowId} is valid against schema 1.0`, () => {
      expect(validateDoc(doc)).toEqual({ ok: true });
    });

    for (const golden of suite.cases) {
      it(`${suite.flowId} · ${golden.name} → ${golden.expected.outcome}`, () => {
        const result = interpret(doc, golden.predictions, suite.flowId);
        expect(result.outcome).toBe(golden.expected.outcome);
        expect(result.trace).toEqual(golden.expected.trace);
        if (golden.expected.intended) {
          expect(result.intended?.element).toBe(golden.expected.intended.element);
          expect(result.intended?.point).toEqual(golden.expected.intended.point);
        } else {
          expect(result.intended).toBeUndefined();
        }
      });
    }
  }
});
