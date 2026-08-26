import type { ExtractedCodebaseFeatures, FunctionSignatureMeta, InterfaceMeta } from "./types.js";

function renderInterfaceStub(iface: InterfaceMeta): string {
  const extendsClause =
    iface.extendsTypes.length > 0 ? ` extends ${iface.extendsTypes.join(", ")}` : "";
  const lines = [`export interface ${iface.name}${extendsClause} {`];
  for (const property of iface.properties) {
    const readonlyPrefix = property.readonly ? "readonly " : "";
    const optionalSuffix = property.optional ? "?" : "";
    lines.push(`  ${readonlyPrefix}${property.name}${optionalSuffix}: ${property.typeString};`);
  }
  for (const method of iface.methods) {
    const parameters = method.parameters
      .map((parameter) => `${parameter.name}: ${parameter.typeString}`)
      .join(", ");
    lines.push(`  ${method.name}(${parameters}): ${method.returnTypeString};`);
  }
  lines.push("}");
  return lines.join("\n");
}

function renderFunctionStub(fn: FunctionSignatureMeta): string {
  const asyncPrefix = fn.isAsync ? "async " : "";
  const parameters = fn.parameters
    .map((parameter) => `${parameter.name}: ${parameter.typeString}`)
    .join(", ");
  return `export ${asyncPrefix}function ${fn.name}(${parameters}): ${fn.returnTypeString} {\n  throw new Error("${fn.name} not implemented");\n}`;
}

export function generateScenarioStubCode(
  features: ExtractedCodebaseFeatures,
  sourceCode: string,
  templateId: string,
): string {
  if (["bug_fix", "refactoring", "performance_optimization"].includes(templateId))
    return sourceCode;
  const lines: string[] = [];
  for (const iface of features.interfaces) lines.push(renderInterfaceStub(iface), "");
  for (const fn of features.functions) lines.push(renderFunctionStub(fn), "");
  return lines.join("\n");
}
