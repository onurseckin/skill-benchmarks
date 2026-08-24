import type {
  JudgeEvaluationResult,
  JudgePromptContext,
  JudgeRubricDimension,
  JudgeScoreResult,
} from "./types.js";
import type {
  AgentMessage,
  GenerateOptions,
  LLMProviderAdapter,
} from "../providers/types.js";

export const DEFAULT_RUBRIC_DIMENSIONS: Readonly<
  Record<string, readonly JudgeRubricDimension[]>
> = {
  debugging: [
    {
      name: "Root Cause Identification",
      category: "debugging",
      weight: 0.5,
      description: "Accurately identifies bug mechanism and root cause.",
      criteria: { 1: "Completely misses root cause.", 2: "Identifies symptoms but misdiagnoses cause.", 3: "Identifies cause but misses nuances.", 4: "Accurately identifies root cause.", 5: "Exemplary diagnostic precision." },
      minScore: 1,
      maxScore: 5,
    },
    {
      name: "Fix Correctness and Robustness",
      category: "debugging",
      weight: 0.5,
      description: "Fixes issue cleanly without regressions or side effects.",
      criteria: { 1: "Fails to resolve issue or causes regressions.", 2: "Partially fixes but leaves broken edge cases.", 3: "Resolves issue but is clumsy.", 4: "Cleanly resolves issue with proper boundaries.", 5: "Optimal, elegant, robust fix." },
      minScore: 1,
      maxScore: 5,
    },
  ],
  testing: [
    {
      name: "Test Coverage and Edge Cases",
      category: "testing",
      weight: 0.5,
      description: "Tests cover critical execution paths and boundary conditions.",
      criteria: { 1: "No tests or non-functional tests.", 2: "Minimal tests covering only trivial happy paths.", 3: "Adequate coverage but misses boundaries.", 4: "Comprehensive coverage of paths and errors.", 5: "Exemplary stress/fuzz/boundary testing." },
      minScore: 1,
      maxScore: 5,
    },
    {
      name: "Test Quality and Maintainability",
      category: "testing",
      weight: 0.5,
      description: "Tests are clear, deterministic, isolated, and maintainable.",
      criteria: { 1: "Flaky or coupled tests.", 2: "Poor structure with brittle assertions.", 3: "Acceptable structure with minor issues.", 4: "Clean, idiomatic, well-isolated tests.", 5: "Masterful test design and maintainability." },
      minScore: 1,
      maxScore: 5,
    },
  ],
  security: [
    {
      name: "Vulnerability Remediation",
      category: "security",
      weight: 0.5,
      description: "Remediates security vulnerabilities and eliminates exploit vectors.",
      criteria: { 1: "Leaves vulnerability unmitigated.", 2: "Superficial fix easily bypassed.", 3: "Mitigates primary vector but leaves others open.", 4: "Completely mitigates vulnerability.", 5: "Exemplary security hardening and mitigation." },
      minScore: 1,
      maxScore: 5,
    },
    {
      name: "Secure Coding Practices",
      category: "security",
      weight: 0.5,
      description: "Adheres to secure coding standards and prevents injection/leakage.",
      criteria: { 1: "Introduces dangerous patterns or secrets.", 2: "Neglects input sanitization and error safety.", 3: "Adequate security with minor gaps.", 4: "Strong input validation and safe API usage.", 5: "Flawless adherence to secure standards." },
      minScore: 1,
      maxScore: 5,
    },
  ],
  documentation: [
    {
      name: "Clarity and Completeness",
      category: "documentation",
      weight: 0.5,
      description: "Documentation is accurate, well-structured, and complete.",
      criteria: { 1: "Missing or severely inaccurate.", 2: "Vague, incomplete, or confusing.", 3: "Adequate but lacks depth.", 4: "Clear and thorough.", 5: "Exemplary with full clarity and reference." },
      minScore: 1,
      maxScore: 5,
    },
    {
      name: "Actionable Examples and Guides",
      category: "documentation",
      weight: 0.5,
      description: "Provides correct, copy-pasteable usage examples.",
      criteria: { 1: "No examples or all broken.", 2: "Examples contain errors or omit setup.", 3: "Functional examples for standard usage.", 4: "Clean working examples with steps.", 5: "Flawless real-world examples and edge cases." },
      minScore: 1,
      maxScore: 5,
    },
  ],
  code_review: [
    {
      name: "Defect Detection Accuracy",
      category: "code_review",
      weight: 0.5,
      description: "Identifies defects, logic errors, and architectural flaws.",
      criteria: { 1: "Misses obvious defects or hallucinates.", 2: "Catches minor style issues while missing bugs.", 3: "Identifies primary bugs but misses edge cases.", 4: "Accurately identifies significant defects.", 5: "Exemplary detection of deep subtle flaws." },
      minScore: 1,
      maxScore: 5,
    },
    {
      name: "Constructive Feedback Quality",
      category: "code_review",
      weight: 0.5,
      description: "Provides actionable, polite, and well-reasoned feedback.",
      criteria: { 1: "Unhelpful or purely negative feedback.", 2: "Points out flaws without remediation paths.", 3: "Generic fixes with adequate explanation.", 4: "Clear, actionable suggestions and rationale.", 5: "Masterful mentoring with refactoring guidance." },
      minScore: 1,
      maxScore: 5,
    },
  ],
};

function extractJsonPayload(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  const candidate = match !== null && match[1] !== undefined ? match[1].trim() : trimmed;
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) {
      try {
        const parsed: unknown = JSON.parse(trimmed.slice(first, last + 1));
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

function normalizeScore(rawScore: number, minScore: number, maxScore: number): number {
  if (rawScore > maxScore && rawScore <= 100) return Math.max(0, Math.min(100, Math.round(rawScore * 100) / 100));
  if (maxScore <= minScore) return rawScore >= maxScore ? 100 : 0;
  const clamped = Math.max(0, Math.min(1, (rawScore - minScore) / (maxScore - minScore)));
  return Math.round(clamped * 10000) / 100;
}

export class LLMJudgeEngine {
  public buildJudgePrompt(context: JudgePromptContext): ReadonlyArray<AgentMessage> {
    const rubricText = context.rubrics
      .map((rubric) => {
        const criteriaLines = Object.entries(rubric.criteria)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([score, desc]) => `  Score ${score}: ${desc}`)
          .join("\n");
        return `Dimension: ${rubric.name} [Category: ${rubric.category}, Weight: ${rubric.weight}]\nDescription: ${rubric.description}\nCriteria:\n${criteriaLines}`;
      })
      .join("\n\n");

    const systemPrompt = [
      "You are an impartial, expert evaluation judge evaluating AI coding agent benchmark performance.",
      "Evaluate the agent's work strictly against the provided rubric dimensions.",
      "Score each dimension on an integer scale from 1 to 5 based on the specific criteria defined.",
      "Scoring Scale Reference:",
      "- 1: Unsatisfactory / Failed to meet requirements",
      "- 2: Poor / Partially acceptable with major flaws or gaps",
      "- 3: Competent / Acceptable implementation with minor issues",
      "- 4: Strong / Exceeds standard expectations with high quality",
      "- 5: Exemplary / Masterful implementation with flawless quality",
      "",
      "You MUST respond ONLY with a valid JSON object strictly matching this schema:",
      '{"dimensions": [{"dimensionName": "<name>", "category": "<category>", "score": <1-5>, "justification": "<text>", "strengths": ["<str>"], "weaknesses": ["<weak>"]}], "overallScore": <0-100>, "summary": "<text>", "recommendations": ["<rec>"]}',
    ].join("\n");

    const logs = context.executionLogs !== undefined && context.executionLogs.trim().length > 0
      ? `\n### Execution Logs\n\`\`\`\n${context.executionLogs.trim()}\n\`\`\`\n`
      : "";

    const userPrompt = [
      `# Benchmark Evaluation: ${context.scenarioId}`,
      `## Scenario Description\n${context.scenarioDescription}`,
      `## Agent Task Prompt\n${context.agentPrompt}`,
      logs,
      `## Git Diff Produced by Agent\n\`\`\`diff\n${context.gitDiff.trim().length > 0 ? context.gitDiff : "(No git diff produced)"}\n\`\`\``,
      `## Agent Final Response\n${context.agentFinalMessage.trim().length > 0 ? context.agentFinalMessage : "(No final message)"}`,
      `## Rubric Dimensions\n${rubricText}`,
    ].filter((p) => p.length > 0).join("\n\n");

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
  }

  public parseJudgeResponse(
    responseText: string,
    dimensions: readonly JudgeRubricDimension[]
  ): {
    readonly overallScore: number;
    readonly dimensionScores: readonly JudgeScoreResult[];
    readonly summary: string;
    readonly recommendations: readonly string[];
  } {
    const payload = extractJsonPayload(responseText);
    const rawDimensions = payload !== null && Array.isArray(payload.dimensions) ? payload.dimensions : [];
    const dimensionScores: JudgeScoreResult[] = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const rubric of dimensions) {
      const matched = rawDimensions.find((item): item is Record<string, unknown> => {
        if (typeof item !== "object" || item === null) return false;
        const c = item as Record<string, unknown>;
        const nameMatch = typeof c.dimensionName === "string" && c.dimensionName.toLowerCase() === rubric.name.toLowerCase();
        const catMatch = typeof c.category === "string" && c.category.toLowerCase() === rubric.category.toLowerCase();
        return nameMatch || catMatch;
      });

      let rawScore = 3;
      let justification = "Evaluation derived from rubric assessment.";
      let strengths: readonly string[] = [];
      let weaknesses: readonly string[] = [];

      if (matched !== undefined) {
        if (typeof matched.score === "number" && !Number.isNaN(matched.score)) {
          rawScore = matched.score;
        } else if (typeof matched.score === "string") {
          const parsedNum = parseFloat(matched.score);
          if (!Number.isNaN(parsedNum)) rawScore = parsedNum;
        }
        if (typeof matched.justification === "string" && matched.justification.trim().length > 0) {
          justification = matched.justification.trim();
        }
        strengths = parseStringList(matched.strengths);
        weaknesses = parseStringList(matched.weaknesses);
      }

      const minScore = rubric.minScore ?? 1;
      const maxScore = rubric.maxScore ?? 5;
      const normalizedScore = normalizeScore(rawScore, minScore, maxScore);
      const score = rawScore > maxScore ? minScore + (normalizedScore / 100) * (maxScore - minScore) : rawScore;

      totalWeightedScore += normalizedScore * rubric.weight;
      totalWeight += rubric.weight;

      dimensionScores.push({
        dimensionName: rubric.name,
        category: rubric.category,
        score: Math.round(score * 100) / 100,
        normalizedScore,
        weight: rubric.weight,
        justification,
        strengths: strengths.length > 0 ? strengths : undefined,
        weaknesses: weaknesses.length > 0 ? weaknesses : undefined,
      });
    }

    const calculatedOverall = totalWeight > 0 ? Math.round((totalWeightedScore / totalWeight) * 100) / 100 : 0;
    let overallScore = calculatedOverall;
    if (dimensionScores.length === 0 && payload !== null && typeof payload.overallScore === "number" && !Number.isNaN(payload.overallScore)) {
      overallScore = Math.max(0, Math.min(100, Math.round(payload.overallScore * 100) / 100));
    }

    let summary = "Evaluation completed successfully.";
    if (payload !== null && typeof payload.summary === "string" && payload.summary.trim().length > 0) {
      summary = payload.summary.trim();
    } else if (payload === null) {
      summary = "Evaluation completed with unparseable raw model response.";
    }

    const recommendations = payload !== null ? parseStringList(payload.recommendations) : [];
    return { overallScore, dimensionScores, summary, recommendations };
  }

  public async evaluate(
    context: JudgePromptContext,
    provider: LLMProviderAdapter,
    options?: GenerateOptions
  ): Promise<JudgeEvaluationResult> {
    const startTime = Date.now();
    const messages = this.buildJudgePrompt(context);
    const generateOptions: GenerateOptions = {
      temperature: 0.1,
      responseFormat: { type: "json_object" },
      ...options,
    };

    const turnResponse = await provider.generateTurn(messages, [], generateOptions);
    const latencyMs = turnResponse.totalTurnDurationMs > 0 ? turnResponse.totalTurnDurationMs : Date.now() - startTime;
    const tokenCostUSD = provider.calculateCostUSD(turnResponse.usage);
    const parsed = this.parseJudgeResponse(turnResponse.text, context.rubrics);

    return {
      judgeModelId: provider.modelId,
      overallScore: parsed.overallScore,
      dimensionScores: parsed.dimensionScores,
      summary: parsed.summary,
      recommendations: parsed.recommendations.length > 0 ? parsed.recommendations : undefined,
      latencyMs,
      tokenCostUSD,
      rawJudgeResponse: turnResponse.text,
    };
  }
}

export async function evaluateWithLLMJudge(
  context: JudgePromptContext,
  provider: LLMProviderAdapter,
  options?: GenerateOptions
): Promise<JudgeEvaluationResult> {
  const engine = new LLMJudgeEngine();
  return engine.evaluate(context, provider, options);
}
