import { join } from "node:path";
import { ProviderRateLimitError } from "../../providers/types.js";
import { ScenarioRunnerEngine } from "../../runner/runner-engine.js";
import { StandardToolDispatcher } from "../../runner/tool-dispatcher.js";
import type {
  LLMProviderAdapter,
  ModelTurnResponse,
  ScenarioRunConfig,
  StandardTool,
} from "../../runner/types.js";
import { TokenBucketRateLimiter } from "../../sweep/token-bucket.js";
import { runSweepWorkerPool } from "../../sweep/sweep-worker-pool.js";
import type { MatrixCellDescriptor, MatrixCellResult } from "../../sweep/types.js";
import { requireCondition } from "./assertions.js";

export async function verifyRuntimeCancellationAndPermits(temporaryRoot: string): Promise<void> {
  await verifyScenarioDeadline(join(temporaryRoot, "scenario-timeout"));
  await verifyTurnDeadline(join(temporaryRoot, "turn-timeout"));
  await verifyCallerAbortRejectsLateSuccess(join(temporaryRoot, "caller-abort"));
  await verifyCustomStreamIteratorClosed(join(temporaryRoot, "stream-iterator"));
  await verifyRateLimitFailureEscapesRunner(join(temporaryRoot, "rate-limit"));
  await verifyDispatcherRejectsLateSuccess();
  await verifyPermitReconciliation();
  await verifyQueuedAndAcquiredAbort();
  await verifyAbortedWorkerQueueStops();
}

export async function verifyCustomStreamIteratorClosed(outputDir: string): Promise<void> {
  let iteratorClosed = false;
  const provider: LLMProviderAdapter = {
    providerId: "fixture",
    modelId: "fixture-stream-model",
    executionMode: "fake",
    simulated: true,
    generateStream() {
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<never>> {
              return await new Promise<IteratorResult<never>>(() => {});
            },
            async return(): Promise<IteratorResult<never>> {
              iteratorClosed = true;
              return { done: true, value: undefined as never };
            },
          };
        },
      };
    },
    async generateTurn(): Promise<ModelTurnResponse> {
      throw new Error("streaming fixture must not call generateTurn");
    },
    calculateCostUSD: () => 0,
  };
  const config = createRunConfig(outputDir, provider) as ScenarioRunConfig;
  const result = await new ScenarioRunnerEngine().run(
    {
      ...config,
      limits: { ...config.limits, turnTimeoutMs: 10 },
    },
    { onToken() {} },
  );
  requireCondition(result.terminationReason === "timeout", "runner_stream_timeout_reason");
  requireCondition(iteratorClosed, "runner_stream_iterator_closed");
}

export async function verifyRateLimitFailureEscapesRunner(outputDir: string): Promise<void> {
  const provider: LLMProviderAdapter = {
    providerId: "openai",
    modelId: "fixture-rate-limit-model",
    executionMode: "fake",
    simulated: true,
    async *generateStream(): AsyncIterable<never> {},
    async generateTurn(): Promise<ModelTurnResponse> {
      throw new ProviderRateLimitError("fixture rate limited", "openai", {
        retryAfterMs: 25,
      });
    },
    calculateCostUSD: () => 0,
  };
  const failure = await captureFailure(
    new ScenarioRunnerEngine().run(createRunConfig(outputDir, provider)),
  );
  requireCondition(failure instanceof ProviderRateLimitError, "runner_rate_limit_escape_type");
  requireCondition(failure.retryAfterMs === 25, "runner_rate_limit_escape_retry_after");
}

async function verifyTurnDeadline(outputDir: string): Promise<void> {
  const config = createRunConfig(outputDir, delayedProvider(35)) as ScenarioRunConfig;
  const result = await new ScenarioRunnerEngine().run({
    ...config,
    limits: { ...config.limits, turnTimeoutMs: 10 },
  });
  requireCondition(result.terminationReason === "timeout", "runner_turn_timeout_reason");
  requireCondition(result.completed === false, "runner_turn_timeout_completed");
}

async function verifyScenarioDeadline(outputDir: string): Promise<void> {
  const result = await new ScenarioRunnerEngine().run(
    createRunConfig(outputDir, delayedProvider(35), { maxWallClockTimeMs: 10 }),
  );
  requireCondition(result.terminationReason === "timeout", "runner_scenario_timeout_reason");
  requireCondition(result.completed === false, "runner_scenario_timeout_completed");
}

async function verifyCallerAbortRejectsLateSuccess(outputDir: string): Promise<void> {
  const controller = new AbortController();
  const config = {
    ...createRunConfig(outputDir, delayedProvider(35)),
    signal: controller.signal,
  } as ScenarioRunConfig & { readonly signal: AbortSignal };
  const pending = new ScenarioRunnerEngine().run(config);
  setTimeout(() => controller.abort(new Error("fixture caller abort")), 10);
  const result = await pending;
  requireCondition(result.terminationReason === "aborted", "runner_caller_abort_reason");
  requireCondition(result.finalOutput === "", "runner_caller_abort_late_output");
}

async function verifyDispatcherRejectsLateSuccess(): Promise<void> {
  const dispatcher = new StandardToolDispatcher();
  let observedSignal: AbortSignal | undefined;
  const tool: StandardTool = {
    definition: { name: "blocking_fixture", description: "fixture", parameters: {} },
    async execute(_params, context): Promise<string> {
      observedSignal = context.signal;
      await delay(35);
      return "late-success";
    },
  };
  dispatcher.registerTool(tool);
  const controller = new AbortController();
  const pending = dispatcher.dispatch(
    { id: "fixture-call", name: "blocking_fixture", arguments: {}, rawArguments: "{}" },
    {
      signal: controller.signal,
      runId: "fixture-run",
      scenarioId: "fixture-scenario",
    },
    createLimits(),
  );
  setTimeout(() => controller.abort(new Error("fixture caller abort")), 10);
  const failure = await captureFailure(pending);
  requireCondition(failure instanceof Error && failure.name === "ExecutionAbortedError", "dispatcher_abort_type");
  requireCondition(observedSignal?.aborted === true, "dispatcher_abort_propagation");
}

async function verifyPermitReconciliation(): Promise<void> {
  const limiter = createLimiter();
  const permitValue = await limiter.acquire(200);
  requireCondition(typeof permitValue === "object" && permitValue !== null, "permit_returned");
  const permit = permitValue as unknown as {
    release(outcome: "completed", actualTokens: number): Promise<void>;
  };
  const firstRelease = permit.release("completed", 50);
  const secondRelease = permit.release("completed", 900);
  requireCondition(firstRelease === secondRelease, "permit_release_memoized");
  await firstRelease;
  const status = limiter.getStatus() as ReturnType<typeof limiter.getStatus> & {
    readonly activePermits?: number;
  };
  requireCondition(status.activePermits === 0, "permit_release_active_count");
  requireCondition(status.availableTokens >= 949, "permit_actual_token_refund");

  const expensiveLimiter = createLimiter();
  const expensivePermit = (await expensiveLimiter.acquire(200)) as unknown as {
    release(outcome: "completed", actualTokens: number): Promise<void>;
  };
  await expensivePermit.release("completed", 400);
  requireCondition(expensiveLimiter.getStatus().availableTokens <= 601, "permit_actual_token_debit");
}

async function verifyQueuedAndAcquiredAbort(): Promise<void> {
  const limiter = createLimiter(1);
  const first = (await limiter.acquire(100)) as unknown as {
    release(outcome: "aborted"): Promise<void>;
  };
  const queuedController = new AbortController();
  const queued = limiter.acquire(100, queuedController.signal);
  queuedController.abort(new Error("fixture queued abort"));
  const queuedFailure = await captureFailure(queued);
  requireCondition(queuedFailure instanceof Error, "permit_queued_abort_type");
  await first.release("aborted");
  const afterQueued = limiter.getStatus() as ReturnType<typeof limiter.getStatus> & {
    readonly activePermits?: number;
  };
  requireCondition(afterQueued.queueDepth === 0, "permit_queued_abort_depth");
  requireCondition(afterQueued.activePermits === 0, "permit_queued_abort_active_count");

  const acquiredController = new AbortController();
  const acquired = (await limiter.acquire(100, acquiredController.signal)) as unknown as {
    release(outcome: "aborted"): Promise<void>;
  };
  acquiredController.abort(new Error("fixture acquired abort"));
  await acquired.release("aborted");
  const afterAcquired = limiter.getStatus() as ReturnType<typeof limiter.getStatus> & {
    readonly activePermits?: number;
  };
  requireCondition(afterAcquired.activePermits === 0, "permit_acquired_abort_active_count");
}

async function verifyAbortedWorkerQueueStops(): Promise<void> {
  const cells = [createCell("first"), createCell("second")];
  const controller = new AbortController();
  const executed: string[] = [];
  const terminalized: string[] = [];
  await runSweepWorkerPool({
    cells,
    config: { concurrency: { maxGlobalConcurrency: 1 } } as never,
    maxGlobalConcurrency: 1,
    signal: controller.signal,
    waitIfPaused: async () => {},
    shouldSkip: () => false,
    updateInFlight: () => {},
    executeCell: async (cell) => {
      executed.push(cell.cellId);
      controller.abort(new Error("fixture worker abort"));
      return createCellResult(cell);
    },
    terminalizeAbortedCell: async (cell) => {
      terminalized.push(cell.cellId);
    },
  });
  requireCondition(executed.length === 1, "sweep_aborted_queue_started");
  requireCondition(
    terminalized.length === 1 && terminalized[0] === "second",
    "sweep_aborted_queue_terminalized",
  );
}

function createLimiter(maxConcurrentRequests = 2): TokenBucketRateLimiter {
  return new TokenBucketRateLimiter("fixture", {
    maxRequestsPerMinute: 1000,
    maxTokensPerMinute: 1000,
    maxConcurrentRequests,
    initialTokensRatio: 1,
    jitter: false,
  });
}

function createRunConfig(
  outputDir: string,
  provider: LLMProviderAdapter,
  limitOverrides: { readonly maxWallClockTimeMs?: number } = {},
): ScenarioRunConfig {
  return {
    runId: `fixture-${outputDir.split("/").pop() ?? "run"}`,
    scenarioId: "fixture-scenario",
    skillIds: [],
    modelId: provider.modelId,
    provider,
    prompt: "fixture",
    artifactOutputDir: outputDir,
    limits: createLimits(limitOverrides),
  };
}

function createLimits(overrides: { readonly maxWallClockTimeMs?: number } = {}) {
  return {
    maxTurns: 1,
    maxWallClockTimeMs: overrides.maxWallClockTimeMs ?? 500,
    maxCostUSD: 1,
    maxConsecutiveToolFailures: 1,
    toolTimeoutMs: 100,
    maxOutputSizeBytes: 1024,
  };
}

function delayedProvider(delayMs: number): LLMProviderAdapter {
  return {
    providerId: "fixture",
    modelId: "fixture-model",
    executionMode: "fake",
    simulated: true,
    async *generateStream(): AsyncIterable<never> {},
    async generateTurn(): Promise<ModelTurnResponse> {
      await delay(delayMs);
      return {
        text: "late-success",
        toolCalls: [],
        finishReason: "stop",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 2,
        },
        timeToFirstTokenMs: delayMs,
        totalTurnDurationMs: delayMs,
      };
    },
    calculateCostUSD: () => 0,
  };
}

function createCell(cellId: string): MatrixCellDescriptor {
  return {
    cellId,
    modelId: "fixture-model",
    providerId: "fixture-provider",
    modelEntry: {},
  } as MatrixCellDescriptor;
}

function createCellResult(cell: MatrixCellDescriptor): MatrixCellResult {
  return {
    cell,
    status: "failed",
    attemptCount: 0,
    durationMs: 0,
    executionCompleted: false,
    benchmarkCohort: "operational",
    eligibilityStatus: "ineligible",
    evaluationStatus: "not_requested",
    retryable: false,
  };
}

async function captureFailure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

async function delay(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
