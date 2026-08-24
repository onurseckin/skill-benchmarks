import { randomUUID } from "node:crypto";
import type {
  ArenaModelParticipant,
  DebateCritiquePoint,
  DebateCritiqueSeverity,
  DebateEngineOptions,
  DebateProtocolConfig,
  DebateRound,
  DebateTranscript,
  DebateTurn,
  DebateTurnTokenUsage,
  DebateTurnType,
} from "./types.js";

function parseSeverity(raw: string): DebateCritiqueSeverity {
  const normalized = raw.toLowerCase().trim();
  if (normalized.includes("critical")) return "critical";
  if (normalized.includes("major")) return "major";
  if (normalized.includes("minor")) return "minor";
  if (normalized.includes("praise") || normalized.includes("positive")) return "praise";
  return "neutral";
}

function extractCritiquePoints(text: string): readonly DebateCritiquePoint[] {
  const points: DebateCritiquePoint[] = [];
  const lines = text.split("\n");
  let currentDimension = "general";
  let currentSeverity: DebateCritiqueSeverity = "major";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("###") || trimmed.startsWith("##") || trimmed.startsWith("**[")) {
      const lower = trimmed.toLowerCase();
      if (lower.includes("correctness") || lower.includes("bug") || lower.includes("error")) {
        currentDimension = "correctness";
      } else if (lower.includes("security") || lower.includes("vulnerability")) {
        currentDimension = "security";
      } else if (lower.includes("performance") || lower.includes("efficiency")) {
        currentDimension = "efficiency";
      } else if (lower.includes("architecture") || lower.includes("design")) {
        currentDimension = "architecture";
      } else if (lower.includes("clarity") || lower.includes("maintainability")) {
        currentDimension = "clarity";
      }
      currentSeverity = parseSeverity(trimmed);
    }

    if (trimmed.startsWith("-") || trimmed.startsWith("*") || /^\d+\./.test(trimmed)) {
      const claimText = trimmed.replace(/^[-*]|\d+\./, "").trim();
      if (claimText.length > 5) {
        const severity = parseSeverity(claimText);
        points.push({
          id: randomUUID(),
          dimension: currentDimension,
          severity: severity !== "neutral" ? severity : currentSeverity,
          claim: claimText,
          isResolved: false,
        });
      }
    }
  }

  if (points.length === 0 && text.trim().length > 0) {
    points.push({
      id: randomUUID(),
      dimension: "general",
      severity: "neutral",
      claim: text.slice(0, 200).trim(),
      isResolved: false,
    });
  }

  return points;
}

function simulateModelResponse(
  participant: ArenaModelParticipant,
  turnType: DebateTurnType,
  topic: string,
  roundNumber: number
): { readonly text: string; readonly tokenUsage: DebateTurnTokenUsage } {
  const pName = participant.name;
  let text = "";

  if (turnType === "proposal") {
    text = `Proposal by ${pName} for: ${topic}\n\nKey Solution Architecture:\n- Implements deterministic state synchronization\n- Enforces strict input validation and boundary checks\n- Optimizes compute latency using localized caches\n- Mitigates edge failure conditions via graceful fallback protocols`;
  } else if (turnType === "critique") {
    text = `Critique by ${pName} on Round ${roundNumber}:\n\n### Correctness Analysis (Major)\n- Error handling omits recovery path when network partition occurs during synchronization\n- Boundary check lacks upper bound assertion on buffer overflow vector\n\n### Efficiency & Performance (Minor)\n- Local cache eviction strategy may cause elevated GC pressure under continuous throughput`;
  } else if (turnType === "rebuttal") {
    text = `Rebuttal by ${pName}:\n\n- Addressed partition recovery: Injected exponential backoff retry loop with idempotency keys\n- Addressed buffer bounds: Enforced fixed-size ring buffer with strict clamp on byte allocation\n- Acknowledged cache eviction note: Migrated to segmented LRU pool with zero-allocation ring`;
  } else if (turnType === "cross_examination") {
    text = `Cross-examination by ${pName}:\n\n- Querying idempotency key persistence: How are keys pruned across long-lived network stalls?\n- Querying ring buffer overflow: What happens when write throughput exceeds consumer drain rate for > 5000ms?`;
  } else {
    text = `Closing Statement by ${pName}:\n\nFinal Position Summary: The proposed system addresses core correctness and safety concerns with acceptable trade-offs. Residual risks are bounded and mitigated by defensive runtime checks.`;
  }

  const promptTokens = Math.max(50, Math.floor((topic.length + text.length) / 4));
  const completionTokens = Math.max(20, Math.floor(text.length / 4));
  return {
    text,
    tokenUsage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  };
}

export class DebateEngine {
  private readonly defaultTimeoutMs: number;
  private readonly maxCrossExamRounds: number;
  private readonly callModelFn?: (
    participant: ArenaModelParticipant,
    systemPrompt: string,
    prompt: string
  ) => Promise<{ readonly text: string; readonly tokenUsage?: DebateTurnTokenUsage }>;

  public constructor(options?: DebateEngineOptions) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 30000;
    this.maxCrossExamRounds = options?.maxCrossExamRounds ?? 2;
    this.callModelFn = options?.callModel;
  }

  private async executeTurn(
    participant: ArenaModelParticipant,
    turnType: DebateTurnType,
    roundNumber: number,
    prompt: string,
    systemPrompt: string,
    targetTurnId?: string,
    targetAuthorId?: string
  ): Promise<DebateTurn> {
    const startTime = Date.now();
    let content = "";
    let tokenUsage: DebateTurnTokenUsage | undefined;

    if (this.callModelFn) {
      const response = await this.callModelFn(participant, systemPrompt, prompt);
      content = response.text;
      tokenUsage = response.tokenUsage;
    } else {
      const sim = simulateModelResponse(participant, turnType, prompt, roundNumber);
      content = sim.text;
      tokenUsage = sim.tokenUsage;
    }

    const executionTimeMs = Date.now() - startTime;
    const critiquePoints = turnType === "critique" || turnType === "cross_examination"
      ? extractCritiquePoints(content)
      : undefined;

    return {
      turnId: randomUUID(),
      roundNumber,
      turnType,
      author: participant,
      targetTurnId,
      targetAuthorId,
      content,
      timestamp: Date.now(),
      critiquePoints,
      confidenceScore: participant.role === "proposer" ? 0.9 : 0.85,
      executionTimeMs,
      tokenUsage,
    };
  }

  public async runDebate(config: DebateProtocolConfig): Promise<DebateTranscript> {
    const debateId = randomUUID();
    const startTime = Date.now();
    const rounds: DebateRound[] = [];
    let totalTurns = 0;

    const round1StartTime = Date.now();
    const round1Turns: DebateTurn[] = [];

    const proposerPrompt = `Topic: ${config.topic}\nScenario: ${config.scenarioId ?? "standard"}\nProvide your comprehensive solution proposal.`;
    const proposerSystem = config.proposerModel.systemPrompt ?? "You are the primary proposer presenting a robust technical solution.";
    const proposalTurn = await this.executeTurn(
      config.proposerModel,
      "proposal",
      1,
      proposerPrompt,
      proposerSystem
    );
    round1Turns.push(proposalTurn);
    totalTurns += 1;

    for (const critic of config.criticModels) {
      const criticPrompt = `Review the proposal below and provide a rigorous critique identifying flaws, edge cases, and safety vulnerabilities.\n\nProposal:\n${proposalTurn.content}`;
      const criticSystem = critic.systemPrompt ?? "You are a critical technical peer reviewer looking for flaws, bugs, and edge cases.";
      const critiqueTurn = await this.executeTurn(
        critic,
        "critique",
        1,
        criticPrompt,
        criticSystem,
        proposalTurn.turnId,
        config.proposerModel.id
      );
      round1Turns.push(critiqueTurn);
      totalTurns += 1;
    }

    if (config.allowRebuttals ?? true) {
      const allCritiques = round1Turns
        .filter((t) => t.turnType === "critique")
        .map((t) => `${t.author.name}:\n${t.content}`)
        .join("\n\n---\n\n");
      const rebuttalPrompt = `Respond to the following critiques by defending your position or providing concrete remediations.\n\nCritiques:\n${allCritiques}`;
      const rebuttalTurn = await this.executeTurn(
        config.proposerModel,
        "rebuttal",
        1,
        rebuttalPrompt,
        proposerSystem,
        undefined,
        undefined
      );
      round1Turns.push(rebuttalTurn);
      totalTurns += 1;
    }

    rounds.push({
      roundNumber: 1,
      turns: round1Turns,
      startedAt: round1StartTime,
      completedAt: Date.now(),
      summary: `Round 1 completed with 1 proposal, ${config.criticModels.length} critiques, and 1 rebuttal.`,
    });

    const crossExamLimit = Math.min(config.maxRounds - 1, config.crossExaminationRounds ?? this.maxCrossExamRounds);
    for (let r = 0; r < crossExamLimit; r++) {
      const roundNum = r + 2;
      const roundStartTime = Date.now();
      const roundTurns: DebateTurn[] = [];

      for (const critic of config.criticModels) {
        const lastRebuttal = rounds[rounds.length - 1]?.turns.find((t) => t.turnType === "rebuttal" || t.turnType === "proposal");
        const crossPrompt = `Cross-examine the author on their latest responses:\n${lastRebuttal?.content ?? ""}`;
        const crossSystem = critic.systemPrompt ?? "You are cross-examining the proposer on unresolved claims.";
        const crossTurn = await this.executeTurn(
          critic,
          "cross_examination",
          roundNum,
          crossPrompt,
          crossSystem,
          lastRebuttal?.turnId,
          config.proposerModel.id
        );
        roundTurns.push(crossTurn);
        totalTurns += 1;
      }

      const allCrossExams = roundTurns
        .filter((t) => t.turnType === "cross_examination")
        .map((t) => `${t.author.name}:\n${t.content}`)
        .join("\n\n");
      const defensePrompt = `Provide your final defense addressing all cross-examination questions:\n\n${allCrossExams}`;
      const defenseTurn = await this.executeTurn(
        config.proposerModel,
        "rebuttal",
        roundNum,
        defensePrompt,
        proposerSystem
      );
      roundTurns.push(defenseTurn);
      totalTurns += 1;

      rounds.push({
        roundNumber: roundNum,
        turns: roundTurns,
        startedAt: roundStartTime,
        completedAt: Date.now(),
        summary: `Round ${roundNum} cross-examination concluded.`,
      });
    }

    const finalRoundNum = rounds.length + 1;
    const finalStartTime = Date.now();
    const finalTurns: DebateTurn[] = [];

    for (const critic of config.criticModels) {
      const closingPrompt = `Provide your final closing statement on this debate. State whether the solution is acceptable and summarize residual risks.`;
      const closingTurn = await this.executeTurn(
        critic,
        "closing_statement",
        finalRoundNum,
        closingPrompt,
        critic.systemPrompt ?? "Provide closing assessment."
      );
      finalTurns.push(closingTurn);
      totalTurns += 1;
    }

    const proposerClosing = await this.executeTurn(
      config.proposerModel,
      "closing_statement",
      finalRoundNum,
      "Provide your final closing summary emphasizing key strengths and safety boundaries.",
      proposerSystem
    );
    finalTurns.push(proposerClosing);
    totalTurns += 1;

    rounds.push({
      roundNumber: finalRoundNum,
      turns: finalTurns,
      startedAt: finalStartTime,
      completedAt: Date.now(),
      summary: `Final closing statements completed.`,
    });

    return {
      debateId,
      config,
      rounds,
      status: "completed",
      startedAt: startTime,
      completedAt: Date.now(),
      totalTurns,
      metadata: {
        totalRounds: rounds.length,
        durationMs: Date.now() - startTime,
      },
    };
  }

  public formatTranscriptAsText(transcript: DebateTranscript): string {
    const lines: string[] = [];
    lines.push(`=== DEBATE TRANSCRIPT: ${transcript.config.topic} ===`);
    lines.push(`Status: ${transcript.status} | Total Rounds: ${transcript.rounds.length} | Total Turns: ${transcript.totalTurns}`);
    lines.push("");

    for (const round of transcript.rounds) {
      lines.push(`--- Round ${round.roundNumber} ---`);
      for (const turn of round.turns) {
        lines.push(`[${turn.turnType.toUpperCase()}] by ${turn.author.name} (${turn.author.modelId}):`);
        lines.push(turn.content);
        if (turn.critiquePoints && turn.critiquePoints.length > 0) {
          lines.push(`  Identified Critique Points:`);
          for (const cp of turn.critiquePoints) {
            lines.push(`  - [${cp.severity.toUpperCase()}] (${cp.dimension}) ${cp.claim}`);
          }
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  public getUnresolvedCritiques(transcript: DebateTranscript): readonly DebateCritiquePoint[] {
    const unresolved: DebateCritiquePoint[] = [];
    for (const round of transcript.rounds) {
      for (const turn of round.turns) {
        if (turn.critiquePoints) {
          for (const cp of turn.critiquePoints) {
            if (!cp.isResolved) {
              unresolved.push(cp);
            }
          }
        }
      }
    }
    return unresolved;
  }
}
