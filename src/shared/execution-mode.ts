export type ExecutionMode = "fake" | "live";

export interface ExecutionModeInput {
  readonly mock?: boolean;
  readonly live?: boolean;
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
  throw new TypeError(`Argument error: ${useMockEnvironmentVariable} must be true or false`);
}

export function resolveExecutionMode(
  input: ExecutionModeInput,
  environment: NodeJS.ProcessEnv = process.env
): ExecutionMode {
  if (input.mock === true && input.live === true) {
    throw new TypeError("Argument error: --mock and --live cannot be used together");
  }
  if (input.mock === true) {
    return "fake";
  }
  if (input.live === true) {
    return "live";
  }
  return resolveEnvironmentExecutionMode(environment) ?? "fake";
}
