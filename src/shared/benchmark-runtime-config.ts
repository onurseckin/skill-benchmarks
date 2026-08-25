import { resolve } from "node:path";
import type { ProviderId } from "../providers/types.js";
import {
  resolveExecutionMode,
  type ExecutionMode,
  type ExecutionModeInput,
} from "./execution-mode.js";

export interface BenchmarkRuntimeConfigInput extends ExecutionModeInput {
  readonly outputDir?: string;
  readonly providerId?: string;
}

export interface BenchmarkRuntimeConfig {
  readonly executionMode: ExecutionMode;
  readonly outputRoot: string;
  readonly requestedProviderId?: ProviderId;
}

export class BenchmarkRuntimeConfigurationError extends TypeError {
  constructor() {
    super("Benchmark runtime configuration is invalid");
    this.name = "BenchmarkRuntimeConfigurationError";
  }
}

const outputDirectoryEnvironmentVariable = "SKILL_BENCHMARKS_OUTPUT_DIR";

function resolveRequestedProviderId(providerId: string | undefined): ProviderId | undefined {
  if (providerId === undefined) {
    return undefined;
  }
  if (
    providerId === "anthropic"
    || providerId === "openai"
    || providerId === "google"
    || providerId === "ollama"
    || providerId === "custom"
  ) {
    return providerId;
  }
  throw new BenchmarkRuntimeConfigurationError();
}

function resolveOutputRoot(input: BenchmarkRuntimeConfigInput, environment: NodeJS.ProcessEnv): string {
  const configuredOutputRoot = input.outputDir
    ?? environment[outputDirectoryEnvironmentVariable]
    ?? resolve(process.cwd(), ".benchmarks");
  if (configuredOutputRoot.trim().length === 0) {
    throw new BenchmarkRuntimeConfigurationError();
  }
  return resolve(configuredOutputRoot);
}

export function resolveBenchmarkRuntimeConfig(
  input: BenchmarkRuntimeConfigInput,
  environment: NodeJS.ProcessEnv = process.env
): BenchmarkRuntimeConfig {
  const requestedProviderId = resolveRequestedProviderId(input.providerId);
  const resolvedConfig: BenchmarkRuntimeConfig = {
    executionMode: resolveExecutionMode(input, environment),
    outputRoot: resolveOutputRoot(input, environment),
  };
  return requestedProviderId === undefined
    ? resolvedConfig
    : { ...resolvedConfig, requestedProviderId };
}
