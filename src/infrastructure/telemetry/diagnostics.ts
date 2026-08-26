import * as fs from "node:fs";
import * as path from "node:path";
import type { ContainerInspectDiagnostic, DiagnosticRecord, InfrastructureError } from "./types.js";
import { BenchmarkError, classifyError } from "./error-taxonomy.js";

export interface DiagnosticsCaptureOptions {
  readonly runId: string;
  readonly containerId?: string;
  readonly error?: unknown;
  readonly containerInspector?: (containerId: string) => Promise<ContainerInspectDiagnostic | null>;
  readonly dmesgExtractor?: (containerId: string) => Promise<ReadonlyArray<string>>;
  readonly scribe?: {
    readonly getRecentStdoutLines: () => ReadonlyArray<string>;
    readonly getRecentStderrLines: () => ReadonlyArray<string>;
  };
  readonly recentStdoutLines?: ReadonlyArray<string>;
  readonly recentStderrLines?: ReadonlyArray<string>;
  readonly outputDir?: string;
}

export async function captureDiagnostics(
  options: DiagnosticsCaptureOptions,
): Promise<DiagnosticRecord> {
  const capturedAt = new Date().toISOString();

  let errorRecord: InfrastructureError | undefined;
  if (options.error) {
    if (options.error instanceof BenchmarkError) {
      errorRecord = options.error.toInfrastructureError();
    } else {
      errorRecord = classifyError(options.error).toInfrastructureError();
    }
  }

  let containerInspect: ContainerInspectDiagnostic | undefined;
  if (options.containerId && options.containerInspector) {
    try {
      const inspectData = await options.containerInspector(options.containerId);
      if (inspectData) {
        containerInspect = inspectData;
      }
    } catch (inspectError) {
      containerInspect = {
        status: "inspect_failed",
        running: false,
        exitCode: -1,
        oomKilled: false,
        startedAt: "",
        finishedAt: capturedAt,
        error: inspectError instanceof Error ? inspectError.message : String(inspectError),
      };
    }
  }

  let dmesgTail: ReadonlyArray<string> = [];
  if (options.containerId && options.dmesgExtractor) {
    try {
      dmesgTail = await options.dmesgExtractor(options.containerId);
    } catch {
      dmesgTail = ["<dmesg capture unavailable or failed>"];
    }
  }

  const lastStdoutLines: ReadonlyArray<string> =
    options.recentStdoutLines ?? options.scribe?.getRecentStdoutLines() ?? [];

  const lastStderrLines: ReadonlyArray<string> =
    options.recentStderrLines ?? options.scribe?.getRecentStderrLines() ?? [];

  const record: DiagnosticRecord = {
    runId: options.runId,
    containerId: options.containerId,
    capturedAt,
    error: errorRecord,
    containerInspect,
    dmesgTail,
    lastStdoutLines,
    lastStderrLines,
  };

  if (options.outputDir) {
    try {
      await fs.promises.mkdir(options.outputDir, { recursive: true });
      const filePath = path.join(options.outputDir, "diagnostics.json");
      await fs.promises.writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");
    } catch {}
  }

  return record;
}

export class DiagnosticsEngine {
  private readonly runId: string;
  private readonly outputDir?: string;

  constructor(runId: string, outputDir?: string) {
    this.runId = runId;
    this.outputDir = outputDir;
  }

  public async capture(
    options: Omit<DiagnosticsCaptureOptions, "runId" | "outputDir">,
  ): Promise<DiagnosticRecord> {
    return captureDiagnostics({
      runId: this.runId,
      outputDir: this.outputDir,
      ...options,
    });
  }
}
