import type { ContainerState } from "./types.js";

export class InvalidStateTransitionError extends Error {
  readonly fromState: ContainerState;
  readonly toState: ContainerState;

  constructor(fromState: ContainerState, toState: ContainerState, message?: string) {
    const defaultMsg = `Invalid container state transition from '${fromState}' to '${toState}'`;
    super(message ?? defaultMsg);
    this.name = "InvalidStateTransitionError";
    this.fromState = fromState;
    this.toState = toState;
  }
}

export interface StateTransitionRecord {
  readonly from: ContainerState;
  readonly to: ContainerState;
  readonly timestampMs: number;
  readonly reason?: string;
}

export type StateTransitionListener = (record: StateTransitionRecord) => void;

const VALID_TRANSITIONS: Readonly<Record<ContainerState, ReadonlySet<ContainerState>>> = {
  PENDING: new Set<ContainerState>(["CREATING", "ERRORED", "TEARDOWN"]),
  CREATING: new Set<ContainerState>(["HYDRATING", "READY", "ERRORED", "TEARDOWN"]),
  HYDRATING: new Set<ContainerState>(["READY", "ERRORED", "TEARDOWN"]),
  READY: new Set<ContainerState>(["EXECUTING", "EXTRACTING", "TEARDOWN", "ERRORED"]),
  EXECUTING: new Set<ContainerState>(["READY", "EXTRACTING", "ERRORED", "TEARDOWN"]),
  EXTRACTING: new Set<ContainerState>(["READY", "TEARDOWN", "ERRORED"]),
  TEARDOWN: new Set<ContainerState>(["TERMINATED", "ERRORED"]),
  ERRORED: new Set<ContainerState>(["TEARDOWN", "TERMINATED"]),
  TERMINATED: new Set<ContainerState>([]),
};

export class ContainerStateMachine {
  private _state: ContainerState;
  private readonly _history: StateTransitionRecord[] = [];
  private readonly _listeners: StateTransitionListener[] = [];

  constructor(initialState: ContainerState = "PENDING") {
    this._state = initialState;
  }

  get state(): ContainerState {
    return this._state;
  }

  get history(): ReadonlyArray<StateTransitionRecord> {
    return [...this._history];
  }

  canTransition(toState: ContainerState): boolean {
    const validTargets = VALID_TRANSITIONS[this._state];
    return validTargets !== undefined && validTargets.has(toState);
  }

  transition(toState: ContainerState, reason?: string): void {
    if (!this.canTransition(toState)) {
      throw new InvalidStateTransitionError(this._state, toState);
    }

    const record: StateTransitionRecord = {
      from: this._state,
      to: toState,
      timestampMs: Date.now(),
      ...(reason !== undefined ? { reason } : {}),
    };

    this._state = toState;
    this._history.push(record);

    for (const listener of this._listeners) {
      try {
        listener(record);
      } catch (err) {
        console.error("Error in state transition listener:", err);
      }
    }
  }

  onTransition(listener: StateTransitionListener): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx !== -1) {
        this._listeners.splice(idx, 1);
      }
    };
  }

  isTerminal(): boolean {
    return (
      this._state === "TERMINATED" ||
      (this._state === "ERRORED" && this._history.some((h) => h.from === "TEARDOWN"))
    );
  }
}
