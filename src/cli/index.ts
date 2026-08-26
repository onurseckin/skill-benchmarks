import { ReplayEvidenceInvalidError, ReplayEvidenceUnavailableError } from "../replay/errors.js";
import { ScenarioCatalogError } from "../runner/scenario-loader.js";
import { BenchmarkRuntimeConfigurationError } from "../shared/benchmark-runtime-config.js";
import { ExecutionModeConfigurationError } from "../shared/execution-mode.js";
import { BenchmarkAdmissionError } from "../sweep/sweep-config-validation.js";
import { runArenaCommand } from "./commands/arena.js";
import { runListCommand } from "./commands/list.js";
import { runReplayCommand } from "./commands/replay.js";
import { runReportCommand } from "./commands/report.js";
import { runBenchmarkCommand } from "./commands/run.js";
import { runTournamentCommand } from "./commands/tournament.js";
import { getHelpText, getVersionText } from "./grammar/help.js";
import {
  CliInputError,
  diagnosticSummary,
  type CliCommandName,
  type CliDiagnosticCode,
} from "./grammar/types.js";
import { parseCliArgs } from "./parser.js";
import type { CliCommandHandler, CliOutput } from "./types.js";

type ExecutableCommand = Exclude<CliCommandName, "help" | "version">;

const commandHandlers: Readonly<Record<ExecutableCommand, CliCommandHandler>> = Object.freeze({
  run: runBenchmarkCommand,
  arena: runArenaCommand,
  tournament: runTournamentCommand,
  report: runReportCommand,
  list: runListCommand,
  replay: runReplayCommand,
});

class BufferedCliOutput implements CliOutput {
  private readonly stdoutChunks: string[] = [];
  private readonly stderrChunks: string[] = [];

  stdout(text: string): void {
    this.stdoutChunks.push(text);
  }

  stderr(text: string): void {
    this.stderrChunks.push(text);
  }

  flush(): void {
    if (this.stdoutChunks.length > 0) process.stdout.write(this.stdoutChunks.join(""));
    if (this.stderrChunks.length > 0) process.stderr.write(this.stderrChunks.join(""));
  }
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const output = new BufferedCliOutput();
  try {
    const parsed = parseCliArgs(argv, { stdoutIsTTY: process.stdout.isTTY === true });
    if (parsed.helpRequested || parsed.command === "help") {
      const requested =
        parsed.command === "help" ? readHelpTarget(parsed.positionals[0]) : parsed.command;
      process.stdout.write(`${getHelpText(requested)}\n`);
      return 0;
    }
    if (parsed.command === "version") {
      process.stdout.write(`${getVersionText()}\n`);
      return 0;
    }
    const handler = commandHandlers[parsed.command];
    const result = await handler(parsed, output);
    if (!result.success || result.exitCode !== 0) {
      writeDiagnostic("command_failed");
      return 1;
    }
    output.flush();
    return 0;
  } catch (error) {
    const classified = classifyError(error);
    writeDiagnostic(classified.code);
    return classified.exitCode;
  }
}

function readHelpTarget(value: string | undefined): CliCommandName | undefined {
  if (value === undefined) return undefined;
  return value as CliCommandName;
}

function classifyError(error: unknown): {
  readonly code: CliDiagnosticCode;
  readonly exitCode: 1 | 2;
} {
  if (error instanceof CliInputError) {
    return { code: error.code, exitCode: error.code === "command_failed" ? 1 : 2 };
  }
  if (error instanceof BenchmarkAdmissionError) return { code: error.code, exitCode: 2 };
  if (error instanceof ScenarioCatalogError) {
    return {
      code:
        error.code === "scenario_unresolved" ? "scenario_unresolved" : "scenario_catalog_invalid",
      exitCode: 2,
    };
  }
  if (
    error instanceof ExecutionModeConfigurationError ||
    error instanceof BenchmarkRuntimeConfigurationError
  ) {
    return { code: "invalid_configuration", exitCode: 2 };
  }
  if (
    error instanceof ReplayEvidenceUnavailableError ||
    error instanceof ReplayEvidenceInvalidError
  ) {
    return { code: "replay_unavailable", exitCode: 2 };
  }
  return { code: "command_failed", exitCode: 1 };
}

function writeDiagnostic(code: CliDiagnosticCode): void {
  process.stderr.write(`skill-benchmarks: ${code}: ${diagnosticSummary(code)}\n`);
}

export default runCli;
