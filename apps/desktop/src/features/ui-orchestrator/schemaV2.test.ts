import { describe, expect, it } from "vitest";
import coffee from "./golden/v2/coffee-completion.json";
import farm from "./golden/v2/farm-single-run.json";
import contract from "./golden/v2/temporal-contract.json";
import { validateDocV2, type UiOrchestrationDocV2 } from "./schemaV2";

function clone(value: unknown) {
  return structuredClone(value) as Record<string, unknown>;
}

describe("UI Orchestrator schema 2.0", () => {
  it.each([
    ["coffee completion", coffee],
    ["farm single run", farm],
    ["temporal contract", contract]
  ])("accepts the %s golden map", (_name, doc) => {
    expect(validateDocV2(doc)).toEqual({ ok: true });
  });

  it("rejects a literal key in place of a namespaced logical input command", () => {
    const doc = clone(coffee) as unknown as UiOrchestrationDocV2;
    const act = doc.flows[0].nodes.find((node) => node.kind === "Act");
    if (!act || act.kind !== "Act") throw new Error("golden Act node missing");
    act.intent = { type: "input", command: "F" };

    const result = validateDocV2(doc);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "doc.flows[0].nodes[2].intent.command must be a namespaced logical command."
      );
    }
  });

  it("rejects terminal evidence that does not describe the direct causal edge", () => {
    const doc = clone(coffee) as unknown as UiOrchestrationDocV2;
    const done = doc.flows[0].nodes.find((node) => node.id === "done");
    if (!done || done.kind !== "End") throw new Error("golden End node missing");
    done.evidence = {
      source: "actionResult",
      nodeId: "invokeCompletion",
      status: "Failed"
    };

    const result = validateDocV2(doc);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        'doc.flows[0].nodes[3].evidence must describe the direct transition into End "done".'
      );
      expect(result.errors).toContain(
        "doc.flows[0].nodes[3].evidence is not permitted for outcome Completed."
      );
    }
  });

  it("rejects retry policy fields because retry remains adapter/runtime-owned in v0", () => {
    const doc = clone(coffee) as unknown as UiOrchestrationDocV2;
    const act = doc.flows[0].nodes.find((node) => node.kind === "Act") as unknown as Record<string, unknown>;
    act.retry = { maxAttempts: 3 };

    const result = validateDocV2(doc);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("doc.flows[0].nodes[2].retry is an unknown field.");
    }
  });

  it("rejects a parameter reference that is not declared by the document", () => {
    const doc = clone(farm) as unknown as UiOrchestrationDocV2;
    const act = doc.flows[0].nodes.find((node) => node.id === "invokeRun");
    if (!act || act.kind !== "Act" || act.intent.type !== "invoke") {
      throw new Error("golden invoke node missing");
    }
    act.intent.arguments = { activityId: { parameter: "missingParameter" } };

    const result = validateDocV2(doc);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "doc.flows[0].nodes[2].intent.arguments.activityId.parameter must reference a declared parameter."
      );
    }
  });
});
