export interface ShellCommentScan {
  readonly commentLines: readonly number[];
  readonly uncertainty: string | undefined;
}

interface BaseContext {
  readonly kind: "base";
  readonly closesCommand: boolean;
  readonly caseStates: CaseState[];
  parenthesisDepth: number;
  wordStart: boolean;
}

type CaseState = "awaiting_in" | "pattern" | "body";

interface QuoteContext {
  readonly kind: "single" | "double";
}

interface ArithmeticContext {
  readonly kind: "arithmetic";
  parenthesisDepth: number;
}

type ShellContext = BaseContext | QuoteContext | ArithmeticContext;

export function scanShellComments(content: string): ShellCommentScan {
  const commentLines: number[] = [];
  const contexts: ShellContext[] = [createBaseContext(false)];
  let lineNumber = 1;
  for (let index = 0; index < content.length; index += 1) {
    const context = contexts.at(-1);
    const character = content[index];
    if (context === undefined || character === undefined) {
      return uncertain(commentLines, "invalid_scanner_state");
    }
    if (context.kind === "single") {
      if (character === "'") contexts.pop();
      if (character === "\n") lineNumber += 1;
      continue;
    }
    if (context.kind === "double") {
      if (character === "\\") {
        const escaped = content[index + 1];
        if (escaped === "\n") lineNumber += 1;
        if (escaped !== undefined) index += 1;
      } else if (character === '"') contexts.pop();
      else if (character === "`") return uncertain(commentLines, `backtick:${lineNumber}`);
      else if (character === "$" && content[index + 1] === "(") {
        index = enterExpansion(content, index, contexts);
      } else if (character === "\n") lineNumber += 1;
      continue;
    }
    if (context.kind === "arithmetic") {
      if (character === "\\") {
        const escaped = content[index + 1];
        if (escaped === "\n") lineNumber += 1;
        if (escaped !== undefined) index += 1;
      } else if (character === "'") contexts.push({ kind: "single" });
      else if (character === '"') contexts.push({ kind: "double" });
      else if (character === "`") return uncertain(commentLines, `backtick:${lineNumber}`);
      else if (character === "$" && content[index + 1] === "(") {
        index = enterExpansion(content, index, contexts);
      } else if (character === "(") context.parenthesisDepth += 1;
      else if (character === ")") {
        if (context.parenthesisDepth === 1 && content[index + 1] === ")") {
          contexts.pop();
          index += 1;
          markExpansionAsWord(contexts);
        } else context.parenthesisDepth -= 1;
      } else if (character === "\n") lineNumber += 1;
      if (context.parenthesisDepth < 0) {
        return uncertain(commentLines, `arithmetic_parenthesis:${lineNumber}`);
      }
      continue;
    }
    if (context.kind !== "base") return uncertain(commentLines, "invalid_quote_state");
    const caseWord = readCaseWord(content, index, context);
    if (caseWord !== undefined) {
      applyCaseWord(context, caseWord.word);
      context.wordStart = false;
      index = caseWord.end - 1;
    } else if (character === "\\") {
      const escaped = content[index + 1];
      if (escaped === "\n") lineNumber += 1;
      else if (escaped !== undefined) context.wordStart = false;
      if (escaped !== undefined) index += 1;
    } else if (character === "'") {
      context.wordStart = false;
      contexts.push({ kind: "single" });
    } else if (character === '"') {
      context.wordStart = false;
      contexts.push({ kind: "double" });
    } else if (character === "`") return uncertain(commentLines, `backtick:${lineNumber}`);
    else if (character === "<" && content[index + 1] === "<") {
      return uncertain(commentLines, `heredoc:${lineNumber}`);
    } else if (character === "$" && content[index + 1] === "(") {
      context.wordStart = false;
      index = enterExpansion(content, index, contexts);
    } else if (character === "(" && activeCaseState(context) === "pattern") {
      context.wordStart = true;
    } else if (character === ")" && activeCaseState(context) === "pattern") {
      context.caseStates[context.caseStates.length - 1] = "body";
      context.wordStart = true;
    } else if (
      character === ";" &&
      activeCaseState(context) === "body" &&
      (content[index + 1] === ";" || content[index + 1] === "&")
    ) {
      context.caseStates[context.caseStates.length - 1] = "pattern";
      context.wordStart = true;
    } else if (character === "(" && context.closesCommand) {
      context.parenthesisDepth += 1;
      context.wordStart = true;
    } else if (character === ")" && context.closesCommand) {
      if (context.parenthesisDepth === 0) {
        if (context.caseStates.length > 0) {
          return uncertain(commentLines, `unclosed_case:${lineNumber}`);
        }
        contexts.pop();
        markExpansionAsWord(contexts);
      } else {
        context.parenthesisDepth -= 1;
        context.wordStart = true;
      }
    } else if (character === "#" && context.wordStart) {
      commentLines.push(lineNumber);
      while (content[index + 1] !== undefined && content[index + 1] !== "\n") index += 1;
    } else if (character === "\n") {
      lineNumber += 1;
      context.wordStart = true;
    } else context.wordStart = /[\t\r |&;<>]/.test(character);
  }
  if (contexts.length !== 1 || contexts[0]?.kind !== "base" || contexts[0].caseStates.length > 0) {
    return uncertain(commentLines, `unclosed_shell_construct:${lineNumber}`);
  }
  return { commentLines, uncertainty: undefined };
}

function createBaseContext(closesCommand: boolean): BaseContext {
  return { kind: "base", closesCommand, caseStates: [], parenthesisDepth: 0, wordStart: true };
}

function enterExpansion(content: string, dollarIndex: number, contexts: ShellContext[]): number {
  if (content[dollarIndex + 2] === "(") {
    contexts.push({ kind: "arithmetic", parenthesisDepth: 1 });
    return dollarIndex + 2;
  }
  contexts.push(createBaseContext(true));
  return dollarIndex + 1;
}

function markExpansionAsWord(contexts: ShellContext[]): void {
  const parent = contexts.at(-1);
  if (parent?.kind === "base") parent.wordStart = false;
}

function readCaseWord(
  content: string,
  index: number,
  context: BaseContext,
): { readonly word: "case" | "in" | "esac"; readonly end: number } | undefined {
  if (!context.wordStart || !/[A-Za-z_]/.test(content[index] ?? "")) return undefined;
  let end = index + 1;
  while (/[A-Za-z0-9_]/.test(content[end] ?? "")) end += 1;
  if (!isShellBoundary(content[end])) return undefined;
  const word = content.slice(index, end);
  const state = activeCaseState(context);
  if (word === "case" && state !== "pattern") return { word, end };
  if (word === "in" && state === "awaiting_in") return { word, end };
  if (word === "esac" && (state === "pattern" || state === "body")) return { word, end };
  return undefined;
}

function applyCaseWord(context: BaseContext, word: "case" | "in" | "esac"): void {
  if (word === "case") context.caseStates.push("awaiting_in");
  else if (word === "in") context.caseStates[context.caseStates.length - 1] = "pattern";
  else context.caseStates.pop();
}

function activeCaseState(context: BaseContext): CaseState | undefined {
  return context.caseStates.at(-1);
}

function isShellBoundary(character: string | undefined): boolean {
  return character === undefined || /[\s|&;()<>#]/.test(character);
}

function uncertain(commentLines: readonly number[], uncertainty: string): ShellCommentScan {
  return { commentLines, uncertainty };
}
