import type {
  BindingPattern,
  Class,
  Function,
  Node,
  ParamPattern,
  Program,
  TSInterfaceDeclaration,
  TSTypeAliasDeclaration,
  TSTypeAnnotation,
} from "oxc-parser";
import type {
  ClassMeta,
  FunctionSignatureMeta,
  InterfaceMeta,
  MethodMeta,
  ParameterMeta,
  PropertyMeta,
  TypeAliasMeta,
} from "./types.js";
import { AstSourceView } from "./ast-source-view.js";
import { isBranchingNode, walkAstWithinDepth } from "./ast-traversal.js";
export { extractEdgeCondition } from "./ast-edge-condition.js";

type AnalyzableDeclaration = Function | Class | TSInterfaceDeclaration | TSTypeAliasDeclaration;

interface DeclarationCandidate {
  readonly declaration: AnalyzableDeclaration;
  readonly exported: boolean;
  readonly depth: number;
  readonly start: number;
  readonly fallbackName?: string;
}

export interface MetadataExtractionOptions {
  readonly includeInternalSymbols: boolean;
  readonly calculateCyclomaticComplexity: boolean;
  readonly maximumDepth?: number;
}

export interface DeclarationMetadata {
  readonly functions: readonly FunctionSignatureMeta[];
  readonly interfaces: readonly InterfaceMeta[];
  readonly classes: readonly ClassMeta[];
  readonly typeAliases: readonly TypeAliasMeta[];
}

function isAnalyzableDeclaration(node: Node): node is AnalyzableDeclaration {
  return [
    "FunctionDeclaration",
    "TSDeclareFunction",
    "ClassDeclaration",
    "TSInterfaceDeclaration",
    "TSTypeAliasDeclaration",
  ].includes(node.type);
}

function moduleExportName(node: Node): string | undefined {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return undefined;
}

function declarationName(node: AnalyzableDeclaration): string | undefined {
  return node.id?.name;
}

function declarationCandidates(program: Program): readonly DeclarationCandidate[] {
  const exportedNames = new Set<string>();
  for (const statement of program.body) {
    if (statement.type === "ExportNamedDeclaration" && statement.source === null) {
      for (const specifier of statement.specifiers) {
        const name = moduleExportName(specifier.local);
        if (name) exportedNames.add(name);
      }
    } else if (statement.type === "ExportDefaultDeclaration") {
      const name = moduleExportName(statement.declaration);
      if (name) exportedNames.add(name);
    }
  }
  const candidates: DeclarationCandidate[] = [];
  for (const statement of program.body) {
    if (statement.type === "ExportNamedDeclaration" && statement.declaration) {
      if (isAnalyzableDeclaration(statement.declaration)) {
        candidates.push({
          declaration: statement.declaration,
          exported: true,
          depth: 2,
          start: statement.start,
        });
      }
    } else if (statement.type === "ExportDefaultDeclaration") {
      if (isAnalyzableDeclaration(statement.declaration)) {
        const fallbackName =
          statement.declaration.type === "FunctionDeclaration"
            ? "anonymous"
            : statement.declaration.type === "ClassDeclaration"
              ? "AnonymousClass"
              : undefined;
        candidates.push({
          declaration: statement.declaration,
          exported: true,
          depth: 2,
          start: statement.start,
          fallbackName,
        });
      }
    } else if (isAnalyzableDeclaration(statement)) {
      const name = declarationName(statement);
      candidates.push({
        declaration: statement,
        exported: name !== undefined && exportedNames.has(name),
        depth: 1,
        start: statement.start,
      });
    }
  }
  return candidates;
}

function typeText(
  annotation: TSTypeAnnotation | null | undefined,
  source: AstSourceView,
): string | undefined {
  return annotation ? source.text(annotation.typeAnnotation) : undefined;
}

function parameterTypeAnnotation(
  parameter: Exclude<ParamPattern, { readonly type: "TSParameterProperty" }>,
): TSTypeAnnotation | null {
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation ?? null;
  }
  return parameter.typeAnnotation ?? null;
}

function bindingName(parameter: BindingPattern, source: AstSourceView): string {
  const end = parameter.typeAnnotation?.start ?? parameter.end;
  const value = source.text({ start: parameter.start, end }).trimEnd();
  return parameter.optional && value.endsWith("?") ? value.slice(0, -1).trimEnd() : value;
}

function memberName(
  key: Node,
  computed: boolean,
  member: { readonly start: number; readonly end: number },
  source: AstSourceView,
): string {
  if (!computed) return source.text(key);
  const prefix = source.text({ start: member.start, end: key.start });
  const suffix = source.text({ start: key.end, end: member.end });
  const openingOffset = prefix.lastIndexOf("[");
  const closingOffset = suffix.indexOf("]");
  if (openingOffset < 0 || closingOffset < 0) return source.text(key);
  return source.text({
    start: member.start + openingOffset,
    end: key.end + closingOffset + 1,
  });
}

function extractParameter(parameter: ParamPattern, source: AstSourceView): ParameterMeta {
  const normalized = parameter.type === "TSParameterProperty" ? parameter.parameter : parameter;
  const isRest = normalized.type === "RestElement";
  const name = isRest
    ? bindingName(normalized.argument, source)
    : normalized.type === "AssignmentPattern"
      ? bindingName(normalized.left, source)
      : bindingName(normalized, source);
  const annotation = parameterTypeAnnotation(normalized);
  const defaultValue =
    normalized.type === "AssignmentPattern" ? source.text(normalized.right) : undefined;
  const optional =
    normalized.type === "AssignmentPattern"
      ? Boolean(normalized.optional || normalized.left.optional)
      : Boolean(normalized.optional);
  return {
    name,
    typeString: typeText(annotation, source) ?? "unknown",
    optional,
    defaultValue,
    isRest,
  };
}

function extractParameters(
  parameters: readonly ParamPattern[],
  source: AstSourceView,
): readonly ParameterMeta[] {
  return parameters.map((parameter) => extractParameter(parameter, source));
}

function functionBodyMetadata(
  node: Function,
  source: AstSourceView,
  calculateComplexity: boolean,
  maximumDepth: number | undefined,
  declarationDepth: number,
): { readonly branchCount: number; readonly throwStatements: readonly string[] } {
  if (!node.body) return { branchCount: 1, throwStatements: [] };
  let branchCount = 1;
  const throwStatements: string[] = [];
  const bodyDepth = declarationDepth + 1;
  const remainingDepth =
    maximumDepth === undefined ? Number.POSITIVE_INFINITY : maximumDepth - bodyDepth;
  if (remainingDepth < 0) return { branchCount, throwStatements };
  walkAstWithinDepth(node.body, remainingDepth, (child) => {
    if (calculateComplexity && isBranchingNode(child)) branchCount++;
    if (child.type === "ThrowStatement") throwStatements.push(source.text(child));
  });
  return { branchCount, throwStatements };
}

function extractFunction(
  candidate: DeclarationCandidate,
  source: AstSourceView,
  options: MetadataExtractionOptions,
): FunctionSignatureMeta | null {
  const node = candidate.declaration;
  if (node.type !== "FunctionDeclaration" && node.type !== "TSDeclareFunction") return null;
  const name = node.id ? source.text(node.id) : candidate.fallbackName;
  if (!name) return null;
  const bodyMetadata = functionBodyMetadata(
    node,
    source,
    options.calculateCyclomaticComplexity,
    options.maximumDepth,
    candidate.depth,
  );
  return {
    name,
    returnTypeString: typeText(node.returnType, source) ?? "void",
    parameters: extractParameters(node.params, source),
    isAsync: node.async,
    isExported: candidate.exported,
    complexityScore: bodyMetadata.branchCount,
    branchCount: bodyMetadata.branchCount,
    throwStatements: bodyMetadata.throwStatements,
    startLine: source.line({ start: candidate.start, end: candidate.start }),
    endLine: source.line({ start: node.end, end: node.end }),
  };
}

function extractInterface(
  node: TSInterfaceDeclaration,
  exported: boolean,
  source: AstSourceView,
): InterfaceMeta {
  const properties: PropertyMeta[] = [];
  const methods: MethodMeta[] = [];
  for (const member of node.body.body) {
    if (member.type === "TSPropertySignature") {
      properties.push({
        name: memberName(member.key, member.computed, member, source),
        typeString: typeText(member.typeAnnotation, source) ?? "unknown",
        readonly: member.readonly,
        optional: member.optional,
      });
    } else if (member.type === "TSMethodSignature" && member.kind === "method") {
      methods.push({
        name: memberName(member.key, member.computed, member, source),
        returnTypeString: typeText(member.returnType, source) ?? "void",
        parameters: extractParameters(member.params, source),
        isAsync: false,
        visibility: "public",
      });
    }
  }
  return {
    name: source.text(node.id),
    extendsTypes: node.extends.map((heritage) => source.text(heritage)),
    properties,
    methods,
    isExported: exported,
  };
}

function classExtendsText(node: Class, source: AstSourceView): string | undefined {
  if (!node.superClass) return undefined;
  const end = node.superTypeArguments?.end ?? node.superClass.end;
  return source.text({ start: node.superClass.start, end });
}

function extractClass(
  node: Class,
  exported: boolean,
  source: AstSourceView,
  fallbackName?: string,
): ClassMeta | null {
  const name = node.id ? source.text(node.id) : fallbackName;
  if (!name) return null;
  const properties: PropertyMeta[] = [];
  const methods: MethodMeta[] = [];
  const constructorParameters: ParameterMeta[] = [];
  for (const member of node.body.body) {
    if (member.type === "PropertyDefinition" || member.type === "TSAbstractPropertyDefinition") {
      properties.push({
        name: memberName(member.key, member.computed, member, source),
        typeString: typeText(member.typeAnnotation, source) ?? "unknown",
        readonly: Boolean(member.readonly),
        optional: Boolean(member.optional),
      });
    } else if (member.type === "MethodDefinition" || member.type === "TSAbstractMethodDefinition") {
      if (member.kind === "constructor") {
        constructorParameters.push(...extractParameters(member.value.params, source));
      } else if (member.kind === "method") {
        methods.push({
          name: memberName(member.key, member.computed, member, source),
          returnTypeString: typeText(member.value.returnType, source) ?? "void",
          parameters: extractParameters(member.value.params, source),
          isAsync: member.value.async,
          visibility: member.accessibility ?? "public",
        });
      }
    }
  }
  return {
    name,
    extendsClass: classExtendsText(node, source),
    implementsInterfaces: (node.implements ?? []).map((entry) => source.text(entry)),
    properties,
    methods,
    constructorParameters,
    isExported: exported,
  };
}

function extractTypeAlias(
  node: TSTypeAliasDeclaration,
  exported: boolean,
  source: AstSourceView,
): TypeAliasMeta {
  return {
    name: source.text(node.id),
    typeString: source.text(node.typeAnnotation),
    isExported: exported,
  };
}

export function extractDeclarationMetadata(
  program: Program,
  source: AstSourceView,
  options: MetadataExtractionOptions,
): DeclarationMetadata {
  const functions: FunctionSignatureMeta[] = [];
  const interfaces: InterfaceMeta[] = [];
  const classes: ClassMeta[] = [];
  const typeAliases: TypeAliasMeta[] = [];
  for (const candidate of declarationCandidates(program)) {
    if (options.maximumDepth !== undefined && candidate.depth > options.maximumDepth) continue;
    if (!options.includeInternalSymbols && !candidate.exported) continue;
    const node = candidate.declaration;
    const functionMeta = extractFunction(candidate, source, options);
    if (functionMeta) functions.push(functionMeta);
    else if (node.type === "TSInterfaceDeclaration")
      interfaces.push(extractInterface(node, candidate.exported, source));
    else if (node.type === "ClassDeclaration") {
      const classMeta = extractClass(node, candidate.exported, source, candidate.fallbackName);
      if (classMeta) classes.push(classMeta);
    } else if (node.type === "TSTypeAliasDeclaration") {
      typeAliases.push(extractTypeAlias(node, candidate.exported, source));
    }
  }
  return { functions, interfaces, classes, typeAliases };
}
