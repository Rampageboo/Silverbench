import { CommandArbiter, type CommandDecision } from "./commandArbiter";
import type { CommandEnvelope } from "./commands";

export type CommandListener = (envelope: CommandEnvelope) => void;
export type DecisionListener = (decision: CommandDecision) => void;

export class MultimodalCommandBus {
  private arbiter: CommandArbiter;
  private commandListeners = new Set<CommandListener>();
  private decisionListeners = new Set<DecisionListener>();

  constructor(arbiter = new CommandArbiter()) {
    this.arbiter = arbiter;
  }

  isArmed() {
    return this.arbiter.isArmed();
  }

  setArmed(value: boolean) {
    this.arbiter.setArmed(value);
  }

  publish(envelope: CommandEnvelope) {
    const decision = this.arbiter.evaluate(envelope);
    for (const listener of this.decisionListeners) listener(decision);
    if (decision.accepted) {
      for (const listener of this.commandListeners) listener(decision.envelope);
    }
    return decision;
  }

  subscribe(listener: CommandListener) {
    this.commandListeners.add(listener);
    return () => {
      this.commandListeners.delete(listener);
    };
  }

  subscribeDecisions(listener: DecisionListener) {
    this.decisionListeners.add(listener);
    return () => {
      this.decisionListeners.delete(listener);
    };
  }
}
