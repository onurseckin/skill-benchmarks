import type { ErrorCategory, InfrastructureError, InfrastructureErrorCode } from "./types.js";
import { getMonotonicMicroseconds } from "./event-scribe.js";

export abstract class BenchmarkError extends Error {
  public abstract readonly code: InfrastructureErrorCode;
  public abstract readonly category: ErrorCategory;
  public readonly timestampUs: string;
  public readonly isRetryable: boolean;
  public readonly exitCode?: number;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    options?: {
      readonly isRetryable?: boolean;
      readonly exitCode?: number;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.timestampUs = getMonotonicMicroseconds();
    this.isRetryable = options?.isRetryable ?? false;
    this.exitCode = options?.exitCode;
    this.details = options?.details;
  }

  public toInfrastructureError(): InfrastructureError {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      timestampUs: this.timestampUs,
      isRetryable: this.isRetryable,
      exitCode: this.exitCode,
      details: this.details,
      stack: this.stack,
    };
  }

  public toJSON(): InfrastructureError {
    return this.toInfrastructureError();
  }
}

export class InfrastructureFaultError extends BenchmarkError {
  public readonly category: ErrorCategory = "INFRASTRUCTURE_FAULT";
  public readonly code: InfrastructureErrorCode;

  constructor(
    message: string,
    code: InfrastructureErrorCode = "ERR_DOCKER_DAEMON_UNAVAILABLE",
    options?: {
      readonly isRetryable?: boolean;
      readonly exitCode?: number;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    },
  ) {
    super(message, options);
    this.code = code;
  }
}

export class ExecutionTimeoutError extends BenchmarkError {
  public readonly category: ErrorCategory = "EXECUTION_TIMEOUT";
  public readonly code: InfrastructureErrorCode;

  constructor(
    message: string,
    code: InfrastructureErrorCode = "ERR_COMMAND_TIMEOUT",
    options?: {
      readonly isRetryable?: boolean;
      readonly exitCode?: number;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    },
  ) {
    super(message, options);
    this.code = code;
  }
}

export class AgentToolError extends BenchmarkError {
  public readonly category: ErrorCategory = "AGENT_TOOL_ERROR";
  public readonly code: InfrastructureErrorCode;

  constructor(
    message: string,
    code: InfrastructureErrorCode = "ERR_INVALID_TOOL_PAYLOAD",
    options?: {
      readonly isRetryable?: boolean;
      readonly exitCode?: number;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    },
  ) {
    super(message, options);
    this.code = code;
  }
}

export class StateIntegrityError extends BenchmarkError {
  public readonly category: ErrorCategory = "STATE_INTEGRITY_ERROR";
  public readonly code: InfrastructureErrorCode;

  constructor(
    message: string,
    code: InfrastructureErrorCode = "ERR_DIFF_EXTRACTION_FAILED",
    options?: {
      readonly isRetryable?: boolean;
      readonly exitCode?: number;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    },
  ) {
    super(message, options);
    this.code = code;
  }
}
