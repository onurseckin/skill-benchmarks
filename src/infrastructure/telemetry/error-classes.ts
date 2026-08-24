import {
  AgentToolError,
  ExecutionTimeoutError,
  InfrastructureFaultError,
  StateIntegrityError,
} from "./error-base.js";

export * from "./error-base.js";

export class DockerDaemonUnavailableError extends InfrastructureFaultError {
  public override readonly code = "ERR_DOCKER_DAEMON_UNAVAILABLE";

  constructor(
    message: string = "Docker daemon socket is disconnected or unresponsive",
    options?: {
      readonly isRetryable?: boolean;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(message, "ERR_DOCKER_DAEMON_UNAVAILABLE", options);
  }
}

export class ImagePullFailedError extends InfrastructureFaultError {
  public override readonly code = "ERR_IMAGE_PULL_FAILED";

  constructor(
    imageTag: string,
    options?: {
      readonly isRetryable?: boolean;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(`Required base image '${imageTag}' could not be pulled`, "ERR_IMAGE_PULL_FAILED", {
      ...options,
      details: { imageTag, ...options?.details },
    });
  }
}

export class VolumeCreationFailedError extends InfrastructureFaultError {
  public override readonly code = "ERR_VOLUME_CREATION_FAILED";

  constructor(
    volumeName: string,
    options?: {
      readonly isRetryable?: boolean;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(`Failed to create ephemeral Docker volume '${volumeName}'`, "ERR_VOLUME_CREATION_FAILED", {
      ...options,
      details: { volumeName, ...options?.details },
    });
  }
}

export class ContainerBootTimeoutError extends InfrastructureFaultError {
  public override readonly code = "ERR_CONTAINER_BOOT_TIMEOUT";

  constructor(
    containerId: string,
    timeoutMs: number,
    options?: {
      readonly isRetryable?: boolean;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(
      `Container '${containerId}' failed to reach READY state within ${timeoutMs}ms`,
      "ERR_CONTAINER_BOOT_TIMEOUT",
      {
        ...options,
        details: { containerId, timeoutMs, ...options?.details },
      }
    );
  }
}

export class OomKilledError extends InfrastructureFaultError {
  public override readonly code = "ERR_OOM_KILLED";

  constructor(
    containerId: string,
    options?: {
      readonly memoryLimitBytes?: number;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(
      `Container '${containerId}' exceeded memory limit and was killed by Linux OOM killer (Exit 137)`,
      "ERR_OOM_KILLED",
      {
        exitCode: 137,
        details: {
          containerId,
          memoryLimitBytes: options?.memoryLimitBytes,
          ...options?.details,
        },
        cause: options?.cause,
      }
    );
  }
}

export class CommandTimeoutError extends ExecutionTimeoutError {
  public override readonly code = "ERR_COMMAND_TIMEOUT";

  constructor(
    command: string,
    timeoutMs: number,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(
      `Command execution timed out after ${timeoutMs}ms: ${command.slice(0, 100)}`,
      "ERR_COMMAND_TIMEOUT",
      {
        ...options,
        details: { command, timeoutMs, ...options?.details },
      }
    );
  }
}

export class TurnTimeoutError extends ExecutionTimeoutError {
  public override readonly code = "ERR_TURN_TIMEOUT";

  constructor(
    turnIndex: number,
    timeoutMs: number,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(
      `Benchmark turn ${turnIndex} exceeded deadline of ${timeoutMs}ms`,
      "ERR_TURN_TIMEOUT",
      {
        ...options,
        details: { turnIndex, timeoutMs, ...options?.details },
      }
    );
  }
}

export class ScenarioTimeoutError extends ExecutionTimeoutError {
  public override readonly code = "ERR_SCENARIO_TIMEOUT";

  constructor(
    scenarioId: string,
    timeoutMs: number,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(
      `Scenario '${scenarioId}' exceeded total execution deadline of ${timeoutMs}ms`,
      "ERR_SCENARIO_TIMEOUT",
      {
        ...options,
        details: { scenarioId, timeoutMs, ...options?.details },
      }
    );
  }
}

export class InvalidToolPayloadError extends AgentToolError {
  public override readonly code = "ERR_INVALID_TOOL_PAYLOAD";

  constructor(
    toolName: string,
    reason: string,
    options?: {
      readonly payload?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(
      `Invalid tool payload for '${toolName}': ${reason}`,
      "ERR_INVALID_TOOL_PAYLOAD",
      {
        ...options,
        details: { toolName, reason, payload: options?.payload, ...options?.details },
      }
    );
  }
}

export class CommandNonZeroExitError extends AgentToolError {
  public override readonly code = "ERR_COMMAND_NON_ZERO_EXIT";

  constructor(
    command: string,
    exitCode: number,
    stderr: string = "",
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(
      `Command '${command.slice(0, 80)}' failed with exit code ${exitCode}`,
      "ERR_COMMAND_NON_ZERO_EXIT",
      {
        exitCode,
        details: { command, exitCode, stderrSnippet: stderr.slice(-500), ...options?.details },
        cause: options?.cause,
      }
    );
  }
}

export class OutputLimitExceededError extends AgentToolError {
  public override readonly code = "ERR_OUTPUT_LIMIT_EXCEEDED";

  constructor(
    commandId: string,
    limitBytes: number,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(
      `Command output exceeded maximum ceiling of ${limitBytes} bytes (5MB)`,
      "ERR_OUTPUT_LIMIT_EXCEEDED",
      {
        ...options,
        details: { commandId, limitBytes, ...options?.details },
      }
    );
  }
}

export class DiffExtractionFailedError extends StateIntegrityError {
  public override readonly code = "ERR_DIFF_EXTRACTION_FAILED";

  constructor(
    reason: string,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(
      `Failed to extract Git diff from workspace: ${reason}`,
      "ERR_DIFF_EXTRACTION_FAILED",
      {
        ...options,
        details: { reason, ...options?.details },
      }
    );
  }
}

export class BaselineTamperingError extends StateIntegrityError {
  public override readonly code = "ERR_BASELINE_TAMPERING";

  constructor(
    tamperedFiles: ReadonlyArray<string>,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    }
  ) {
    super(
      `Agent tampered with immutable baseline fixtures: ${tamperedFiles.join(", ")}`,
      "ERR_BASELINE_TAMPERING",
      {
        ...options,
        details: { tamperedFiles, ...options?.details },
      }
    );
  }
}
