import { randomUUID } from "node:crypto";
import type {
  PairwiseCandidate,
  PairwiseEloMatch,
  PairwiseTournamentResult,
  PairwiseWinRateStats,
} from "./types.js";
import type {
  AgentMessage,
  GenerateOptions,
  LLMProviderAdapter,
} from "../providers/types.js";

interface JudgeParsedResponse {
  readonly winner: "candidate_1" | "candidate_2" | "tie";
  readonly confidenceScore: number;
  readonly rationale: string;
}

function extractCandidatePayload(candidate: PairwiseCandidate): string {
  const parts: string[] = [];
  if (candidate.gitDiff?.trim()) parts.push(`--- Diff ---\n${candidate.gitDiff.trim()}`);
  if (candidate.executionOutput?.trim()) parts.push(`--- Execution Output ---\n${candidate.executionOutput.trim()}`);
  if (parts.length === 0 && candidate.finalMessage?.trim()) parts.push(`--- Final Output ---\n${candidate.finalMessage.trim()}`);
  return parts.length > 0 ? parts.join("\n\n") : "(No output provided)";
}

function parseJudgeOutput(rawText: string): JudgeParsedResponse {
  const trimmed = rawText.trim();
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = fenceRegex.exec(trimmed);
  const jsonCandidate = match?.[1] ? match[1].trim() : trimmed;

  let parsedObject: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(jsonCandidate);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      parsedObject = parsed as Record<string, unknown>;
    }
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const sliced = trimmed.slice(firstBrace, lastBrace + 1);
        const parsed: unknown = JSON.parse(sliced);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          parsedObject = parsed as Record<string, unknown>;
        }
      } catch {
        parsedObject = null;
      }
    }
  }

  if (!parsedObject) {
    return { winner: "tie", confidenceScore: 0.5, rationale: trimmed || "Failed to parse judge output JSON" };
  }

  const rawWinner = typeof parsedObject.winner === "string" ? parsedObject.winner.toLowerCase().trim() : "tie";
  let winner: "candidate_1" | "candidate_2" | "tie" = "tie";
  if (rawWinner === "candidate_1" || rawWinner === "1" || rawWinner === "candidate1") {
    winner = "candidate_1";
  } else if (rawWinner === "candidate_2" || rawWinner === "2" || rawWinner === "candidate2") {
    winner = "candidate_2";
  }

  const rawConfidence = parsedObject.confidenceScore;
  const confidenceScore = typeof rawConfidence === "number" && !Number.isNaN(rawConfidence)
    ? Math.max(0, Math.min(1, rawConfidence))
    : 1.0;
  const rationale = typeof parsedObject.rationale === "string" ? parsedObject.rationale.trim() : "";

  return { winner, confidenceScore, rationale };
}

export class BlindPairwiseEloEngine {
  constructor(
    public readonly kFactor: number = 32,
    public readonly initialRating: number = 1500
  ) {}

  public calculateExpectedScore(ratingA: number, ratingB: number): number {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  }

  public updateElo(
    currentRatingA: number,
    currentRatingB: number,
    actualScoreA: number
  ): { readonly newRatingA: number; readonly newRatingB: number } {
    const expectedA = this.calculateExpectedScore(currentRatingA, currentRatingB);
    const expectedB = 1 - expectedA;
    const actualScoreB = 1 - actualScoreA;
    const newRatingA = currentRatingA + this.kFactor * (actualScoreA - expectedA);
    const newRatingB = currentRatingB + this.kFactor * (actualScoreB - expectedB);
    return { newRatingA, newRatingB };
  }

  public calculateWilsonConfidenceInterval(
    wins: number,
    total: number,
    z: number = 1.96
  ): readonly [number, number] {
    if (total === 0) return [0, 0];
    const p = wins / total;
    const z2 = z * z;
    const denom = 1 + z2 / total;
    const center = p + z2 / (2 * total);
    const margin = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
    return [
      Math.max(0, (center - margin) / denom),
      Math.min(1, (center + margin) / denom),
    ];
  }

  public buildComparisonPrompt(
    scenarioPrompt: string,
    output1: string,
    output2: string,
    finalMessage1?: string,
    finalMessage2?: string
  ): ReadonlyArray<AgentMessage> {
    const systemPrompt = "You are an impartial, expert AI benchmark judge evaluating two anonymous candidate solutions for a programming or software engineering task. Evaluate both solutions strictly on correctness, completeness, code quality, edge case handling, and adherence to instructions. Do not show favoritism toward formatting style or position. Focus purely on technical merit. You must provide your evaluation as a valid JSON object matching the requested schema with no commentary outside JSON.";

    const userPrompt = `Task Description / Prompt:
${scenarioPrompt}

=== CANDIDATE 1 OUTPUT ===
${output1}${finalMessage1?.trim() ? `\nCandidate 1 Explanation:\n${finalMessage1.trim()}` : ""}

=== CANDIDATE 2 OUTPUT ===
${output2}${finalMessage2?.trim() ? `\nCandidate 2 Explanation:\n${finalMessage2.trim()}` : ""}

Evaluate both candidates and determine the winner.
Respond strictly with a JSON object in this exact schema:
{
  "winner": "candidate_1" | "candidate_2" | "tie",
  "confidenceScore": 0.0 to 1.0,
  "rationale": "<concise explanation of decision>"
}`;

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
  }

  public async compareBlind(
    candidateA: PairwiseCandidate,
    candidateB: PairwiseCandidate,
    scenarioPrompt: string,
    judgeProvider: LLMProviderAdapter,
    options?: GenerateOptions,
    scenarioId?: string
  ): Promise<PairwiseEloMatch> {
    const outputA = extractCandidatePayload(candidateA);
    const outputB = extractCandidatePayload(candidateB);
    const judgeOptions: GenerateOptions = {
      temperature: 0.0,
      responseFormat: { type: "json_object" },
      ...options,
    };

    const prompt1 = this.buildComparisonPrompt(scenarioPrompt, outputA, outputB, candidateA.finalMessage, candidateB.finalMessage);
    const turn1 = await judgeProvider.generateTurn(prompt1, [], judgeOptions);
    const parsed1 = parseJudgeOutput(turn1.text);

    const prompt2 = this.buildComparisonPrompt(scenarioPrompt, outputB, outputA, candidateB.finalMessage, candidateA.finalMessage);
    const turn2 = await judgeProvider.generateTurn(prompt2, [], judgeOptions);
    const parsed2 = parseJudgeOutput(turn2.text);

    const perm1Winner: "candidate_a" | "candidate_b" | "tie" =
      parsed1.winner === "candidate_1" ? "candidate_a" : parsed1.winner === "candidate_2" ? "candidate_b" : "tie";
    const perm2Winner: "candidate_a" | "candidate_b" | "tie" =
      parsed2.winner === "candidate_1" ? "candidate_b" : parsed2.winner === "candidate_2" ? "candidate_a" : "tie";

    let finalWinner: "candidate_a" | "candidate_b" | "tie";
    let positionBiasDetected = false;

    if (perm1Winner === "candidate_a" && perm2Winner === "candidate_a") {
      finalWinner = "candidate_a";
    } else if (perm1Winner === "candidate_b" && perm2Winner === "candidate_b") {
      finalWinner = "candidate_b";
    } else {
      finalWinner = "tie";
      if (parsed1.winner !== "tie" && parsed2.winner !== "tie" && parsed1.winner === parsed2.winner) {
        positionBiasDetected = true;
      }
    }

    const avgConfidence = Math.round(((parsed1.confidenceScore + parsed2.confidenceScore) / 2) * 100) / 100;
    const rationaleParts: string[] = [];
    if (parsed1.rationale) rationaleParts.push(`Permutation 1 (A as 1, B as 2): ${parsed1.rationale}`);
    if (parsed2.rationale) rationaleParts.push(`Permutation 2 (B as 1, A as 2): ${parsed2.rationale}`);
    if (positionBiasDetected) rationaleParts.push("Position bias detected: Judge favored the same position in both permutations.");

    return {
      matchId: randomUUID(),
      scenarioId: scenarioId ?? "default",
      candidateA,
      candidateB,
      permutation1Winner: perm1Winner,
      permutation2Winner: perm2Winner,
      finalWinner,
      positionBiasDetected,
      judgeModelId: judgeProvider.modelId,
      confidenceScore: avgConfidence,
      rationale: rationaleParts.join(" | "),
      timestamp: new Date().toISOString(),
    };
  }

  public async runTournament(
    candidates: readonly PairwiseCandidate[],
    scenarioPrompts: Readonly<Record<string, string>>,
    judgeProvider: LLMProviderAdapter,
    options?: GenerateOptions
  ): Promise<PairwiseTournamentResult> {
    const ratings: Record<string, number> = {};
    const winCounts: Record<string, { wins: number; losses: number; ties: number }> = {};
    const winMatrix: Record<string, Record<string, { wins: number; losses: number; ties: number }>> = {};

    for (const c of candidates) {
      ratings[c.candidateId] = this.initialRating;
      winCounts[c.candidateId] = { wins: 0, losses: 0, ties: 0 };
      winMatrix[c.candidateId] = {};
    }

    for (const c1 of candidates) {
      for (const c2 of candidates) {
        winMatrix[c1.candidateId]![c2.candidateId] = { wins: 0, losses: 0, ties: 0 };
      }
    }

    const matches: PairwiseEloMatch[] = [];
    const scenarioEntries = Object.entries(scenarioPrompts);

    for (const [scenarioId, scenarioPrompt] of scenarioEntries) {
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const candA = candidates[i]!;
          const candB = candidates[j]!;

          const match = await this.compareBlind(candA, candB, scenarioPrompt, judgeProvider, options, scenarioId);
          matches.push(match);

          const currentRatingA = ratings[candA.candidateId] ?? this.initialRating;
          const currentRatingB = ratings[candB.candidateId] ?? this.initialRating;
          const statsA = winCounts[candA.candidateId]!;
          const statsB = winCounts[candB.candidateId]!;
          const matrixAB = winMatrix[candA.candidateId]![candB.candidateId]!;
          const matrixBA = winMatrix[candB.candidateId]![candA.candidateId]!;

          let actualScoreA: number;
          if (match.finalWinner === "candidate_a") {
            actualScoreA = 1.0;
            statsA.wins += 1;
            statsB.losses += 1;
            matrixAB.wins += 1;
            matrixBA.losses += 1;
          } else if (match.finalWinner === "candidate_b") {
            actualScoreA = 0.0;
            statsA.losses += 1;
            statsB.wins += 1;
            matrixAB.losses += 1;
            matrixBA.wins += 1;
          } else {
            actualScoreA = 0.5;
            statsA.ties += 1;
            statsB.ties += 1;
            matrixAB.ties += 1;
            matrixBA.ties += 1;
          }

          const { newRatingA, newRatingB } = this.updateElo(currentRatingA, currentRatingB, actualScoreA);
          ratings[candA.candidateId] = newRatingA;
          ratings[candB.candidateId] = newRatingB;
        }
      }
    }

    const winRates: Record<string, PairwiseWinRateStats> = {};
    for (const c of candidates) {
      const stats = winCounts[c.candidateId]!;
      const totalMatches = stats.wins + stats.losses + stats.ties;
      const winRate = totalMatches > 0 ? stats.wins / totalMatches : 0;
      const wilsonConfidenceInterval = this.calculateWilsonConfidenceInterval(stats.wins, totalMatches);

      winRates[c.candidateId] = {
        wins: stats.wins,
        losses: stats.losses,
        ties: stats.ties,
        totalMatches,
        winRate,
        wilsonConfidenceInterval,
      };
    }

    return {
      totalMatches: matches.length,
      matches,
      ratings,
      winRates,
      winMatrix,
      kFactor: this.kFactor,
      initialRating: this.initialRating,
    };
  }
}
