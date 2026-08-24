import type {
  ScenarioDefinition,
  ExecutionLimits,
} from "../runner/types.js";
import type {
  DeterministicCheck,
  JudgeRubricDimension,
} from "../eval/types.js";

export type GenerationTemplateId =
  | "bug_fix"
  | "feature_implementation"
  | "refactoring"
  | "security_hardening"
  | "performance_optimization"
  | "api_migration"
  | "concurrency_control"
  | "edge_case_handling";

export type SkillCategory =
  | "coding"
  | "debugging"
  | "frontend"
  | "react"
  | "system"
  | "optimization"
  | "security"
  | "composite";

export type DifficultyLevel = "easy" | "medium" | "hard" | "expert";

export type SynthesisStrategy =
  | "ast_mutation"
  | "interface_implementation"
  | "counterfactual_bug"
  | "boundary_expansion"
  | "contract_verification";

export type AstNodeType =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type_alias"
  | "variable"
  | "enum"
  | "export";

export interface ParameterMeta {
  readonly name: string;
  readonly typeString: string;
  readonly optional: boolean;
  readonly defaultValue?: string;
  readonly isRest: boolean;
}

export interface FunctionSignatureMeta {
  readonly name: string;
  readonly returnTypeString: string;
  readonly parameters: readonly ParameterMeta[];
  readonly isAsync: boolean;
  readonly isExported: boolean;
  readonly complexityScore: number;
  readonly branchCount: number;
  readonly throwStatements: readonly string[];
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface PropertyMeta {
  readonly name: string;
  readonly typeString: string;
  readonly readonly: boolean;
  readonly optional: boolean;
}

export interface MethodMeta {
  readonly name: string;
  readonly returnTypeString: string;
  readonly parameters: readonly ParameterMeta[];
  readonly isAsync: boolean;
  readonly visibility: "public" | "protected" | "private";
}

export interface InterfaceMeta {
  readonly name: string;
  readonly extendsTypes: readonly string[];
  readonly properties: readonly PropertyMeta[];
  readonly methods: readonly MethodMeta[];
  readonly isExported: boolean;
}

export interface ClassMeta {
  readonly name: string;
  readonly extendsClass?: string;
  readonly implementsInterfaces: readonly string[];
  readonly properties: readonly PropertyMeta[];
  readonly methods: readonly MethodMeta[];
  readonly constructorParameters: readonly ParameterMeta[];
  readonly isExported: boolean;
}

export interface TypeAliasMeta {
  readonly name: string;
  readonly typeString: string;
  readonly isExported: boolean;
}

export type EdgeConditionType =
  | "null_check"
  | "boundary_check"
  | "type_guard"
  | "exception_throw"
  | "concurrency_lock"
  | "state_assertion";

export interface EdgeConditionMeta {
  readonly description: string;
  readonly location: string;
  readonly conditionType: EdgeConditionType;
  readonly sourceCodeSnippet: string;
  readonly line: number;
}

export interface ExtractedCodebaseFeatures {
  readonly filePath: string;
  readonly functions: readonly FunctionSignatureMeta[];
  readonly interfaces: readonly InterfaceMeta[];
  readonly classes: readonly ClassMeta[];
  readonly typeAliases: readonly TypeAliasMeta[];
  readonly edgeConditions: readonly EdgeConditionMeta[];
  readonly rawLoc: number;
  readonly cyclomaticComplexity: number;
}

export interface DifficultyScoringWeights {
  readonly complexityWeight: number;
  readonly cognitiveLoadWeight: number;
  readonly edgeCaseWeight: number;
  readonly interfaceDepthWeight: number;
  readonly rubricCountWeight: number;
}

export interface DifficultyScoreBreakdown {
  readonly rawScore: number;
  readonly computedLevel: DifficultyLevel;
  readonly complexityScore: number;
  readonly cognitiveLoadScore: number;
  readonly edgeCaseScore: number;
  readonly interfaceDepthScore: number;
  readonly rubricCountScore: number;
  readonly recommendations: readonly string[];
}

export interface SyntheticScenarioConfig {
  readonly templateId: GenerationTemplateId;
  readonly targetSkill: string;
  readonly category: SkillCategory;
  readonly difficulty?: DifficultyLevel;
  readonly namePrefix?: string;
  readonly customInstructions?: string;
  readonly baselineModel?: string;
  readonly maxTurns?: number;
  readonly maxCostUSD?: number;
  readonly maxWallClockTimeMs?: number;
  readonly includeTestFixtures?: boolean;
  readonly seed?: number;
}

export interface SyntheticTestSuite {
  readonly testFileName: string;
  readonly testContent: string;
  readonly associatedChecks: readonly DeterministicCheck[];
}

export interface SyntheticScenarioResult {
  readonly scenario: ScenarioDefinition;
  readonly extractedFeatures: ExtractedCodebaseFeatures;
  readonly difficultyBreakdown: DifficultyScoreBreakdown;
  readonly generatedTestSuites: readonly SyntheticTestSuite[];
  readonly timestamp: string;
}

export interface SynthesisBatchOptions {
  readonly templates?: readonly GenerationTemplateId[];
  readonly categories?: readonly SkillCategory[];
  readonly count: number;
  readonly baseDifficulty?: DifficultyLevel;
  readonly outputDirectory?: string;
  readonly seed?: number;
}

export interface SynthesisBatchSummary {
  readonly totalGenerated: number;
  readonly scenarios: readonly SyntheticScenarioResult[];
  readonly durationMs: number;
  readonly categoriesCovered: readonly SkillCategory[];
  readonly difficultyDistribution: Record<DifficultyLevel, number>;
}

export interface GenerationTemplateDefinition {
  readonly id: GenerationTemplateId;
  readonly name: string;
  readonly description: string;
  readonly defaultCategory: SkillCategory;
  readonly defaultDifficulty: DifficultyLevel;
  readonly strategy: SynthesisStrategy;
  readonly promptPattern: string;
  readonly defaultLimits: ExecutionLimits;
}

export interface AstAnalyzerOptions {
  readonly includeInternalSymbols?: boolean;
  readonly extractEdgeConditions?: boolean;
  readonly calculateCyclomaticComplexity?: boolean;
  readonly maxDepth?: number;
}

export interface SynthesizerOptions {
  readonly defaultWeights?: DifficultyScoringWeights;
  readonly customTemplates?: readonly GenerationTemplateDefinition[];
  readonly seed?: number;
  readonly judgeRubrics?: readonly JudgeRubricDimension[];
}
