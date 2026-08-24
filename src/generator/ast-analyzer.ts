import ts from "typescript";
import type {
  ExtractedCodebaseFeatures,
  FunctionSignatureMeta,
  InterfaceMeta,
  ClassMeta,
  TypeAliasMeta,
  EdgeConditionMeta,
  ParameterMeta,
  PropertyMeta,
  MethodMeta,
  AstAnalyzerOptions,
  EdgeConditionType,
} from "./types.js";

const DEFAULT_ANALYZER_OPTIONS: AstAnalyzerOptions = {
  includeInternalSymbols: false,
  extractEdgeConditions: true,
  calculateCyclomaticComplexity: true,
  maxDepth: 10,
};

export class AstAnalyzer {
  private readonly options: AstAnalyzerOptions;

  constructor(options: AstAnalyzerOptions = {}) {
    this.options = { ...DEFAULT_ANALYZER_OPTIONS, ...options };
  }

  public analyzeSource(filePath: string, sourceCode: string): ExtractedCodebaseFeatures {
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const functions: FunctionSignatureMeta[] = [];
    const interfaces: InterfaceMeta[] = [];
    const classes: ClassMeta[] = [];
    const typeAliases: TypeAliasMeta[] = [];
    const edgeConditions: EdgeConditionMeta[] = [];
    let cyclomaticComplexity = 1;

    const visit = (node: ts.Node): void => {
      if (this.isBranchingNode(node)) {
        cyclomaticComplexity++;
      }

      if (this.options.extractEdgeConditions && this.isEdgeConditionNode(node)) {
        const edgeMeta = this.extractEdgeCondition(node, sourceFile, sourceCode);
        if (edgeMeta !== null) {
          edgeConditions.push(edgeMeta);
        }
      }

      if (ts.isFunctionDeclaration(node) && node.name) {
        functions.push(this.extractFunctionMeta(node, sourceFile));
      } else if (ts.isInterfaceDeclaration(node)) {
        interfaces.push(this.extractInterfaceMeta(node, sourceFile));
      } else if (ts.isClassDeclaration(node) && node.name) {
        classes.push(this.extractClassMeta(node, sourceFile));
      } else if (ts.isTypeAliasDeclaration(node)) {
        typeAliases.push(this.extractTypeAliasMeta(node, sourceFile));
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    const rawLoc = sourceCode.split("\n").length;

    return {
      filePath,
      functions,
      interfaces,
      classes,
      typeAliases,
      edgeConditions,
      rawLoc,
      cyclomaticComplexity,
    };
  }

  private isBranchingNode(node: ts.Node): boolean {
    return (
      ts.isIfStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isCaseClause(node) ||
      ts.isCatchClause(node) ||
      (ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    );
  }

  private isEdgeConditionNode(node: ts.Node): boolean {
    if (ts.isIfStatement(node)) {
      return true;
    }
    if (ts.isThrowStatement(node)) {
      return true;
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      return (
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.LessThanToken ||
        op === ts.SyntaxKind.GreaterThanToken ||
        op === ts.SyntaxKind.LessThanEqualsToken ||
        op === ts.SyntaxKind.GreaterThanEqualsToken
      );
    }
    return false;
  }

  private extractEdgeCondition(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    sourceCode: string
  ): EdgeConditionMeta | null {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const snippet = sourceCode.slice(node.getStart(sourceFile), node.getEnd()).trim();
    const truncatedSnippet = snippet.length > 120 ? `${snippet.slice(0, 117)}...` : snippet;

    if (ts.isThrowStatement(node)) {
      return {
        description: `Exception throw at line ${line + 1}`,
        location: `${sourceFile.fileName}:${line + 1}`,
        conditionType: "exception_throw",
        sourceCodeSnippet: truncatedSnippet,
        line: line + 1,
      };
    }

    if (ts.isIfStatement(node)) {
      const condText = node.expression.getText(sourceFile);
      let conditionType: EdgeConditionType = "boundary_check";
      if (condText.includes("=== null") || condText.includes("=== undefined") || condText.includes("!")) {
        conditionType = "null_check";
      } else if (condText.includes("typeof") || condText.includes("instanceof")) {
        conditionType = "type_guard";
      }
      return {
        description: `Conditional branch: ${condText}`,
        location: `${sourceFile.fileName}:${line + 1}`,
        conditionType,
        sourceCodeSnippet: truncatedSnippet,
        line: line + 1,
      };
    }

    if (ts.isBinaryExpression(node)) {
      return {
        description: `Comparison check: ${node.getText(sourceFile)}`,
        location: `${sourceFile.fileName}:${line + 1}`,
        conditionType: "boundary_check",
        sourceCodeSnippet: truncatedSnippet,
        line: line + 1,
      };
    }

    return null;
  }

  private extractFunctionMeta(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile
  ): FunctionSignatureMeta {
    const name = node.name ? node.name.getText(sourceFile) : "anonymous";
    const returnTypeString = node.type ? node.type.getText(sourceFile) : "void";
    const parameters = this.extractParameters(node.parameters, sourceFile);
    const isAsync = this.hasModifier(node, ts.SyntaxKind.AsyncKeyword);
    const isExported = this.hasModifier(node, ts.SyntaxKind.ExportKeyword);

    let branchCount = 1;
    const throwStatements: string[] = [];

    const countBranches = (n: ts.Node): void => {
      if (this.isBranchingNode(n)) {
        branchCount++;
      }
      if (ts.isThrowStatement(n)) {
        throwStatements.push(n.getText(sourceFile));
      }
      ts.forEachChild(n, countBranches);
    };

    if (node.body) {
      ts.forEachChild(node.body, countBranches);
    }

    const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    return {
      name,
      returnTypeString,
      parameters,
      isAsync,
      isExported,
      complexityScore: branchCount,
      branchCount,
      throwStatements,
      startLine: startLine + 1,
      endLine: endLine + 1,
    };
  }

  private extractInterfaceMeta(
    node: ts.InterfaceDeclaration,
    sourceFile: ts.SourceFile
  ): InterfaceMeta {
    const name = node.name.getText(sourceFile);
    const isExported = this.hasModifier(node, ts.SyntaxKind.ExportKeyword);
    const extendsTypes: string[] = [];

    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          for (const type of clause.types) {
            extendsTypes.push(type.getText(sourceFile));
          }
        }
      }
    }

    const properties: PropertyMeta[] = [];
    const methods: MethodMeta[] = [];

    for (const member of node.members) {
      if (ts.isPropertySignature(member) && member.name) {
        properties.push({
          name: member.name.getText(sourceFile),
          typeString: member.type ? member.type.getText(sourceFile) : "unknown",
          readonly: this.hasModifier(member, ts.SyntaxKind.ReadonlyKeyword),
          optional: Boolean(member.questionToken),
        });
      } else if (ts.isMethodSignature(member) && member.name) {
        methods.push({
          name: member.name.getText(sourceFile),
          returnTypeString: member.type ? member.type.getText(sourceFile) : "void",
          parameters: this.extractParameters(member.parameters, sourceFile),
          isAsync: false,
          visibility: "public",
        });
      }
    }

    return {
      name,
      extendsTypes,
      properties,
      methods,
      isExported,
    };
  }

  private extractClassMeta(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile
  ): ClassMeta {
    const name = node.name ? node.name.getText(sourceFile) : "AnonymousClass";
    const isExported = this.hasModifier(node, ts.SyntaxKind.ExportKeyword);
    let extendsClass: string | undefined;
    const implementsInterfaces: string[] = [];

    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          extendsClass = clause.types[0]?.getText(sourceFile);
        } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
          for (const type of clause.types) {
            implementsInterfaces.push(type.getText(sourceFile));
          }
        }
      }
    }

    const properties: PropertyMeta[] = [];
    const methods: MethodMeta[] = [];
    const constructorParameters: ParameterMeta[] = [];

    for (const member of node.members) {
      if (ts.isPropertyDeclaration(member) && member.name) {
        properties.push({
          name: member.name.getText(sourceFile),
          typeString: member.type ? member.type.getText(sourceFile) : "unknown",
          readonly: this.hasModifier(member, ts.SyntaxKind.ReadonlyKeyword),
          optional: Boolean(member.questionToken),
        });
      } else if (ts.isMethodDeclaration(member) && member.name) {
        let visibility: "public" | "protected" | "private" = "public";
        if (this.hasModifier(member, ts.SyntaxKind.PrivateKeyword)) {
          visibility = "private";
        } else if (this.hasModifier(member, ts.SyntaxKind.ProtectedKeyword)) {
          visibility = "protected";
        }

        methods.push({
          name: member.name.getText(sourceFile),
          returnTypeString: member.type ? member.type.getText(sourceFile) : "void",
          parameters: this.extractParameters(member.parameters, sourceFile),
          isAsync: this.hasModifier(member, ts.SyntaxKind.AsyncKeyword),
          visibility,
        });
      } else if (ts.isConstructorDeclaration(member)) {
        constructorParameters.push(...this.extractParameters(member.parameters, sourceFile));
      }
    }

    return {
      name,
      extendsClass,
      implementsInterfaces,
      properties,
      methods,
      constructorParameters,
      isExported,
    };
  }

  private extractTypeAliasMeta(
    node: ts.TypeAliasDeclaration,
    sourceFile: ts.SourceFile
  ): TypeAliasMeta {
    return {
      name: node.name.getText(sourceFile),
      typeString: node.type.getText(sourceFile),
      isExported: this.hasModifier(node, ts.SyntaxKind.ExportKeyword),
    };
  }

  private extractParameters(
    parameters: ts.NodeArray<ts.ParameterDeclaration>,
    sourceFile: ts.SourceFile
  ): readonly ParameterMeta[] {
    return parameters.map((param) => ({
      name: param.name.getText(sourceFile),
      typeString: param.type ? param.type.getText(sourceFile) : "unknown",
      optional: Boolean(param.questionToken),
      defaultValue: param.initializer ? param.initializer.getText(sourceFile) : undefined,
      isRest: Boolean(param.dotDotDotToken),
    }));
  }

  private hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (!modifiers) {
      return false;
    }
    return modifiers.some((mod) => mod.kind === kind);
  }
}
