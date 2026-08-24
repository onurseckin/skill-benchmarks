import type {
  ScenarioDefinition,
  ExecutionLimits,
} from "../runner/types.js";
import type {
  DeterministicCheck,
  JudgeRubricDimension,
} from "../eval/types.js";
import type {
  SyntheticScenarioConfig,
  SyntheticScenarioResult,
  SyntheticTestSuite,
  ExtractedCodebaseFeatures,
  DifficultyScoreBreakdown,
  DifficultyScoringWeights,
  DifficultyLevel,
  GenerationTemplateId,
  GenerationTemplateDefinition,
  SkillCategory,
  SynthesisBatchOptions,
  SynthesisBatchSummary,
  SynthesizerOptions,
  FunctionSignatureMeta,
  InterfaceMeta,
} from "./types.js";
import { AstAnalyzer } from "./ast-analyzer.js";

const DEFAULT_WEIGHTS: DifficultyScoringWeights = {
  complexityWeight: 0.3,
  cognitiveLoadWeight: 0.25,
  edgeCaseWeight: 0.25,
  interfaceDepthWeight: 0.1,
  rubricCountWeight: 0.1,
};

const DEFAULT_TEMPLATES: readonly GenerationTemplateDefinition[] = [
  {
    id: "bug_fix",
    name: "Defect Identification and Remediation",
    description: "Diagnose and repair subtle logic bugs, boundary errors, or null dereferences",
    defaultCategory: "debugging",
    defaultDifficulty: "medium",
    strategy: "counterfactual_bug",
    promptPattern: "Identify and resolve the defect in {targetPath}.",
    defaultLimits: { maxTurns: 15, maxWallClockTimeMs: 300000, maxCostUSD: 1.0, maxConsecutiveToolFailures: 3, toolTimeoutMs: 30000, maxOutputSizeBytes: 1048576 },
  },
  {
    id: "feature_implementation",
    name: "Greenfield Contract Implementation",
    description: "Implement missing interface methods and class implementations adhering to strict types",
    defaultCategory: "coding",
    defaultDifficulty: "medium",
    strategy: "interface_implementation",
    promptPattern: "Implement the required interfaces and class methods in {targetPath}.",
    defaultLimits: { maxTurns: 20, maxWallClockTimeMs: 360000, maxCostUSD: 1.5, maxConsecutiveToolFailures: 3, toolTimeoutMs: 30000, maxOutputSizeBytes: 1048576 },
  },
  {
    id: "refactoring",
    name: "Architectural Refactoring and Decoupling",
    description: "Refactor monolithic functions into modular abstractions",
    defaultCategory: "system",
    defaultDifficulty: "hard",
    strategy: "boundary_expansion",
    promptPattern: "Refactor the implementation in {targetPath} to improve modularity.",
    defaultLimits: { maxTurns: 20, maxWallClockTimeMs: 360000, maxCostUSD: 1.5, maxConsecutiveToolFailures: 3, toolTimeoutMs: 30000, maxOutputSizeBytes: 1048576 },
  },
  {
    id: "security_hardening",
    name: "Security Vulnerability Hardening",
    description: "Harden input validation and sanitize command executions",
    defaultCategory: "security",
    defaultDifficulty: "hard",
    strategy: "contract_verification",
    promptPattern: "Harden against vulnerabilities in {targetPath}.",
    defaultLimits: { maxTurns: 20, maxWallClockTimeMs: 360000, maxCostUSD: 1.5, maxConsecutiveToolFailures: 3, toolTimeoutMs: 30000, maxOutputSizeBytes: 1048576 },
  },
  {
    id: "performance_optimization",
    name: "High-Throughput Performance Optimization",
    description: "Eliminate algorithmic bottlenecks and reduce memory pressure",
    defaultCategory: "optimization",
    defaultDifficulty: "hard",
    strategy: "boundary_expansion",
    promptPattern: "Optimize performance of {targetPath}.",
    defaultLimits: { maxTurns: 25, maxWallClockTimeMs: 420000, maxCostUSD: 2.0, maxConsecutiveToolFailures: 3, toolTimeoutMs: 30000, maxOutputSizeBytes: 1048576 },
  },
];

export class ScenarioSynthesizer {
  private readonly analyzer: AstAnalyzer;
  private readonly weights: DifficultyScoringWeights;
  private readonly templates: readonly GenerationTemplateDefinition[];
  private readonly defaultSeed: number;

  constructor(options: SynthesizerOptions = {}) {
    const { defaultWeights, customTemplates, seed } = options;
    this.analyzer = new AstAnalyzer();
    this.weights = defaultWeights ?? DEFAULT_WEIGHTS;
    this.templates = customTemplates ?? DEFAULT_TEMPLATES;
    this.defaultSeed = seed ?? 1337;
  }

  public getAvailableTemplates(): readonly GenerationTemplateDefinition[] {
    return this.templates;
  }

  public calculateDifficulty(features: ExtractedCodebaseFeatures, weights = this.weights): DifficultyScoreBreakdown {
    const complexityScore = Math.min(100, features.cyclomaticComplexity * 8);
    const cognitiveLoadScore = Math.min(100, features.interfaces.length * 12 + features.classes.length * 15 + features.functions.length * 8 + features.typeAliases.length * 6);
    const edgeCaseScore = Math.min(100, features.edgeConditions.length * 14);
    const interfaceDepthScore = Math.min(100, features.interfaces.reduce((sum, iface) => sum + iface.extendsTypes.length * 20, 10));
    const rubricCountScore = 50;

    const rawScore = Math.round(
      complexityScore * weights.complexityWeight +
      cognitiveLoadScore * weights.cognitiveLoadWeight +
      edgeCaseScore * weights.edgeCaseWeight +
      interfaceDepthScore * weights.interfaceDepthWeight +
      rubricCountScore * weights.rubricCountWeight
    );

    let computedLevel: DifficultyLevel = "easy";
    if (rawScore >= 80) computedLevel = "expert";
    else if (rawScore >= 55) computedLevel = "hard";
    else if (rawScore >= 25) computedLevel = "medium";

    const recommendations: string[] = [];
    if (complexityScore > 60) recommendations.push("High cyclomatic complexity: provide detailed branch instructions.");
    if (edgeCaseScore > 50) recommendations.push("Substantial edge cases: include boundary assertions.");

    return { rawScore, computedLevel, complexityScore, cognitiveLoadScore, edgeCaseScore, interfaceDepthScore, rubricCountScore, recommendations };
  }

  public synthesizeScenario(config: SyntheticScenarioConfig, sourceCode: string, sourcePath = "src/module.ts"): SyntheticScenarioResult {
    const features = this.analyzer.analyzeSource(sourcePath, sourceCode);
    const difficultyBreakdown = this.calculateDifficulty(features);
    const template = this.templates.find((t) => t.id === config.templateId) ?? this.templates[0]!;
    const scenarioId = `${config.category}-${config.targetSkill}-${config.templateId}`;
    const name = `${config.namePrefix ? `${config.namePrefix}: ` : ""}${template.name} (${config.targetSkill})`;

    const instructions = this.generateInstructions(config, template, features, sourcePath);
    const deterministicChecks = this.generateDeterministicChecks(features, config.templateId, sourcePath);
    const judgeRubrics = this.generateJudgeRubrics(config.templateId, config.category);
    const testSuites = this.generateTestSuites(features, config.templateId);

    const fixtures: Record<string, string> = {
      [sourcePath]: this.generateStubCode(features, sourceCode, config.templateId),
      "package.json": JSON.stringify({ name: "synthetic-benchmark-fixture", version: "1.0.0", type: "module", scripts: { test: "bun test", typecheck: "tsc --noEmit" }, devDependencies: { "@types/node": "^22.13.0", typescript: "^5.7.3" } }, null, 2),
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true }, include: ["src/**/*"] }, null, 2),
    };

    for (const suite of testSuites) fixtures[suite.testFileName] = suite.testContent;

    const limits: ExecutionLimits = {
      maxTurns: config.maxTurns ?? template.defaultLimits.maxTurns,
      maxWallClockTimeMs: config.maxWallClockTimeMs ?? template.defaultLimits.maxWallClockTimeMs,
      maxCostUSD: config.maxCostUSD ?? template.defaultLimits.maxCostUSD,
      maxConsecutiveToolFailures: template.defaultLimits.maxConsecutiveToolFailures,
      toolTimeoutMs: template.defaultLimits.toolTimeoutMs,
      maxOutputSizeBytes: template.defaultLimits.maxOutputSizeBytes,
    };

    const scenario: ScenarioDefinition = {
      id: scenarioId,
      name,
      category: config.category,
      difficulty: config.difficulty ?? difficultyBreakdown.computedLevel,
      targetSkill: config.targetSkill,
      baselineModel: config.baselineModel ?? "claude-3-7-sonnet-20250219",
      description: `Synthesized benchmark scenario evaluating ${config.targetSkill} via ${template.name.toLowerCase()}.`,
      instructions,
      workspace: { fixtures, initialGitCommit: `Initial commit for synthetic scenario: ${scenarioId}` },
      limits,
      evaluation: { deterministicChecks, judgeRubrics },
    };

    return { scenario, extractedFeatures: features, difficultyBreakdown, generatedTestSuites: testSuites, timestamp: new Date().toISOString() };
  }

  public async synthesizeBatch(options: SynthesisBatchOptions, codebaseFiles: ReadonlyArray<{ path: string; content: string }>): Promise<SynthesisBatchSummary> {
    const startTime = Date.now();
    const scenarios: SyntheticScenarioResult[] = [];
    const categoriesCovered = new Set<SkillCategory>();
    const difficultyDistribution: Record<DifficultyLevel, number> = { easy: 0, medium: 0, hard: 0, expert: 0 };
    const templatesToUse = options.templates ?? this.templates.map((t) => t.id);
    const categoriesToUse: readonly SkillCategory[] = options.categories ?? ["coding", "debugging", "system", "security", "optimization"];

    let count = 0;
    for (let i = 0; i < options.count; i++) {
      const file = codebaseFiles[i % codebaseFiles.length];
      if (!file) break;
      const templateId = templatesToUse[i % templatesToUse.length] ?? "bug_fix";
      const category = categoriesToUse[i % categoriesToUse.length] ?? "coding";
      const targetSkill = `skill-${templateId}-${i + 1}`;
      const result = this.synthesizeScenario({ templateId, targetSkill, category, difficulty: options.baseDifficulty, seed: (options.seed ?? this.defaultSeed) + i }, file.content, file.path);
      scenarios.push(result);
      categoriesCovered.add(category);
      const level = result.difficultyBreakdown.computedLevel;
      difficultyDistribution[level] = (difficultyDistribution[level] ?? 0) + 1;
      count++;
    }

    return { totalGenerated: count, scenarios, durationMs: Date.now() - startTime, categoriesCovered: Array.from(categoriesCovered), difficultyDistribution };
  }

  private generateInstructions(config: SyntheticScenarioConfig, template: GenerationTemplateDefinition, features: ExtractedCodebaseFeatures, sourcePath: string): string {
    const lines: string[] = [
      `You are tasked with executing the **${template.name}** task for skill \`${config.targetSkill}\`.`,
      `Target File: \`${sourcePath}\``,
      "",
      "### Objectives & Requirements:",
    ];
    if (features.interfaces.length > 0) {
      lines.push("1. **Interface Compliance**:");
      for (const iface of features.interfaces.slice(0, 3)) lines.push(`   - Implement all properties and methods declared in \`${iface.name}\`.`);
    }
    if (features.functions.length > 0) {
      lines.push("2. **Function Implementation**:");
      for (const fn of features.functions.slice(0, 3)) lines.push(`   - Implement \`${fn.name}\` returning \`${fn.returnTypeString}\`.`);
    }
    if (features.edgeConditions.length > 0) {
      lines.push("3. **Edge Case Handling & Robustness**:");
      for (const edge of features.edgeConditions.slice(0, 3)) lines.push(`   - Correctly handle \`${edge.conditionType}\` conditions without crashing.`);
    }
    lines.push("4. **Type Safety and Invariants**:");
    lines.push("   - Maintain strict TypeScript type safety with zero `any` usage.");
    lines.push(`   - Confine all changes exclusively to \`${sourcePath}\`.`);
    if (config.customInstructions) lines.push("", "### Additional Notes:", config.customInstructions);
    return lines.join("\n");
  }

  public generateDeterministicChecks(features: ExtractedCodebaseFeatures, templateId: GenerationTemplateId, sourcePath: string): readonly DeterministicCheck[] {
    const checks: DeterministicCheck[] = [
      { id: `check-${templateId}-file-exists`, name: `Verify ${sourcePath} exists`, type: "file_exists", filePath: sourcePath, mustExist: true, weight: 0.2 },
    ];
    if (features.functions.length > 0) {
      const fn = features.functions[0]!;
      checks.push({ id: `check-${templateId}-fn-${fn.name}`, name: `Verify function ${fn.name} is declared`, type: "file_content", filePath: sourcePath, fileContentPattern: `(export )?(async )?function ${fn.name}`, weight: 0.3 });
    } else if (features.classes.length > 0) {
      const cls = features.classes[0]!;
      checks.push({ id: `check-${templateId}-class-${cls.name}`, name: `Verify class ${cls.name} is declared`, type: "file_content", filePath: sourcePath, fileContentPattern: `export class ${cls.name}`, weight: 0.3 });
    }
    checks.push(
      { id: `check-${templateId}-no-any`, name: "Verify zero TypeScript any annotations", type: "file_content", filePath: sourcePath, fileContentPattern: "^(?!.*: any\\b).*", weight: 0.2 },
      { id: `check-${templateId}-git-diff`, name: "Verify focused modifications within scope", type: "git_diff", maxFilesChanged: 2, weight: 0.3 }
    );
    return checks;
  }

  public generateJudgeRubrics(templateId: GenerationTemplateId, category: SkillCategory): readonly JudgeRubricDimension[] {
    return [
      {
        name: "Correctness and Completeness",
        category,
        weight: 0.4,
        description: `Evaluates whether the ${templateId} task is completely implemented.`,
        criteria: { 1: "Incomplete or failing implementation.", 3: "Partially working implementation.", 5: "Flawless, complete implementation." },
      },
      {
        name: "Type Safety and Code Quality",
        category,
        weight: 0.3,
        description: "Evaluates TypeScript type fidelity and clean architecture.",
        criteria: { 1: "Uses loose types or any annotations.", 3: "Adequate types with minor inconsistencies.", 5: "Impeccable type definitions." },
      },
      {
        name: "Edge Case & Error Handling",
        category,
        weight: 0.3,
        description: "Evaluates defensive programming and error handling.",
        criteria: { 1: "Crashes on invalid parameters.", 3: "Handles standard errors.", 5: "Comprehensive guard clauses and robustness." },
      },
    ];
  }

  public generateTestSuites(features: ExtractedCodebaseFeatures, _templateId: GenerationTemplateId): readonly SyntheticTestSuite[] {
    const testLines: string[] = ['import { describe, it, expect } from "bun:test";'];
    if (features.functions.length > 0) {
      const fnNames = features.functions.map((f) => f.name).join(", ");
      testLines.push(`import { ${fnNames} } from "./module.js";`, "", 'describe("Synthetic Test Suite", () => {');
      for (const fn of features.functions) {
        testLines.push(`  it("executes ${fn.name} correctly", () => {`, `    expect(typeof ${fn.name}).toBe("function");`, "  });");
      }
      testLines.push("});");
    } else {
      testLines.push('describe("Synthetic Test Suite", () => {', '  it("verifies module presence", () => {', "    expect(true).toBe(true);", "  });", "});");
    }
    return [{ testFileName: "tests/synthetic.test.ts", testContent: testLines.join("\n"), associatedChecks: [] }];
  }

  private generateStubCode(features: ExtractedCodebaseFeatures, sourceCode: string, templateId: GenerationTemplateId): string {
    if (templateId === "bug_fix" || templateId === "refactoring" || templateId === "performance_optimization") return sourceCode;
    const lines: string[] = [];
    for (const iface of features.interfaces) lines.push(this.renderInterfaceStub(iface), "");
    for (const fn of features.functions) lines.push(this.renderFunctionStub(fn), "");
    return lines.join("\n");
  }

  private renderInterfaceStub(iface: InterfaceMeta): string {
    const extendsClause = iface.extendsTypes.length > 0 ? ` extends ${iface.extendsTypes.join(", ")}` : "";
    const lines = [`export interface ${iface.name}${extendsClause} {`];
    for (const prop of iface.properties) {
      const ro = prop.readonly ? "readonly " : "";
      const opt = prop.optional ? "?" : "";
      lines.push(`  ${ro}${prop.name}${opt}: ${prop.typeString};`);
    }
    for (const method of iface.methods) {
      const params = method.parameters.map((p) => `${p.name}: ${p.typeString}`).join(", ");
      lines.push(`  ${method.name}(${params}): ${method.returnTypeString};`);
    }
    lines.push("}");
    return lines.join("\n");
  }

  private renderFunctionStub(fn: FunctionSignatureMeta): string {
    const asyncKw = fn.isAsync ? "async " : "";
    const params = fn.parameters.map((p) => `${p.name}: ${p.typeString}`).join(", ");
    return `export ${asyncKw}function ${fn.name}(${params}): ${fn.returnTypeString} {\n  throw new Error("${fn.name} not implemented");\n}`;
  }
}
