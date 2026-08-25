import { visitorKeys } from "oxc-parser";
import type { BinaryExpression, Node } from "oxc-parser";

export type AstNodeVisitor = (node: Node, depth: number) => void;

const BRANCH_NODE_TYPES = new Set([
  "IfStatement",
  "ConditionalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "CatchClause",
]);

const COMPARISON_OPERATORS = new Set<BinaryExpression["operator"]>([
  "===",
  "!==",
  "<",
  ">",
  "<=",
  ">=",
]);

function isAstNode(value: unknown): value is Node {
  if (typeof value !== "object" || value === null) return false;
  const type = Reflect.get(value, "type");
  return typeof type === "string" && Object.hasOwn(visitorKeys, type);
}

function visitNode(
  node: Node,
  depth: number,
  maximumDepth: number,
  visit: AstNodeVisitor
): void {
  visit(node, depth);
  if (depth >= maximumDepth) return;
  const nodeRecord = node as unknown as Readonly<Record<string, unknown>>;
  for (const childKey of visitorKeys[node.type] ?? []) {
    const childValue = nodeRecord[childKey];
    if (Array.isArray(childValue)) {
      for (const child of childValue) {
        if (isAstNode(child)) visitNode(child, depth + 1, maximumDepth, visit);
      }
    } else if (isAstNode(childValue)) {
      visitNode(childValue, depth + 1, maximumDepth, visit);
    }
  }
}

export function walkAst(root: Node, visit: (node: Node) => void): void {
  visitNode(root, 0, Number.POSITIVE_INFINITY, visit);
}

export function walkAstWithinDepth(
  root: Node,
  maximumDepth: number,
  visit: AstNodeVisitor
): void {
  visitNode(root, 0, maximumDepth, visit);
}

export function isBranchingNode(node: Node): boolean {
  if (BRANCH_NODE_TYPES.has(node.type)) return true;
  if (node.type === "SwitchCase") return node.test !== null;
  return node.type === "LogicalExpression" && ["&&", "||", "??"].includes(node.operator);
}

export function isComparisonNode(node: Node): node is BinaryExpression {
  return node.type === "BinaryExpression" && COMPARISON_OPERATORS.has(node.operator);
}
