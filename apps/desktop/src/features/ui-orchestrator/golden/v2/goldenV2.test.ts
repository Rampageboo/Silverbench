import { describe, expect, it } from "vitest";
import { TemporalInterpreter, type TemporalTraceRecord } from "../../temporalInterpreter";
import type { CausalEvidence, TemporalEvent, UiOrchestrationDocV2 } from "../../schemaV2";
import casesJson from "./cases.json";
import coffeeJson from "./coffee-completion.json";
import farmJson from "./farm-single-run.json";
import contractJson from "./temporal-contract.json";

type GoldenCheckpoint = {
  afterEvent: number;
  status: string;
  currentNodeId: string;
  terminal: boolean;
};

type GoldenCase = {
  name: string;
  map: string;
  flowId: string;
  events: TemporalEvent[];
  checkpoints?: GoldenCheckpoint[];
  expected: {
    status: string;
    currentNodeId: string;
    emittedRequestIds: string[];
    terminalEvidence?: CausalEvidence | { source: "abort"; reason: string };
    trace?: TemporalTraceRecord[];
  };
};

type GoldenSuite = {
  schemaVersion: string;
  cases: GoldenCase[];
};

const suite = casesJson as unknown as GoldenSuite;
const maps: Record<string, UiOrchestrationDocV2> = {
  "coffee-completion.json": coffeeJson as unknown as UiOrchestrationDocV2,
  "farm-single-run.json": farmJson as unknown as UiOrchestrationDocV2,
  "temporal-contract.json": contractJson as unknown as UiOrchestrationDocV2
};

describe("schema 2.0 shared temporal golden traces", () => {
  it('uses the independently versioned "2.0" conformance format', () => {
    expect(suite.schemaVersion).toBe("2.0");
  });

  for (const golden of suite.cases) {
    it(golden.name, () => {
      const doc = maps[golden.map];
      expect(doc, `unknown golden map ${golden.map}`).toBeDefined();
      const interpreter = new TemporalInterpreter(doc, golden.flowId);
      const emittedRequestIds: string[] = [];
      let result = interpreter.getSnapshot();

      golden.events.forEach((event, index) => {
        result = interpreter.dispatch(event);
        emittedRequestIds.push(...result.emitted.map((request) => request.requestId));
        const checkpoint = golden.checkpoints?.find((candidate) => candidate.afterEvent === index + 1);
        if (checkpoint) {
          expect(result.status).toBe(checkpoint.status);
          expect(result.currentNodeId).toBe(checkpoint.currentNodeId);
          expect(Boolean(result.terminal)).toBe(checkpoint.terminal);
        }
      });

      expect(result.status).toBe(golden.expected.status);
      expect(result.currentNodeId).toBe(golden.expected.currentNodeId);
      expect(emittedRequestIds).toEqual(golden.expected.emittedRequestIds);
      if (golden.expected.terminalEvidence) {
        expect(result.terminal?.evidence).toEqual(golden.expected.terminalEvidence);
      } else {
        expect(result.terminal).toBeUndefined();
      }
      if (golden.expected.trace) expect(result.trace).toEqual(golden.expected.trace);
    });
  }
});
