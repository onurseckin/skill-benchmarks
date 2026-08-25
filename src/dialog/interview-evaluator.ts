import type {
  ArtifactCriterionResult,
  ArtifactEvaluationResult,
  ArtifactType,
  ClarificationAssertion,
  ClarificationTopic,
  DialogEvaluationResult,
  DialogMessage,
  DialogScoreBreakdown,
  DialogTranscript,
  InterviewGraderConfig,
  InterviewScript,
} from "./types.js";
import { StakeholderSimulator } from "./stakeholder-simulator.js";

void StakeholderSimulator;

export class InterviewEvaluator {
  private readonly config: InterviewGraderConfig;

  constructor(config: InterviewGraderConfig = {}) {
    this.config = config;
  }

  public async evaluateTranscript(
    transcript: DialogTranscript,
    script: InterviewScript,
    assertions: readonly ClarificationAssertion[],
    artifacts: Readonly<Record<string, string>> = {},
    candidateModelId = "candidate-model"
  ): Promise<DialogEvaluationResult> {
    const startTime = Date.now();

    const clarificationResult = this.evaluateClarificationCoverage(assertions, script.clarificationTopics);
    const questionQualityScore = this.evaluateQuestionQuality(transcript, script);
    const domainDepthScore = this.evaluateDomainDepth(transcript, script);
    const requirementCoverageScore = this.evaluateRequirementCoverage(assertions, transcript, script);
    const artifactEvaluations = this.evaluateArtifacts(artifacts, script);

    let artifactQualityScore = 100;
    if (artifactEvaluations.length > 0) {
      const sum = artifactEvaluations.reduce((acc, curr) => acc + curr.score, 0);
      artifactQualityScore = Math.round(sum / artifactEvaluations.length);
    }

    const weights = {
      clarification: this.config.weights?.clarification ?? 0.3,
      requirementCoverage: this.config.weights?.requirementCoverage ?? 0.25,
      questionQuality: this.config.weights?.questionQuality ?? 0.2,
      domainDepth: this.config.weights?.domainDepth ?? 0.15,
      artifactQuality: this.config.weights?.artifactQuality ?? 0.1,
    };

    const overallScore = Math.round(
      clarificationResult.score * weights.clarification +
      requirementCoverageScore * weights.requirementCoverage +
      questionQualityScore * weights.questionQuality +
      domainDepthScore * weights.domainDepth +
      artifactQualityScore * weights.artifactQuality
    );

    const scoreBreakdown: DialogScoreBreakdown = {
      clarificationScore: clarificationResult.score,
      requirementCoverageScore,
      questionQualityScore,
      domainDepthScore,
      artifactQualityScore,
      overallScore,
    };

    const strengths: string[] = [];
    const weaknesses: string[] = [];

    if (clarificationResult.score >= 80) {
      strengths.push("Thoroughly clarified ambiguous requirements and hidden constraints early.");
    } else if (clarificationResult.score < 50) {
      weaknesses.push("Failed to proactively clarify key ambiguities before proposing solutions.");
    }

    if (questionQualityScore >= 80) {
      strengths.push("Asked precise, high-signal questions tailored to stakeholder concerns.");
    } else if (questionQualityScore < 60) {
      weaknesses.push("Questions were either overly vague or prematurely prescriptive.");
    }

    if (domainDepthScore >= 80) {
      strengths.push("Demonstrated deep understanding of domain trade-offs and edge cases.");
    }

    if (artifactEvaluations.some((a) => !a.passed)) {
      weaknesses.push("One or more generated artifacts did not meet structural or content criteria.");
    }

    const summary = `Multi-turn interview evaluation completed with overall score ${overallScore}/100 (${overallScore >= (this.config.minPassingScore ?? 70) ? "PASSED" : "FAILED"}).`;

    return {
      conversationId: transcript.conversationId,
      scriptId: script.id,
      candidateModelId,
      scoreBreakdown,
      clarificationAssertions: clarificationResult.assertions,
      artifactEvaluations,
      summary,
      strengths,
      weaknesses,
      durationMs: Date.now() - startTime,
    };
  }

  private evaluateClarificationCoverage(
    assertions: readonly ClarificationAssertion[],
    topics: readonly ClarificationTopic[]
  ): { score: number; assertions: readonly ClarificationAssertion[] } {
    if (topics.length === 0) {
      return { score: 100, assertions };
    }

    let earnedPoints = 0;
    let totalPossible = 0;
    const resolvedAssertions: ClarificationAssertion[] = [];

    for (const topic of topics) {
      const weight = topic.requiredToAsk ? 20 : 10;
      totalPossible += weight;

      const assertion = assertions.find((a) => a.topicId === topic.id);
      if (!assertion || assertion.status === "missed") {
        resolvedAssertions.push(assertion ?? {
          topicId: topic.id,
          status: "missed",
          scoreImpact: -topic.penaltyIfNotAsked,
          details: `Topic "${topic.id}" was required but never clarified.`,
        });
      } else if (assertion.status === "clarified") {
        earnedPoints += weight + topic.bonusIfAskedEarly;
        resolvedAssertions.push(assertion);
      } else if (assertion.status === "clarified_late") {
        earnedPoints += weight * 0.7;
        resolvedAssertions.push(assertion);
      } else if (assertion.status === "partially_clarified") {
        earnedPoints += weight * 0.5;
        resolvedAssertions.push(assertion);
      }
    }

    const normalized = Math.min(100, Math.max(0, Math.round((earnedPoints / totalPossible) * 100)));
    return { score: normalized, assertions: resolvedAssertions };
  }

  private evaluateQuestionQuality(transcript: DialogTranscript, script: InterviewScript): number {
    const agentMessages = transcript.messages.filter((m) => m.role === "agent");
    if (agentMessages.length === 0) {
      return 0;
    }

    let qualityPoints = 0;
    const totalTurns = agentMessages.length;

    for (const msg of agentMessages) {
      const content = msg.content.toLowerCase();
      let turnPoints = 50;

      if (content.includes("?")) {
        turnPoints += 20;
      }

      const specificTerms = ["constraint", "requirement", "latency", "scalability", "failure", "trade-off", "sla", "edge case"];
      const matchesSpecific = specificTerms.filter((term) => content.includes(term)).length;
      turnPoints += Math.min(30, matchesSpecific * 10);

      if (content.includes("i will just") || content.includes("assuming that") || content.includes("i decided to")) {
        turnPoints -= 15;
      }

      qualityPoints += Math.max(0, Math.min(100, turnPoints));
    }

    return Math.round(qualityPoints / totalTurns);
  }

  private evaluateDomainDepth(transcript: DialogTranscript, script: InterviewScript): number {
    const agentMessages = transcript.messages.filter((m) => m.role === "agent");
    if (agentMessages.length === 0) {
      return 0;
    }

    const domainKeys = Object.keys(script.persona.domainKnowledge).map((k) => k.toLowerCase());
    let domainHits = 0;

    for (const msg of agentMessages) {
      const content = msg.content.toLowerCase();
      for (const key of domainKeys) {
        if (content.includes(key)) {
          domainHits += 1;
        }
      }
    }

    const baselineRatio = domainKeys.length > 0 ? domainHits / (domainKeys.length * 1.5) : 1;
    return Math.min(100, Math.round(baselineRatio * 100));
  }

  private evaluateRequirementCoverage(
    assertions: readonly ClarificationAssertion[],
    transcript: DialogTranscript,
    script: InterviewScript
  ): number {
    const totalReqs = script.persona.ambiguousRequirements.length + script.persona.hiddenConstraints.length;
    if (totalReqs === 0) {
      return 100;
    }

    const clarifiedCount = assertions.filter(
      (a) => a.status === "clarified" || a.status === "clarified_late"
    ).length;

    return Math.min(100, Math.round((clarifiedCount / Math.max(1, script.clarificationTopics.length)) * 100));
  }

  private evaluateArtifacts(
    artifacts: Readonly<Record<string, string>>,
    script: InterviewScript
  ): readonly ArtifactEvaluationResult[] {
    const results: ArtifactEvaluationResult[] = [];
    const requiredTypes = script.requiredArtifactTypes ?? [];

    for (const type of requiredTypes) {
      const content = artifacts[type];
      if (!content) {
        results.push({
          artifactType: type,
          passed: false,
          score: 0,
          criteriaResults: [{
            name: "Artifact Presence",
            description: `Artifact of type ${type} must be provided`,
            passed: false,
            weight: 100,
            score: 0,
            feedback: `Missing required artifact ${type}`,
          }],
          summary: `Required artifact ${type} was not generated.`,
        });
        continue;
      }

      results.push(this.gradeArtifactContent(type, content));
    }

    for (const [key, content] of Object.entries(artifacts)) {
      if (!requiredTypes.includes(key as ArtifactType)) {
        results.push(this.gradeArtifactContent(key as ArtifactType, content));
      }
    }

    return results;
  }

  private gradeArtifactContent(type: ArtifactType, content: string): ArtifactEvaluationResult {
    const criteria: ArtifactCriterionResult[] = [];
    const lower = content.toLowerCase();

    switch (type) {
      case "adr": {
        const hasContext = lower.includes("context") || lower.includes("background");
        const hasDecision = lower.includes("decision") || lower.includes("choice");
        const hasConsequences = lower.includes("consequences") || lower.includes("trade-offs");
        const hasAlternatives = lower.includes("alternatives") || lower.includes("considered");

        criteria.push(
          { name: "Context & Problem Statement", description: "Describes background and requirements", passed: hasContext, weight: 25, score: hasContext ? 25 : 0 },
          { name: "Decision", description: "Clearly states the chosen architectural decision", passed: hasDecision, weight: 30, score: hasDecision ? 30 : 0 },
          { name: "Consequences & Trade-offs", description: "Analyzes positive and negative impacts", passed: hasConsequences, weight: 25, score: hasConsequences ? 25 : 0 },
          { name: "Alternatives Considered", description: "Evaluates other possible approaches", passed: hasAlternatives, weight: 20, score: hasAlternatives ? 20 : 0 }
        );
        break;
      }
      case "bug_report": {
        const hasRootCause = lower.includes("root cause") || lower.includes("analysis");
        const hasRepro = lower.includes("reproduce") || lower.includes("steps");
        const hasFix = lower.includes("fix") || lower.includes("solution") || lower.includes("patch");

        criteria.push(
          { name: "Root Cause Analysis", description: "Identifies source defect accurately", passed: hasRootCause, weight: 40, score: hasRootCause ? 40 : 0 },
          { name: "Reproduction Steps", description: "Clear steps to recreate the issue", passed: hasRepro, weight: 30, score: hasRepro ? 30 : 0 },
          { name: "Remediation", description: "Proposes robust fix without regressions", passed: hasFix, weight: 30, score: hasFix ? 30 : 0 }
        );
        break;
      }
      case "code_review": {
        const hasSummary = lower.includes("summary") || lower.includes("overview");
        const hasIssues = lower.includes("issue") || lower.includes("finding") || lower.includes("defect");
        const hasRecommendations = lower.includes("recommendation") || lower.includes("suggestion");

        criteria.push(
          { name: "Review Summary", description: "High-level summary of reviewed changes", passed: hasSummary, weight: 30, score: hasSummary ? 30 : 0 },
          { name: "Actionable Findings", description: "Identifies concrete issues or defects", passed: hasIssues, weight: 40, score: hasIssues ? 40 : 0 },
          { name: "Constructive Guidance", description: "Gives clear fix guidance", passed: hasRecommendations, weight: 30, score: hasRecommendations ? 30 : 0 }
        );
        break;
      }
      case "spec":
      case "markdown":
      default: {
        const hasStructure = content.includes("#") && content.length > 100;
        const hasRequirements = lower.includes("requirement") || lower.includes("scope");
        criteria.push(
          { name: "Structured Markdown", description: "Proper headings and organization", passed: hasStructure, weight: 50, score: hasStructure ? 50 : 0 },
          { name: "Scope & Requirements", description: "Detailed specification points", passed: hasRequirements, weight: 50, score: hasRequirements ? 50 : 0 }
        );
        break;
      }
    }

    const totalScore = criteria.reduce((sum, c) => sum + c.score, 0);
    const passed = totalScore >= 70;

    return {
      artifactType: type,
      passed,
      score: totalScore,
      criteriaResults: criteria,
      summary: `Artifact ${type} scored ${totalScore}/100 (${passed ? "PASSED" : "FAILED"}).`,
    };
  }
}

export function createInterviewEvaluator(config?: InterviewGraderConfig): InterviewEvaluator {
  return new InterviewEvaluator(config);
}

