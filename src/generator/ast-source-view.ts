import type { Span } from "oxc-parser";

export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export class AstSourceView {
  private readonly lineStarts: readonly number[];

  public constructor(
    public readonly filePath: string,
    private readonly sourceCode: string,
  ) {
    const lineStarts = [0];
    for (let index = 0; index < sourceCode.length; index++) {
      if (sourceCode[index] === "\n") lineStarts.push(index + 1);
    }
    this.lineStarts = Object.freeze(lineStarts);
  }

  public text(span: SourceSpan | Span): string {
    return this.sourceCode.slice(span.start, span.end);
  }

  public line(span: SourceSpan | Span): number {
    let lowerBound = 0;
    let upperBound = this.lineStarts.length;
    while (lowerBound + 1 < upperBound) {
      const middle = Math.floor((lowerBound + upperBound) / 2);
      if ((this.lineStarts[middle] ?? 0) <= span.start) lowerBound = middle;
      else upperBound = middle;
    }
    return lowerBound + 1;
  }

  public snippet(span: SourceSpan | Span, maximumLength: number): string {
    if (!Number.isInteger(maximumLength) || maximumLength < 3) {
      throw new RangeError("Snippet length must be an integer of at least 3");
    }
    const value = this.text(span).trim();
    if (value.length <= maximumLength) return value;
    return `${value.slice(0, maximumLength - 3)}...`;
  }
}
