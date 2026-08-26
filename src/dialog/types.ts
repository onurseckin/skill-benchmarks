export type StakeholderRole =
  | "product_manager"
  | "security_engineer"
  | "tech_lead"
  | "qa_engineer"
  | "domain_expert"
  | "executive"
  | "end_user"
  | "architect"
  | "compliance_officer"
  | (string & {});

export type PersonaTone =
  | "cooperative"
  | "skeptical"
  | "vague"
  | "pedantic"
  | "impatient"
  | "technical"
  | "supportive"
  | "demanding";

export type DialogMessageRole = "stakeholder" | "agent" | "system" | "evaluator";

export type ScriptTriggerType =
  | "keyword_match"
  | "regex_match"
  | "topic_reference"
  | "turn_count"
  | "assumption_detected"
  | "direct_question"
  | "fallback";

export type ClarificationAssertionStatus =
  | "clarified"
  | "missed"
  | "clarified_late"
  | "unnecessary_clarification"
  | "partially_clarified";

export type ArtifactType =
  | "adr"
  | "spec"
  | "bug_report"
  | "code_review"
  | "markdown"
  | "test_plan"
  | "architecture_doc";

export interface PersonaConfig {
  readonly id: string;
  readonly name: string;
  readonly role: StakeholderRole;
  readonly tone: PersonaTone;
  readonly background: string;
  readonly hiddenConstraints: readonly string[];
  readonly ambiguousRequirements: readonly string[];
  readonly domainKnowledge: Readonly<Record<string, string>>;
  readonly communicationStyle?: string;
}

export interface ClarificationTopic {
  readonly id: string;
  readonly description: string;
  readonly requiredToAsk: boolean;
  readonly targetAmbiguity: string;
  readonly penaltyIfNotAsked: number;
  readonly bonusIfAskedEarly: number;
  readonly triggerKeywords: readonly string[];
  readonly revealedDetails: string;
}

export interface ScriptTrigger {
  readonly id: string;
  readonly type: ScriptTriggerType;
  readonly pattern?: string;
  readonly keywords?: readonly string[];
  readonly minTurn?: number;
  readonly maxTurn?: number;
  readonly targetTopicId?: string;
}

export interface ScriptTriggerResponse {
  readonly trigger: ScriptTrigger;
  readonly responseText: string;
  readonly tone?: PersonaTone;
  readonly revealConstraintIndices?: readonly number[];
  readonly revealTopicIds?: readonly string[];
  readonly metadataUpdate?: Readonly<Record<string, string | number | boolean>>;
}

export interface InterviewScriptTurn {
  readonly turnNumber: number;
  readonly expectedTopics: readonly string[];
  readonly triggerResponses: readonly ScriptTriggerResponse[];
  readonly defaultResponse: string;
  readonly injectPushbackIfNoQuestion?: boolean;
  readonly pushbackMessage?: string;
}

export interface InterviewScript {
  readonly id: string;
  readonly title: string;
  readonly targetSkill: "grill-me" | "diagnosing-bugs" | "code-review" | (string & {});
  readonly initialPrompt: string;
  readonly persona: PersonaConfig;
  readonly turns: readonly InterviewScriptTurn[];
  readonly clarificationTopics: readonly ClarificationTopic[];
  readonly maxTurns: number;
  readonly requiredArtifactTypes?: readonly ArtifactType[];
}

export interface DialogMessage {
  readonly id: string;
  readonly role: DialogMessageRole;
  readonly content: string;
  readonly timestamp: number;
  readonly turn: number;
  readonly metadata?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

export interface DialogTranscript {
  readonly conversationId: string;
  readonly scriptId: string;
  readonly personaId: string;
  readonly messages: readonly DialogMessage[];
  readonly turnCount: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface DialogTurnResponse {
  readonly message: DialogMessage;
  readonly matchedTriggerId?: string;
  readonly revealedTopics: readonly string[];
  readonly revealedConstraints: readonly string[];
  readonly pushbackTriggered: boolean;
  readonly isCompleted: boolean;
}

export interface ClarificationAssertion {
  readonly topicId: string;
  readonly status: ClarificationAssertionStatus;
  readonly turnAsked?: number;
  readonly questionSnippet?: string;
  readonly scoreImpact: number;
  readonly details: string;
}

export interface ArtifactCriterionResult {
  readonly name: string;
  readonly description: string;
  readonly passed: boolean;
  readonly weight: number;
  readonly score: number;
  readonly feedback?: string;
}

export interface ArtifactEvaluationResult {
  readonly artifactType: ArtifactType;
  readonly passed: boolean;
  readonly score: number;
  readonly criteriaResults: readonly ArtifactCriterionResult[];
  readonly summary: string;
}

export interface DialogScoreBreakdown {
  readonly clarificationScore: number;
  readonly requirementCoverageScore: number;
  readonly questionQualityScore: number;
  readonly domainDepthScore: number;
  readonly artifactQualityScore: number;
  readonly overallScore: number;
}

export interface DialogEvaluationResult {
  readonly conversationId: string;
  readonly scriptId: string;
  readonly candidateModelId: string;
  readonly scoreBreakdown: DialogScoreBreakdown;
  readonly clarificationAssertions: readonly ClarificationAssertion[];
  readonly artifactEvaluations: readonly ArtifactEvaluationResult[];
  readonly summary: string;
  readonly strengths: readonly string[];
  readonly weaknesses: readonly string[];
  readonly durationMs: number;
}

export interface StakeholderSimulatorConfig {
  readonly script: InterviewScript;
  readonly conversationId?: string;
  readonly strictMode?: boolean;
  readonly customSeed?: number;
}

export interface InterviewGraderConfig {
  readonly minPassingScore?: number;
  readonly weights?: {
    readonly clarification?: number;
    readonly requirementCoverage?: number;
    readonly questionQuality?: number;
    readonly domainDepth?: number;
    readonly artifactQuality?: number;
  };
}

export interface InteractiveBenchmarkScenario {
  readonly id: string;
  readonly name: string;
  readonly skillName: string;
  readonly script: InterviewScript;
  readonly graderConfig?: InterviewGraderConfig;
}

export interface InteractiveBenchmarkResult {
  readonly scenarioId: string;
  readonly modelId: string;
  readonly passed: boolean;
  readonly evaluation: DialogEvaluationResult;
  readonly transcript: DialogTranscript;
}
