import { describe, expect, it } from "vitest";
import { CommandArbiter } from "./commandArbiter";
import { createCommandEnvelope } from "./commands";

describe("CommandArbiter", () => {
  it("blocks commands until controls are armed", () => {
    const arbiter = new CommandArbiter();
    const blocked = arbiter.evaluate(
      createCommandEnvelope("voice", { type: "video.seekBy", seconds: 0.1 }, { createdAt: 1000 })
    );
    expect(blocked).toMatchObject({ accepted: false, reason: "disarmed" });

    expect(
      arbiter.evaluate(createCommandEnvelope("voice", { type: "controls.arm" }, { createdAt: 1100 })).accepted
    ).toBe(true);
    expect(
      arbiter.evaluate(createCommandEnvelope("voice", { type: "video.seekBy", seconds: 0.1 }, { createdAt: 1200 })).accepted
    ).toBe(true);
  });

  it("enforces confidence and cooldown", () => {
    const arbiter = new CommandArbiter({ initiallyArmed: true });
    expect(
      arbiter.evaluate(
        createCommandEnvelope("gesture", { type: "video.copyPreviousBoxes" }, { confidence: 0.4, createdAt: 1000 })
      )
    ).toMatchObject({ accepted: false, reason: "low-confidence" });

    expect(
      arbiter.evaluate(
        createCommandEnvelope("gesture", { type: "video.copyPreviousBoxes" }, { confidence: 0.95, createdAt: 1100 })
      ).accepted
    ).toBe(true);
    expect(
      arbiter.evaluate(
        createCommandEnvelope("gesture", { type: "video.copyPreviousBoxes" }, { confidence: 0.95, createdAt: 1500 })
      )
    ).toMatchObject({ accepted: false, reason: "cooldown" });
  });

  it("requires a repeated destructive command from the same source", () => {
    const arbiter = new CommandArbiter({ initiallyArmed: true, confirmationWindowMs: 3000 });
    const first = arbiter.evaluate(
      createCommandEnvelope("voice", { type: "video.clearFrameRecord" }, { confidence: 0.98, createdAt: 1000 })
    );
    expect(first).toMatchObject({ accepted: false, reason: "confirmation-required" });

    const wrongSource = arbiter.evaluate(
      createCommandEnvelope("gesture", { type: "video.clearFrameRecord" }, { confidence: 0.98, createdAt: 1500 })
    );
    expect(wrongSource).toMatchObject({ accepted: false, reason: "confirmation-required" });

    const confirmed = arbiter.evaluate(
      createCommandEnvelope("gesture", { type: "video.clearFrameRecord" }, { confidence: 0.98, createdAt: 1800 })
    );
    expect(confirmed.accepted).toBe(true);
  });
});
