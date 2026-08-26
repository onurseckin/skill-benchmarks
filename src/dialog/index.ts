import type {
  DialogMessage,
  DialogTranscript,
  InteractiveBenchmarkResult,
  InteractiveBenchmarkScenario,
  InterviewGraderConfig,
  StakeholderSimulatorConfig,
} from "./types.js";
import { createStakeholderSimulator } from "./stakeholder-simulator.js";
import { createInterviewEvaluator } from "./interview-evaluator.js";

export * from "./types.js";
export * from "./stakeholder-simulator.js";
export * from "./interview-evaluator.js";

export class InteractiveDialogRunner {
  private readonly graderConfig: InterviewGraderConfig;

  constructor(graderConfig: InterviewGraderConfig = {}) {
    this.graderConfig = graderConfig;
  }

  public async runScenario(
    scenario: InteractiveBenchmarkScenario,
    candidateCallback: (messages: readonly DialogMessage[], turn: number) => Promise<string>,
    artifacts: Readonly<Record<string, string>> = {},
  ): Promise<InteractiveBenchmarkResult> {
    const simConfig: StakeholderSimulatorConfig = {
      script: scenario.script,
      strictMode: true,
    };
    const simulator = createStakeholderSimulator(simConfig);
    simulator.startConversation();

    while (!simulator.isCompleted()) {
      const transcript = simulator.getTranscript();
      const currentTurn = transcript.turnCount + 1;
      const candidateResponse = await candidateCallback(transcript.messages, currentTurn);
      simulator.processTurn(candidateResponse);
    }

    const finalTranscript: DialogTranscript = simulator.getTranscript();
    const assertions = simulator.getClarificationAssertions();
    const evaluator = createInterviewEvaluator(scenario.graderConfig ?? this.graderConfig);

    const evaluation = await evaluator.evaluateTranscript(
      finalTranscript,
      scenario.script,
      assertions,
      artifacts,
      scenario.id,
    );

    const minPass =
      scenario.graderConfig?.minPassingScore ?? this.graderConfig.minPassingScore ?? 70;
    const passed = evaluation.scoreBreakdown.overallScore >= minPass;

    return {
      scenarioId: scenario.id,
      modelId: scenario.id,
      passed,
      evaluation,
      transcript: finalTranscript,
    };
  }
}

export async function runInteractiveDialogTest(
  scenario: InteractiveBenchmarkScenario,
  candidateCallback: (messages: readonly DialogMessage[], turn: number) => Promise<string>,
  options: {
    graderConfig?: InterviewGraderConfig;
    artifacts?: Readonly<Record<string, string>>;
  } = {},
): Promise<InteractiveBenchmarkResult> {
  const runner = new InteractiveDialogRunner(options.graderConfig);
  return runner.runScenario(scenario, candidateCallback, options.artifacts ?? {});
}
