export class QueueTimeoutError extends Error {
  public readonly queueTimeoutMs: number;

  public constructor(queueTimeoutMs: number) {
    super(`Container pool acquisition timed out after waiting ${queueTimeoutMs}ms in queue`);
    this.name = "QueueTimeoutError";
    this.queueTimeoutMs = queueTimeoutMs;
  }
}

export class DrainInitiatedError extends Error {
  public constructor() {
    super("Container pool is draining, acquisition cancelled");
    this.name = "DrainInitiatedError";
  }
}

export class UnknownContainerLeaseError extends Error {
  public constructor(containerId: string) {
    super(`Container lease '${containerId}' is not owned by this pool`);
    this.name = "UnknownContainerLeaseError";
  }
}

export class ContainerCleanupError extends Error {
  public readonly errors: readonly Error[];

  public constructor(message: string, errors: readonly Error[]) {
    super(message, { cause: errors[0] });
    this.name = "ContainerCleanupError";
    this.errors = errors;
  }
}

export class ContainerOwnershipError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ContainerOwnershipError";
  }
}

export class ContainerDrainError extends Error {
  public readonly errors: readonly Error[];

  public constructor(errors: readonly Error[]) {
    super("Container pool drain did not remove every owned resource", { cause: errors[0] });
    this.name = "ContainerDrainError";
    this.errors = errors;
  }
}
