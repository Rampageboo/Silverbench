import { describe, expect, it } from "vitest";
import { parseVoiceCommand } from "./voiceCommandParser";

describe("parseVoiceCommand", () => {
  it("requires a wake word by default", () => {
    expect(parseVoiceCommand("下一帧")).toBeNull();
    expect(parseVoiceCommand("工作台 下一帧")?.command).toEqual({ type: "video.seekBy", seconds: 0.1 });
  });

  it("parses Chinese navigation amounts", () => {
    expect(parseVoiceCommand("工作台 向后两秒")?.command).toEqual({ type: "video.seekBy", seconds: 2 });
    expect(parseVoiceCommand("工作台 向前一秒")?.command).toEqual({ type: "video.seekBy", seconds: -1 });
  });

  it("parses annotation and class commands", () => {
    expect(parseVoiceCommand("标注助手 复制上一帧的框")?.command).toEqual({ type: "video.copyPreviousBoxes" });
    expect(parseVoiceCommand("yolo 标记为空帧")?.command).toEqual({ type: "video.markReviewed" });
    expect(parseVoiceCommand("workbench 选择类别三")?.command).toEqual({ type: "video.selectClass", classId: 3 });
  });

  it("marks destructive commands", () => {
    const result = parseVoiceCommand("工作台 清除当前帧记录");
    expect(result?.command).toEqual({ type: "video.clearFrameRecord" });
    expect(result?.destructive).toBe(true);
  });

  it("can parse without a wake word in push-to-talk mode", () => {
    expect(parseVoiceCommand("next frame", { requireWakeWord: false })?.command).toEqual({
      type: "video.seekBy",
      seconds: 0.1
    });
  });
});
