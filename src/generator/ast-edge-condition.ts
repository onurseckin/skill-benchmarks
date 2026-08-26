import type { Node } from "oxc-parser";
import type { EdgeConditionMeta, EdgeConditionType } from "./types.js";
import { AstSourceView } from "./ast-source-view.js";
import { isComparisonNode } from "./ast-traversal.js";

export function extractEdgeCondition(node: Node, source: AstSourceView): EdgeConditionMeta | null {
  const line = source.line(node);
  const sourceCodeSnippet = source.snippet(node, 120);
  if (node.type === "ThrowStatement") {
    return {
      description: `Exception throw at line ${line}`,
      location: `${source.filePath}:${line}`,
      conditionType: "exception_throw",
      sourceCodeSnippet,
      line,
    };
  }
  if (node.type === "IfStatement") {
    const conditionText = source.text(node.test);
    let conditionType: EdgeConditionType = "boundary_check";
    if (
      conditionText.includes("=== null") ||
      conditionText.includes("=== undefined") ||
      conditionText.includes("!")
    ) {
      conditionType = "null_check";
    } else if (conditionText.includes("typeof") || conditionText.includes("instanceof")) {
      conditionType = "type_guard";
    }
    return {
      description: `Conditional branch: ${conditionText}`,
      location: `${source.filePath}:${line}`,
      conditionType,
      sourceCodeSnippet,
      line,
    };
  }
  if (isComparisonNode(node)) {
    return {
      description: `Comparison check: ${source.text(node)}`,
      location: `${source.filePath}:${line}`,
      conditionType: "boundary_check",
      sourceCodeSnippet,
      line,
    };
  }
  return null;
}
