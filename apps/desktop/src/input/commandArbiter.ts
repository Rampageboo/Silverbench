import { commandKey, commandSafety, type CommandEnvelope } from "./commands";

export type CommandDecision =
  | { accepted: true; envelope: CommandEnvelope }
  | {
      accepted: false;
      envelope: CommandEnvelope;
      reason: "disarmed" | "low-confidence" | "cooldown" | "confirmation-required";
    };

export type CommandArbiterOptions = {
  initiallyArmed?: boolean;
  confirmationWindowMs?: number;
};

type PendingConfirmation = { key: string; source: string; expiresAt: number };

export class CommandArbiter {
  private armed: boolean;
  private confirmationWindowMs: number;
  private lastAccepted = new Map<string, number>();
  private pendingConfirmation: PendingConfirmation | null = null;

  constructor(options: CommandArbiterOptions = {}) {
    this.armed = options.initiallyArmed ?? false;
    this.confirmationWindowMs = options.confirmationWindowMs ?? 3500;
  }

  isArmed() {
    return this.armed;
  }

  setArmed(value: boolean) {
    this.armed = value;
    if (!value) this.pendingConfirmation = null;
  }

  evaluate(envelope: CommandEnvelope): CommandDecision {
    const { command } = envelope;
    if (command.type === "controls.arm") {
      this.setArmed(true);
      return { accepted: true, envelope };
    }
    if (command.type === "controls.disarm") {
      this.setArmed(false);
      return { accepted: true, envelope };
    }

    const safety = commandSafety(command);
    if (safety.requiresArmed && !this.armed) {
      return { accepted: false, envelope, reason: "disarmed" };
    }
    if (envelope.confidence < safety.minimumConfidence) {
      return { accepted: false, envelope, reason: "low-confidence" };
    }

    const key = commandKey(command);
    const lastAcceptedAt = this.lastAccepted.get(key) ?? Number.NEGATIVE_INFINITY;
    if (envelope.createdAt - lastAcceptedAt < safety.cooldownMs) {
      return { accepted: false, envelope, reason: "cooldown" };
    }

    if (safety.destructive) {
      const pending = this.pendingConfirmation;
      const confirmed =
        pending &&
        pending.key === key &&
        pending.source === envelope.source &&
        envelope.createdAt <= pending.expiresAt;
      if (!confirmed) {
        this.pendingConfirmation = {
          key,
          source: envelope.source,
          expiresAt: envelope.createdAt + this.confirmationWindowMs
        };
        return { accepted: false, envelope, reason: "confirmation-required" };
      }
      this.pendingConfirmation = null;
    }

    this.lastAccepted.set(key, envelope.createdAt);
    return { accepted: true, envelope };
  }
}
