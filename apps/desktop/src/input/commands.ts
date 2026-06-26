export type CommandSource = "voice" | "gesture" | "keyboard" | "ui";

export type WorkbenchCommand =
  | { type: "controls.arm" }
  | { type: "controls.disarm" }
  | { type: "video.seekBy"; seconds: number }
  | { type: "video.gotoReviewed"; direction: -1 | 1 }
  | { type: "video.copyPreviousBoxes" }
  | { type: "video.markReviewed" }
  | { type: "video.clearFrameRecord" }
  | { type: "video.selectClass"; classId: number }
  | { type: "pointer.move"; x: number; y: number }
  | { type: "pointer.press"; x: number; y: number }
  | { type: "pointer.release"; x: number; y: number };

export type CommandEnvelope = {
  id: string;
  source: CommandSource;
  confidence: number;
  createdAt: number;
  command: WorkbenchCommand;
  transcript?: string;
  gesture?: string;
};

export type CommandSafety = {
  destructive: boolean;
  requiresArmed: boolean;
  minimumConfidence: number;
  cooldownMs: number;
};

const DEFAULT_SAFETY: CommandSafety = {
  destructive: false,
  requiresArmed: true,
  minimumConfidence: 0.72,
  cooldownMs: 650
};

export function commandSafety(command: WorkbenchCommand): CommandSafety {
  switch (command.type) {
    case "controls.arm":
    case "controls.disarm":
      return { destructive: false, requiresArmed: false, minimumConfidence: 0.65, cooldownMs: 1000 };
    case "pointer.move":
      return { destructive: false, requiresArmed: true, minimumConfidence: 0.55, cooldownMs: 0 };
    case "pointer.press":
    case "pointer.release":
      return { destructive: false, requiresArmed: true, minimumConfidence: 0.7, cooldownMs: 100 };
    case "video.clearFrameRecord":
      return { destructive: true, requiresArmed: true, minimumConfidence: 0.9, cooldownMs: 1800 };
    case "video.copyPreviousBoxes":
    case "video.markReviewed":
    case "video.gotoReviewed":
      return { ...DEFAULT_SAFETY, cooldownMs: 900 };
    default:
      return DEFAULT_SAFETY;
  }
}

export function createCommandEnvelope(
  source: CommandSource,
  command: WorkbenchCommand,
  options: {
    confidence?: number;
    createdAt?: number;
    transcript?: string;
    gesture?: string;
  } = {}
): CommandEnvelope {
  const createdAt = options.createdAt ?? Date.now();
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    source,
    confidence: Math.max(0, Math.min(1, options.confidence ?? 1)),
    createdAt,
    command,
    transcript: options.transcript,
    gesture: options.gesture
  };
}

export function commandKey(command: WorkbenchCommand) {
  switch (command.type) {
    case "video.seekBy":
      return `${command.type}:${Math.sign(command.seconds)}`;
    case "video.gotoReviewed":
      return `${command.type}:${command.direction}`;
    case "video.selectClass":
      return `${command.type}:${command.classId}`;
    case "pointer.move":
    case "pointer.press":
    case "pointer.release":
      return command.type;
    default:
      return command.type;
  }
}
