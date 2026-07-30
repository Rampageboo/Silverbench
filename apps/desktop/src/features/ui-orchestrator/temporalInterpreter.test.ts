import { describe, expect, it } from "vitest";
import coffeeJson from "./golden/v2/coffee-completion.json";
import farmJson from "./golden/v2/farm-single-run.json";
import contractJson from "./golden/v2/temporal-contract.json";
import { TemporalInterpreter } from "./temporalInterpreter";
import type { FrameEvent, TemporalFrame, UiOrchestrationDocV2 } from "./schemaV2";

const coffee = coffeeJson as unknown as UiOrchestrationDocV2;
const farm = farmJson as unknown as UiOrchestrationDocV2;
const contract = contractJson as unknown as UiOrchestrationDocV2;

function frame(
  seq: number,
  atMs: number,
  clfLabel: string,
  detections: Array<{ class: string; box: [number, number, number, number]; conf: number }>,
  ocr: TemporalFrame["ocr"] = { status: "ok", value: [] }
): FrameEvent {
  return {
    type: "frame",
    seq,
    atMs,
    frame: {
      imageSize: [100, 100],
      clf: { status: "ok", value: { label: clfLabel, conf: 0.99 } },
      det: { status: "ok", value: detections },
      ocr
    }
  };
}

function coffeeFrame(seq: number, atMs: number) {
  return frame(seq, atMs, "Coffee_MissionScene", [
    { class: "mission_hud", box: [0, 0, 100, 20], conf: 0.99 }
  ]);
}

function readyFarmFrame(seq: number, atMs: number) {
  return frame(seq, atMs, "Farm_Ready", [{ class: "farm_start_button", box: [40, 70, 60, 90], conf: 0.99 }]);
}

function settlementFrame(seq: number, atMs: number) {
  return frame(seq, atMs, "Farm_Settlement", [
    { class: "farm_settlement_panel", box: [10, 10, 90, 90], conf: 0.99 }
  ]);
}

describe("schema 2.0 temporal golden semantics", () => {
  it("treats an absent frame as Indeterminate, resets stability, and eventually times out", () => {
    const interpreter = new TemporalInterpreter(coffee);

    expect(interpreter.dispatch({ type: "frame", seq: 1, atMs: 0 }).status).toBe("Running");
    expect(interpreter.dispatch(coffeeFrame(2, 100)).emitted).toEqual([]);
    // The absent frame reset stability, so the first good frame cannot satisfy
    // the two-consecutive-frame policy.
    expect(interpreter.dispatch({ type: "tick", atMs: 1001 }).terminal).toMatchObject({
      status: "Failed",
      nodeId: "missionTimeout",
      evidence: { source: "timeout", nodeId: "observeMission" }
    });
  });

  it("routes an explicitly missing OCR channel to Indeterminate, never False or Act", () => {
    const interpreter = new TemporalInterpreter(contract);
    const result = interpreter.dispatch(
      frame(
        1,
        0,
        "Contract_Ready",
        [
          { class: "ready_panel", box: [0, 0, 100, 100], conf: 0.99 },
          { class: "status_text", box: [20, 20, 80, 40], conf: 0.99 }
        ],
        { status: "missing", reason: "not-run" }
      )
    );

    expect(result.status).toBe("Running");
    expect(result.currentNodeId).toBe("waitForFreshFrame");
    expect(result.emitted).toEqual([]);
    expect(result.terminal).toBeUndefined();
    expect(result.trace).toContainEqual({
      type: "transition",
      from: "isReady",
      to: "waitForFreshFrame",
      on: "Indeterminate",
      atMs: 0
    });
  });

  it("ignores a stale action result without transitioning or re-emitting the action", () => {
    const interpreter = new TemporalInterpreter(coffee);
    interpreter.dispatch(coffeeFrame(1, 0));
    const issued = interpreter.dispatch(coffeeFrame(2, 100));
    expect(issued.emitted).toHaveLength(1);

    const stale = interpreter.dispatch({
      type: "actionResult",
      requestId: "some-other-request",
      atMs: 200,
      status: "Succeeded",
      code: "coffee_dry_run_completion_confirmed"
    });

    expect(stale.status).toBe("AwaitingAction");
    expect(stale.currentNodeId).toBe("invokeCompletion");
    expect(stale.emitted).toEqual([]);
    expect(stale.pendingAction?.requestId).toBe("zzz.coffee.complete.phase1:invokeCompletion:1");
    expect(stale.trace).toContainEqual({
      type: "diagnostic",
      code: "StaleActionResultIgnored",
      atMs: 200,
      detail: "requestId=some-other-request"
    });
  });

  it("takes the Act Timeout edge when no matching result arrives before its deadline", () => {
    const interpreter = new TemporalInterpreter(coffee);
    interpreter.dispatch(coffeeFrame(1, 0));
    interpreter.dispatch(coffeeFrame(2, 100));

    const result = interpreter.dispatch({ type: "tick", atMs: 5101 });

    expect(result.emitted).toEqual([]);
    expect(result.terminal).toMatchObject({
      status: "Failed",
      nodeId: "actionTimeout",
      evidence: { source: "timeout", nodeId: "invokeCompletion" }
    });
  });

  it("aborts globally, clears the pending action, and ignores later events", () => {
    const interpreter = new TemporalInterpreter(coffee);
    interpreter.dispatch(coffeeFrame(1, 0));
    interpreter.dispatch(coffeeFrame(2, 100));

    const aborted = interpreter.dispatch({
      type: "abort",
      atMs: 200,
      reason: "user-stop"
    });
    const after = interpreter.dispatch({ type: "tick", atMs: 10000 });

    expect(aborted.status).toBe("Aborted");
    expect(aborted.pendingAction).toBeUndefined();
    expect(aborted.terminal).toEqual({
      status: "Aborted",
      outcome: "Aborted",
      evidence: { source: "abort", reason: "user-stop" }
    });
    expect(after).toEqual({ ...aborted, emitted: [] });
  });

  it("does not complete or permit a farm run commit until settlement is stably confirmed", () => {
    const interpreter = new TemporalInterpreter(farm);
    interpreter.dispatch(readyFarmFrame(1, 0));
    const issued = interpreter.dispatch(readyFarmFrame(2, 100));
    const requestId = issued.emitted[0]?.requestId;
    expect(requestId).toBe("zzz.farm.single-run:invokeRun:1");

    const actionSucceeded = interpreter.dispatch({
      type: "actionResult",
      requestId: requestId!,
      atMs: 200,
      status: "Succeeded",
      code: "combat_finished"
    });
    const beforeSettlement = interpreter.dispatch({ type: "tick", atMs: 1000 });
    const firstSettlementFrame = interpreter.dispatch(settlementFrame(3, 1100));
    const confirmedSettlement = interpreter.dispatch(settlementFrame(4, 1300));

    expect(actionSucceeded.status).toBe("Running");
    expect(actionSucceeded.currentNodeId).toBe("observeSettlement");
    expect(beforeSettlement.terminal).toBeUndefined();
    expect(firstSettlementFrame.terminal).toBeUndefined();
    expect(confirmedSettlement.terminal).toMatchObject({
      status: "Completed",
      nodeId: "done",
      evidence: {
        source: "condition",
        nodeId: "confirmSettlement",
        outcome: "True"
      }
    });
  });
});
