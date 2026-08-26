import type { ArtifactCriterionResult, ArtifactEvaluationResult, ArtifactType } from "./types.js";

export function gradeInterviewArtifact(
  type: ArtifactType,
  content: string,
): ArtifactEvaluationResult {
  const criteria: ArtifactCriterionResult[] = [];
  const lower = content.toLowerCase();
  switch (type) {
    case "adr": {
      const hasContext = lower.includes("context") || lower.includes("background");
      const hasDecision = lower.includes("decision") || lower.includes("choice");
      const hasConsequences = lower.includes("consequences") || lower.includes("trade-offs");
      const hasAlternatives = lower.includes("alternatives") || lower.includes("considered");
      criteria.push(
        {
          name: "Context & Problem Statement",
          description: "Describes background and requirements",
          passed: hasContext,
          weight: 25,
          score: hasContext ? 25 : 0,
        },
        {
          name: "Decision",
          description: "Clearly states the chosen architectural decision",
          passed: hasDecision,
          weight: 30,
          score: hasDecision ? 30 : 0,
        },
        {
          name: "Consequences & Trade-offs",
          description: "Analyzes positive and negative impacts",
          passed: hasConsequences,
          weight: 25,
          score: hasConsequences ? 25 : 0,
        },
        {
          name: "Alternatives Considered",
          description: "Evaluates other possible approaches",
          passed: hasAlternatives,
          weight: 20,
          score: hasAlternatives ? 20 : 0,
        },
      );
      break;
    }
    case "bug_report": {
      const hasRootCause = lower.includes("root cause") || lower.includes("analysis");
      const hasRepro = lower.includes("reproduce") || lower.includes("steps");
      const hasFix = lower.includes("fix") || lower.includes("solution") || lower.includes("patch");
      criteria.push(
        {
          name: "Root Cause Analysis",
          description: "Identifies source defect accurately",
          passed: hasRootCause,
          weight: 40,
          score: hasRootCause ? 40 : 0,
        },
        {
          name: "Reproduction Steps",
          description: "Clear steps to recreate the issue",
          passed: hasRepro,
          weight: 30,
          score: hasRepro ? 30 : 0,
        },
        {
          name: "Remediation",
          description: "Proposes robust fix without regressions",
          passed: hasFix,
          weight: 30,
          score: hasFix ? 30 : 0,
        },
      );
      break;
    }
    case "code_review": {
      const hasSummary = lower.includes("summary") || lower.includes("overview");
      const hasIssues =
        lower.includes("issue") || lower.includes("finding") || lower.includes("defect");
      const hasRecommendations = lower.includes("recommendation") || lower.includes("suggestion");
      criteria.push(
        {
          name: "Review Summary",
          description: "High-level summary of reviewed changes",
          passed: hasSummary,
          weight: 30,
          score: hasSummary ? 30 : 0,
        },
        {
          name: "Actionable Findings",
          description: "Identifies concrete issues or defects",
          passed: hasIssues,
          weight: 40,
          score: hasIssues ? 40 : 0,
        },
        {
          name: "Constructive Guidance",
          description: "Gives clear fix guidance",
          passed: hasRecommendations,
          weight: 30,
          score: hasRecommendations ? 30 : 0,
        },
      );
      break;
    }
    case "spec":
    case "markdown":
    default: {
      const hasStructure = content.includes("#") && content.length > 100;
      const hasRequirements = lower.includes("requirement") || lower.includes("scope");
      criteria.push(
        {
          name: "Structured Markdown",
          description: "Proper headings and organization",
          passed: hasStructure,
          weight: 50,
          score: hasStructure ? 50 : 0,
        },
        {
          name: "Scope & Requirements",
          description: "Detailed specification points",
          passed: hasRequirements,
          weight: 50,
          score: hasRequirements ? 50 : 0,
        },
      );
      break;
    }
  }
  const totalScore = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
  const passed = totalScore >= 70;
  return {
    artifactType: type,
    passed,
    score: totalScore,
    criteriaResults: criteria,
    summary: `Artifact ${type} scored ${totalScore}/100 (${passed ? "PASSED" : "FAILED"}).`,
  };
}
