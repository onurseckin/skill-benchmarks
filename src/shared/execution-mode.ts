export type ExecutionMode = "fake" | "live";

export interface ExecutionModeInput {
  readonly mock?: boolean;
  readonly live?: boolean;
}

export class ExecutionModeConfigurationError extends TypeError {
  constructor() {
    super("Execution mode configuration is invalid");
    this.name = "ExecutionModeConfigurationError";
  }
}

const useMockEnvironmentVariable = "SKILL_BENCHMARKS_USE_MOCK";

function resolveEnvironmentExecutionMode(environment: NodeJS.ProcessEnv): ExecutionMode | undefined {
  const configuredValue = environment[useMockEnvironmentVariable];
  if (configuredValue === undefined || configuredValue === "") {
    return undefined;
  }
  if (configuredValue === "true") {
    return "fake";
  }
  if (configuredValue === "false") {
    return "live";
  }
  throw new ExecutionModeConfigurationError();
}

export function resolveExecutionMode(
  input: ExecutionModeInput,
  environment: NodeJS.ProcessEnv = process.env
): ExecutionMode {
  if (input.mock === true && input.live === true) {
    throw new ExecutionModeConfigurationError();
  }
  if (input.mock === true) {
    return "fake";
  }
  if (input.live === true) {
    return "live";
  }
  return resolveEnvironmentExecutionMode(environment) ?? "fake";
}
