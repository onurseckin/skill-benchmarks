import {
  AgentToolError,
  BaselineTamperingError,
  BenchmarkError,
  CommandTimeoutError,
  DiffExtractionFailedError,
  DockerDaemonUnavailableError,
  ExecutionTimeoutError,
  ImagePullFailedError,
  InfrastructureFaultError,
  InvalidToolPayloadError,
  OomKilledError,
  OutputLimitExceededError,
  ScenarioTimeoutError,
  StateIntegrityError,
  TurnTimeoutError,
  VolumeCreationFailedError,
} from "./error-classes.js";

export * from "./error-classes.js";

export function isBenchmarkError(error: unknown): error is BenchmarkError {
  return error instanceof BenchmarkError;
}

export function isInfrastructureFault(error: unknown): error is InfrastructureFaultError {
  return error instanceof InfrastructureFaultError;
}

export function isExecutionTimeout(error: unknown): error is ExecutionTimeoutError {
  return error instanceof ExecutionTimeoutError;
}

export function isAgentToolError(error: unknown): error is AgentToolError {
  return error instanceof AgentToolError;
}

export function isStateIntegrityError(error: unknown): error is StateIntegrityError {
  return error instanceof StateIntegrityError;
}

export function classifyError(error: unknown): BenchmarkError {
  if (error instanceof BenchmarkError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  if (
    /oom|out of memory|137/i.test(message) ||
    (typeof error === "object" &&
      error !== null &&
      "exitCode" in error &&
      (error as { exitCode?: unknown }).exitCode === 137)
  ) {
    return new OomKilledError("unknown", {
      details: { originalMessage: message, stack },
      cause: error,
    });
  }

  if (/docker\.sock|econnrefused|docker daemon/i.test(message)) {
    return new DockerDaemonUnavailableError(message, {
      details: { stack },
      cause: error,
    });
  }

  if (/image.*pull|pull.*image|manifest for.*not found/i.test(message)) {
    return new ImagePullFailedError(message, {
      details: { stack },
      cause: error,
    });
  }

  if (/volume.*creat|disk full|no space left/i.test(message)) {
    return new VolumeCreationFailedError("unknown", {
      details: { originalMessage: message, stack },
      cause: error,
    });
  }

  if (/command.*timed?\s*out/i.test(message)) {
    return new CommandTimeoutError("unknown", 60000, {
      details: { originalMessage: message, stack },
      cause: error,
    });
  }
  if (/turn.*timed?\s*out/i.test(message)) {
    return new TurnTimeoutError(0, 180000, {
      details: { originalMessage: message, stack },
      cause: error,
    });
  }
  if (/scenario.*timed?\s*out/i.test(message)) {
    return new ScenarioTimeoutError("unknown", 900000, {
      details: { originalMessage: message, stack },
      cause: error,
    });
  }

  if (/output.*limit|output ceiling|5mb/i.test(message)) {
    return new OutputLimitExceededError("unknown", 5 * 1024 * 1024, {
      details: { originalMessage: message, stack },
      cause: error,
    });
  }
  if (/invalid.*payload|schema.*validation|json parse/i.test(message)) {
    return new InvalidToolPayloadError("unknown", message, {
      details: { stack },
      cause: error,
    });
  }

  if (/baseline.*tamper|immutable fixture/i.test(message)) {
    return new BaselineTamperingError([], {
      details: { originalMessage: message, stack },
      cause: error,
    });
  }
  if (/diff.*extract|git.*index|corrupt.*git/i.test(message)) {
    return new DiffExtractionFailedError(message, {
      details: { stack },
      cause: error,
    });
  }

  return new InfrastructureFaultError(message, "ERR_DOCKER_DAEMON_UNAVAILABLE", {
    details: { stack },
    cause: error,
  });
}
