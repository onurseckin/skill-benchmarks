export class SourceAnalysisError extends Error {
  public readonly code = "SOURCE_ANALYSIS_FAILED";

  public constructor(public readonly filePath: string) {
    super(`Source analysis failed for ${filePath}`);
    this.name = "SourceAnalysisError";
  }
}
