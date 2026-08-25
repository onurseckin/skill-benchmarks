import { parseSync } from "oxc-parser";
import type { ParseResult } from "oxc-parser";
import type { AstAnalyzerOptions, EdgeConditionMeta, ExtractedCodebaseFeatures } from "./types.js";
import { AstSourceView } from "./ast-source-view.js";
import { extractDeclarationMetadata, extractEdgeCondition } from "./ast-metadata-extractor.js";
import { isBranchingNode, walkAstWithinDepth } from "./ast-traversal.js";
import { SourceAnalysisError } from "./errors.js";

interface NormalizedAnalyzerOptions {
  readonly includeInternalSymbols: boolean;
  readonly extractEdgeConditions: boolean;
  readonly calculateCyclomaticComplexity: boolean;
  readonly maximumDepth?: number;
}

function normalizeOptions(options: AstAnalyzerOptions): NormalizedAnalyzerOptions {
  const maximumDepth = options.maxDepth;
  if (
    maximumDepth !== undefined &&
    (!Number.isFinite(maximumDepth) || !Number.isInteger(maximumDepth) || maximumDepth <= 0)
  ) {
    throw new RangeError("Analyzer depth must be a positive integer");
  }
  return Object.freeze({
    includeInternalSymbols: options.includeInternalSymbols ?? false,
    extractEdgeConditions: options.extractEdgeConditions ?? true,
    calculateCyclomaticComplexity: options.calculateCyclomaticComplexity ?? true,
    maximumDepth,
  });
}

function parseSource(filePath: string, sourceCode: string): ParseResult {
  let result: ParseResult;
  try {
    result = parseSync(filePath, sourceCode, { astType: "ts" });
  } catch {
    throw new SourceAnalysisError(filePath);
  }
  if (result.errors.some((error) => error.severity === "Error")) {
    throw new SourceAnalysisError(filePath);
  }
  return result;
}

export class AstAnalyzer {
  private readonly options: NormalizedAnalyzerOptions;

  public constructor(options: AstAnalyzerOptions = {}) {
    this.options = normalizeOptions(options);
  }

  public analyzeSource(filePath: string, sourceCode: string): ExtractedCodebaseFeatures {
    const parseResult = parseSource(filePath, sourceCode);
    const source = new AstSourceView(filePath, sourceCode);
    const declarations = extractDeclarationMetadata(parseResult.program, source, this.options);
    const edgeConditions: EdgeConditionMeta[] = [];
    let cyclomaticComplexity = 1;
    const maximumDepth = this.options.maximumDepth ?? Number.POSITIVE_INFINITY;

    walkAstWithinDepth(parseResult.program, maximumDepth, (node) => {
      if (this.options.calculateCyclomaticComplexity && isBranchingNode(node)) {
        cyclomaticComplexity++;
      }
      if (this.options.extractEdgeConditions) {
        const edgeCondition = extractEdgeCondition(node, source);
        if (edgeCondition) edgeConditions.push(edgeCondition);
      }
    });

    return {
      filePath,
      ...declarations,
      edgeConditions,
      rawLoc: sourceCode.split("\n").length,
      cyclomaticComplexity,
    };
  }
}
