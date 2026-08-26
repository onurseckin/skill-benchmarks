export interface ShellCommentScan {
  readonly commentLines: readonly number[];
  readonly uncertainty: string | undefined;
}

interface BaseContext {
  readonly kind: "base";
  readonly closesCommand: boolean;
  parenthesisDepth: number;
  wordStart: boolean;
}

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
    if (startsUnsupportedCase(content, index, context.wordStart)) {
      return uncertain(commentLines, `unsupported_case:${lineNumber}`);
    }
    if (character === "\\") {
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
    } else if (character === "(" && context.closesCommand) {
      context.parenthesisDepth += 1;
      context.wordStart = true;
    } else if (character === ")" && context.closesCommand) {
      if (context.parenthesisDepth === 0) {
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
    } else context.wordStart = /[\t\r |&;()<>]/.test(character);
  }
  if (contexts.length !== 1 || contexts[0]?.kind !== "base") {
    return uncertain(commentLines, `unclosed_shell_construct:${lineNumber}`);
  }
  return { commentLines, uncertainty: undefined };
}

function createBaseContext(closesCommand: boolean): BaseContext {
  return { kind: "base", closesCommand, parenthesisDepth: 0, wordStart: true };
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

function startsUnsupportedCase(content: string, index: number, wordStart: boolean): boolean {
  return wordStart && content.startsWith("case", index) && isShellBoundary(content[index + 4]);
}

function isShellBoundary(character: string | undefined): boolean {
  return character === undefined || /[\s|&;()<>#]/.test(character);
}

function uncertain(commentLines: readonly number[], uncertainty: string): ShellCommentScan {
  return { commentLines, uncertainty };
}
